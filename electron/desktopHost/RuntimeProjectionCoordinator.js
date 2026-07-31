'use strict';

const { assertNoRollback, assertSnapshot, digest, makeError } = require('../../shared/runtimeApiV2Contract');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

class RuntimeProjectionCoordinator {
  constructor(options = {}) {
    if (!options.client || typeof options.backendSnapshot !== 'function') throw new TypeError('RuntimeProjectionCoordinator requires client and backendSnapshot');
    this.client = options.client;
    this.backendSnapshot = options.backendSnapshot;
    this.expectedBuildId = String(options.expectedBuildId || '');
    this.pollIntervalMs = Math.max(50, Number(options.pollIntervalMs || 750));
    this.eventLimit = Math.max(1, Math.min(500, Number(options.eventLimit || 100)));
    this.clock = options.clock || (() => new Date().toISOString());
    this.onProjection = options.onProjection || (() => {});
    this.onFailure = options.onFailure || (() => {});
    this.baseline = null;
    this.candidate = null;
    this.binding = null;
    this.state = 'NO_BASELINE';
    this.generation = 0;
    this.pollTimer = null;
    this.pollPromise = null;
    this.mutationsBlocked = false;
    this.stopOperation = null;
    this.lastStopOperation = null;
    this.metrics = {
      snapshotsFetched: 0, eventBatchesFetched: 0, eventsObserved: 0, eventGaps: 0,
      staleSessionResponsesDiscarded: 0, staleOwnerResponsesDiscarded: 0,
      baselineDiscards: 0, snapshotRefetches: 0, commandsSubmitted: 0,
      stopCommandIntentsCreated: 0, stopRecoveryAttempts: 0, stopOwnerExitRecoveries: 0
    };
    this.lastFailure = null;
  }

  _backend(options = {}) {
    const snapshot = this.backendSnapshot() || {};
    if (!snapshot.running || !snapshot.apiSessionEstablished || !snapshot.backendSessionId || !snapshot.startupNonce) {
      throw makeError('WP6_BACKEND_SESSION_NOT_READY', 'Backend process session is not ready for API v2 projection', {}, 409);
    }
    if (options.requireTrusted === true && snapshot.ownerTrusted !== true) {
      throw makeError('WP6_TRUSTED_OWNER_REQUIRED', 'Backend owner must be durably trusted before binding runtime projection', {}, 409);
    }
    return snapshot;
  }

  _binding(backend, options = {}) {
    const clientBinding = this.client.currentBinding({ requireTrusted: options.requireTrusted === true });
    if (Number(clientBinding.backendPid || 0) !== Number(backend.backendPid || 0) ||
        String(clientBinding.backendSessionId || '') !== String(backend.backendSessionId || '') ||
        String(clientBinding.startupNonce || '') !== String(backend.startupNonce || '')) {
      throw makeError('WP6_STALE_API_SESSION_RESPONSE', 'API session binding does not match the active BackendProcessHost owner', {}, 409);
    }
    return clientBinding;
  }

  _assertOwner(snapshot, previous = null) {
    assertSnapshot(snapshot, { expectedBuildId: this.expectedBuildId });
    if (previous) assertNoRollback(previous, snapshot, { requireSameOwner: true });
    return snapshot;
  }

  async validateCandidateProjection(context = {}) {
    this.state = 'FETCHING_UNTRUSTED_OWNER_CANDIDATE';
    const backend = this._backend({ requireTrusted: false });
    const binding = this._binding(backend, { requireTrusted: false });
    const snapshot = this._assertOwner(await this.client.getSnapshot({ requireTrusted: false, expectedBuildId: this.expectedBuildId }));
    this.metrics.snapshotsFetched += 1;
    const after = this._backend({ requireTrusted: false });
    const afterBinding = this._binding(after, { requireTrusted: false });
    if (afterBinding.sessionFingerprint !== binding.sessionFingerprint || Number(after.backendPid) !== Number(backend.backendPid)) {
      this.metrics.staleSessionResponsesDiscarded += 1;
      throw makeError('WP6_STALE_API_SESSION_RESPONSE', 'Candidate snapshot completed after backend session changed', {}, 409);
    }
    this.candidate = Object.freeze({ snapshot, binding, fetchedAtUtc: this.clock(), readyBackendPid: Number(context?.ready?.backend?.backendPid || backend.backendPid) });
    this.state = 'CANDIDATE_VALIDATED_OWNER_UNTRUSTED';
    return Object.freeze({
      ...snapshot,
      projectionStatus: this.state,
      backendStartInstance: binding.backendSessionId,
      ownerSession: binding.ownerSessionId || binding.fd6PipeInstanceId || '',
      apiSessionGeneration: binding.sessionFingerprint,
      candidateOnly: true
    });
  }

  async bindTrustedOwnerBaseline(candidateProjection = null) {
    const backend = this._backend({ requireTrusted: true });
    const binding = this._binding(backend, { requireTrusted: true });
    if (this.stopOperation) {
      const originalFingerprint = String(this.stopOperation.ownerBinding?.sessionFingerprint || '');
      if (originalFingerprint && originalFingerprint === String(binding.sessionFingerprint || '')) {
        throw makeError('WP6_STOP_OPERATION_ACTIVE_FOR_OWNER', 'A trusted baseline cannot be rebound to an owner with an active or retained stop operation', {
          commandId: this.stopOperation.commandId,
          status: this.stopOperation.status
        }, 409);
      }
      if (this.stopOperation.processCustody?.exitConfirmed !== true) {
        throw makeError('WP6_STOP_OPERATION_EXIT_RECOVERY_REQUIRED', 'A new owner baseline cannot be established before the previous stop operation and owner exit are fully recovered', {
          commandId: this.stopOperation.commandId,
          status: this.stopOperation.status
        }, 409);
      }
      this.lastStopOperation = this._stopOperationSummary(this.stopOperation);
      this.stopOperation = null;
    }
    this.state = 'BINDING_TRUSTED_OWNER_BASELINE';
    if (this.candidate && this.candidate.binding.sessionFingerprint !== binding.sessionFingerprint) {
      this.metrics.staleOwnerResponsesDiscarded += 1;
      this.candidate = null;
      throw makeError('WP6_STALE_OWNER_EVENT', 'Backend owner/session changed between candidate validation and durable owner acceptance', {}, 409);
    }
    const snapshot = this._assertOwner(await this.client.getSnapshot({ requireTrusted: true, expectedBuildId: this.expectedBuildId }), this.candidate?.snapshot || candidateProjection || null);
    this.metrics.snapshotsFetched += 1;
    const after = this._backend({ requireTrusted: true });
    const afterBinding = this._binding(after, { requireTrusted: true });
    if (afterBinding.sessionFingerprint !== binding.sessionFingerprint || after.ownerTrusted !== true) {
      this.metrics.staleOwnerResponsesDiscarded += 1;
      throw makeError('WP6_STALE_OWNER_EVENT', 'Trusted owner binding changed while establishing baseline', {}, 409);
    }
    this.baseline = Object.freeze({ ...snapshot });
    this.binding = binding;
    this.candidate = null;
    this.generation += 1;
    this.mutationsBlocked = false;
    this.state = 'API_V2_SYNCHRONIZED';
    this.lastFailure = null;
    this.onProjection(this.snapshot());
    return this.snapshot();
  }

  discardBaseline(reasonCode = 'WP6_BASELINE_INVALIDATED') {
    this.stopPolling();
    this.client.abortAll(reasonCode);
    this.baseline = null;
    this.binding = null;
    this.candidate = null;
    this.mutationsBlocked = true;
    this.metrics.baselineDiscards += 1;
    this.state = 'NO_BASELINE';
  }

  prepareForStop() {
    this.mutationsBlocked = true;
    this.stopPolling();
    this.state = this.baseline ? 'STOP_REQUEST_PENDING' : 'NO_BASELINE';
  }

  _stopBindingSnapshot(binding = this.binding) {
    return binding ? Object.freeze({
      backendPid: Number(binding.backendPid || 0),
      startupNonce: String(binding.startupNonce || ''),
      backendSessionId: String(binding.backendSessionId || ''),
      fd6PipeInstanceId: String(binding.fd6PipeInstanceId || ''),
      ownerSessionId: String(binding.ownerSessionId || ''),
      sessionFingerprint: String(binding.sessionFingerprint || '')
    }) : null;
  }

  _stopOperationSummary(operation = this.stopOperation) {
    if (!operation) return null;
    return {
      commandId: operation.commandId,
      envelopeDigest: operation.envelopeDigest,
      retainedEnvelope: clone(operation.envelope),
      expectedStateVersion: operation.expectedStateVersion,
      ownerBinding: operation.ownerBinding ? { ...operation.ownerBinding } : null,
      status: operation.status,
      attempts: Number(operation.attempts || 0),
      recoveryAttempts: Number(operation.recoveryAttempts || 0),
      createdAtUtc: operation.createdAtUtc,
      updatedAtUtc: operation.updatedAtUtc,
      lastError: operation.lastError ? { ...operation.lastError } : null,
      response: operation.response ? clone(operation.response) : null,
      processCustody: operation.processCustody ? clone(operation.processCustody) : null
    };
  }

  _createStopOperation(reason = '', options = {}) {
    if (!this.baseline || !this.binding) throw makeError('WP6_RUNTIME_BASELINE_REQUIRED', 'Runtime stop requires a trusted API v2 baseline', {}, 409);
    const expectedStateVersion = Number(options.expectedStateVersion ?? this.baseline.stateVersion);
    const envelope = this.client.command({
      commandId: options.commandId,
      commandType: 'runtime.stop',
      expectedStateVersion,
      payload: { reason: String(reason || 'desktop-runtime-stop') }
    });
    const operation = {
      commandId: envelope.commandId,
      envelope,
      envelopeDigest: digest(envelope),
      expectedStateVersion,
      ownerBinding: this._stopBindingSnapshot(this.binding),
      status: 'CREATED',
      attempts: 0,
      recoveryAttempts: 0,
      createdAtUtc: this.clock(),
      updatedAtUtc: this.clock(),
      lastError: null,
      response: null,
      processCustody: null,
      inFlight: null
    };
    this.stopOperation = operation;
    this.metrics.stopCommandIntentsCreated += 1;
    return operation;
  }

  _assertStopRequestMatches(operation, reason = '', options = {}) {
    const requestedReason = String(reason || 'desktop-runtime-stop');
    const requestedStateVersion = Number(options.expectedStateVersion ?? operation.expectedStateVersion);
    if ((options.commandId && String(options.commandId) !== operation.commandId) ||
        requestedReason !== String(operation.envelope?.payload?.reason || '') ||
        requestedStateVersion !== Number(operation.expectedStateVersion)) {
      operation.lastError = { reasonCode: 'WP6_STOP_OPERATION_ENVELOPE_MISMATCH', message: 'Conflicting stop envelope was rejected; the retained original operation remains authoritative', atUtc: this.clock() };
      operation.updatedAtUtc = this.clock();
      this.state = operation.status === 'TRANSPORT_OUTCOME_UNKNOWN' ? 'STOP_OUTCOME_UNKNOWN' : this.state;
      throw makeError('WP6_STOP_OPERATION_ENVELOPE_MISMATCH', 'Pending stop operation must be recovered with the same commandId and envelope', {
        commandId: operation.commandId,
        envelopeDigest: operation.envelopeDigest
      }, 409);
    }
  }

  _assertStopOwnerStillMatches(operation) {
    const backend = this.backendSnapshot() || {};
    if (backend.running !== true) return { backendExited: true, backend };
    if (backend.apiSessionEstablished !== true || backend.ownerTrusted !== true) {
      throw makeError('WP6_STOP_RECOVERY_OWNER_UNTRUSTED', 'Stop recovery requires the original backend owner to remain trusted and API-bound', {
        commandId: operation.commandId,
        backendPid: Number(backend.backendPid || 0)
      }, 409);
    }
    const current = this._binding(backend, { requireTrusted: true });
    const expected = operation.ownerBinding || {};
    const same = Number(current.backendPid || 0) === Number(expected.backendPid || 0) &&
      String(current.startupNonce || '') === String(expected.startupNonce || '') &&
      String(current.backendSessionId || '') === String(expected.backendSessionId || '') &&
      String(current.fd6PipeInstanceId || '') === String(expected.fd6PipeInstanceId || '') &&
      String(current.ownerSessionId || '') === String(expected.ownerSessionId || '') &&
      String(current.sessionFingerprint || '') === String(expected.sessionFingerprint || '');
    if (!same) {
      throw makeError('WP6_STOP_RECOVERY_OWNER_SESSION_CHANGED', 'Unknown stop outcome cannot be replayed to a different backend owner or API session', {
        commandId: operation.commandId,
        originalOwner: expected,
        currentOwner: this._stopBindingSnapshot(current)
      }, 409);
    }
    return { backendExited: false, backend, binding: current };
  }

  async _submitStopOperation(operation, options = {}) {
    if (operation.inFlight) return operation.inFlight;
    const task = (async () => {
      this._assertStopOwnerStillMatches(operation);
      operation.status = options.recovery === true ? 'RECOVERING' : 'SUBMITTING';
      operation.attempts += 1;
      if (options.recovery === true) {
        operation.recoveryAttempts += 1;
        this.metrics.stopRecoveryAttempts += 1;
      }
      operation.updatedAtUtc = this.clock();
      this.state = options.recovery === true ? 'STOP_OUTCOME_RECOVERING' : 'STOP_REQUEST_SUBMITTING';
      this.metrics.commandsSubmitted += 1;
      try {
        const response = await this.client.executeCommand(operation.envelope, {
          requireTrusted: true,
          timeoutMs: options.timeoutMs
        });
        if (String(response?.commandId || '') !== operation.commandId) {
          throw makeError('WP6_STOP_RECOVERY_COMMAND_ID_MISMATCH', 'Recovered stop response does not match the retained commandId', {
            expectedCommandId: operation.commandId,
            actualCommandId: String(response?.commandId || '')
          }, 502);
        }
        operation.status = 'CONFIRMED';
        operation.response = clone(response);
        operation.lastError = null;
        operation.updatedAtUtc = this.clock();
        this.lastStopOperation = this._stopOperationSummary(operation);
        this.state = 'STOP_REQUEST_CONFIRMED';
        return response;
      } catch (error) {
        const reasonCode = error?.reasonCode || error?.code || 'WP6_RUNTIME_STOP_FAILED';
        operation.lastError = { reasonCode, message: error?.message || '', atUtc: this.clock() };
        operation.updatedAtUtc = this.clock();
        if (reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN') {
          operation.status = 'TRANSPORT_OUTCOME_UNKNOWN';
          this.state = 'STOP_OUTCOME_UNKNOWN';
          error.details = {
            ...(error.details || {}),
            commandId: operation.commandId,
            envelopeDigest: operation.envelopeDigest,
            recoveryRequired: true
          };
          throw error;
        }
        if (['COMMAND_ID_REUSE_MISMATCH', 'WP6_STOP_RECOVERY_COMMAND_ID_MISMATCH', 'WP6_STOP_OPERATION_ENVELOPE_MISMATCH'].includes(reasonCode)) {
          operation.status = 'FAILED_PERMANENT';
        } else {
          operation.status = options.recovery === true ? 'RECOVERY_BLOCKED' : 'FAILED';
        }
        this.state = 'STOP_RECOVERY_BLOCKED';
        throw error;
      }
    })();
    operation.inFlight = task;
    try { return await task; }
    finally { if (operation.inFlight === task) operation.inFlight = null; }
  }

  async recoverStopOperation(options = {}) {
    const operation = this.stopOperation;
    if (!operation) throw makeError('WP6_STOP_RECOVERY_OPERATION_REQUIRED', 'No retained stop operation is available for recovery', {}, 409);
    if (operation.status === 'CONFIRMED') return clone(operation.response);
    if (['OWNER_EXITED', 'PROCESS_CUSTODY_CONFIRMED'].includes(operation.status)) {
      return Object.freeze({
        contractVersion: 2,
        commandId: operation.commandId,
        accepted: false,
        duplicate: true,
        recovered: true,
        backendExited: true,
        exitRecoveryRequired: operation.processCustody?.exitConfirmed !== true,
        reasonCode: operation.status === 'OWNER_EXITED' ? 'WP6_STOP_OWNER_EXITED_AFTER_UNKNOWN' : 'WP6_STOP_PROCESS_CUSTODY_CONFIRMED',
        result: { stopOutcome: operation.response?.accepted === true ? 'CONFIRMED' : 'UNKNOWN', processExited: true }
      });
    }
    if (operation.status === 'FAILED_PERMANENT') {
      throw makeError(operation.lastError?.reasonCode || 'WP6_STOP_RECOVERY_FAILED_PERMANENT', 'The retained stop operation is permanently blocked and cannot be replayed', {
        commandId: operation.commandId,
        status: operation.status
      }, 409);
    }
    if (!['TRANSPORT_OUTCOME_UNKNOWN', 'RECOVERY_BLOCKED'].includes(operation.status)) {
      throw makeError('WP6_STOP_RECOVERY_STATE_INVALID', 'Stop operation is not in a recoverable transport-unknown state', {
        commandId: operation.commandId,
        status: operation.status
      }, 409);
    }
    let inspection;
    try { inspection = this._assertStopOwnerStillMatches(operation); }
    catch (error) {
      operation.status = ['WP6_STOP_RECOVERY_OWNER_SESSION_CHANGED', 'WP6_STOP_RECOVERY_OWNER_UNTRUSTED'].includes(error.reasonCode || error.code) ? 'FAILED_PERMANENT' : 'RECOVERY_BLOCKED';
      operation.lastError = { reasonCode: error.reasonCode || error.code || 'WP6_STOP_RECOVERY_BLOCKED', message: error.message, atUtc: this.clock() };
      operation.updatedAtUtc = this.clock();
      this.state = 'STOP_RECOVERY_BLOCKED';
      throw error;
    }
    if (inspection.backendExited) {
      operation.status = 'OWNER_EXITED';
      operation.updatedAtUtc = this.clock();
      operation.processCustody = { backendExited: true, backendPid: Number(inspection.backend?.backendPid || operation.ownerBinding?.backendPid || 0), observedAtUtc: this.clock() };
      this.metrics.stopOwnerExitRecoveries += 1;
      this.lastStopOperation = this._stopOperationSummary(operation);
      this.state = 'STOP_OWNER_EXITED_RECOVERY_REQUIRED';
      return Object.freeze({
        contractVersion: 2,
        commandId: operation.commandId,
        accepted: false,
        duplicate: false,
        recovered: true,
        backendExited: true,
        exitRecoveryRequired: true,
        reasonCode: 'WP6_STOP_OWNER_EXITED_AFTER_UNKNOWN',
        result: { stopOutcome: 'UNKNOWN', processExited: true }
      });
    }
    return this._submitStopOperation(operation, { recovery: true, timeoutMs: options.timeoutMs });
  }

  resolveStopAfterProcessExit(result = {}) {
    if (result?.stopped !== true || result?.exitConfirmed !== true) {
      throw makeError('WP6_STOP_PROCESS_EXIT_NOT_CONFIRMED', 'Stop operation cannot be resolved before real backend process exit is confirmed', { result }, 409);
    }
    const operation = this.stopOperation;
    if (!operation) return { resolved: true, noStopOperation: true };
    operation.processCustody = {
      backendExited: true,
      exitConfirmed: true,
      forced: result.forced === true,
      alreadyStopped: result.alreadyStopped === true,
      backendPid: Number(result.backendPid || operation.ownerBinding?.backendPid || 0),
      resolvedAtUtc: this.clock()
    };
    if (operation.status !== 'CONFIRMED') operation.status = 'PROCESS_CUSTODY_CONFIRMED';
    operation.updatedAtUtc = this.clock();
    this.lastStopOperation = this._stopOperationSummary(operation);
    this.state = operation.status === 'CONFIRMED' ? 'STOP_CONFIRMED_AND_PROCESS_EXITED' : 'STOP_PROCESS_CUSTODY_CONFIRMED';
    return this._stopOperationSummary(operation);
  }

  startPolling() {
    if (!this.baseline || this.pollTimer) return false;
    const generation = this.generation;
    const tick = async () => {
      if (!this.pollTimer || generation !== this.generation || !this.baseline) return;
      try { await this.pollOnce(); }
      catch (error) {
        this.lastFailure = { reasonCode: error.reasonCode || error.code || 'WP6_EVENT_POLL_FAILED', message: error.message, atUtc: this.clock() };
        this.onFailure(error, this.snapshot());
        if (['API_SESSION_UNAUTHORIZED', 'WP6_STALE_API_SESSION_RESPONSE', 'WP6_STALE_OWNER_EVENT'].includes(error.reasonCode || error.code)) this.discardBaseline(error.reasonCode || error.code);
      }
    };
    this.pollTimer = setInterval(tick, this.pollIntervalMs);
    this.pollTimer.unref?.();
    this.state = 'POLLING_PERSISTED_EVENTS';
    return true;
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    return true;
  }

  async _refetchAfterGap() {
    const previous = this.baseline;
    this.metrics.eventGaps += 1;
    this.metrics.baselineDiscards += 1;
    this.state = 'EVENT_GAP_REFETCHING_SNAPSHOT';
    const backend = this._backend({ requireTrusted: true });
    const binding = this._binding(backend, { requireTrusted: true });
    const snapshot = this._assertOwner(await this.client.getSnapshot({ requireTrusted: true, expectedBuildId: this.expectedBuildId }));
    this.metrics.snapshotsFetched += 1;
    this.metrics.snapshotRefetches += 1;
    const afterBinding = this._binding(this._backend({ requireTrusted: true }), { requireTrusted: true });
    if (afterBinding.sessionFingerprint !== binding.sessionFingerprint) throw makeError('WP6_STALE_API_SESSION_RESPONSE', 'Snapshot refetch completed after session changed', {}, 409);
    if (previous && String(previous.runtime.ownerInstanceId) === String(snapshot.runtime.ownerInstanceId)) assertNoRollback(previous, snapshot);
    this.baseline = Object.freeze({ ...snapshot });
    this.binding = binding;
    this.state = 'POLLING_PERSISTED_EVENTS';
    this.onProjection(this.snapshot());
    return this.snapshot();
  }

  async pollOnce() {
    if (this.pollPromise) return this.pollPromise;
    const task = (async () => {
      if (!this.baseline) throw makeError('WP6_RUNTIME_BASELINE_REQUIRED', 'Runtime event polling requires a trusted baseline', {}, 409);
      const generation = this.generation;
      const binding = this.binding;
      try {
        const batch = await this.client.getEvents(this.baseline.lastEventSequence, this.eventLimit, { requireTrusted: true, expectedBuildId: this.expectedBuildId });
        this.metrics.eventBatchesFetched += 1;
        this.metrics.eventsObserved += batch.events.length;
        if (generation !== this.generation || !this.binding || binding.sessionFingerprint !== this.binding.sessionFingerprint) {
          this.metrics.staleSessionResponsesDiscarded += 1;
          throw makeError('WP6_STALE_API_SESSION_RESPONSE', 'Persisted events belong to a stale projection generation', {}, 409);
        }
        if (batch.events.length) {
          const snapshot = this._assertOwner(await this.client.getSnapshot({ requireTrusted: true, expectedBuildId: this.expectedBuildId }), this.baseline);
          this.metrics.snapshotsFetched += 1;
          if (snapshot.lastEventSequence < batch.events[batch.events.length - 1].eventSequence) {
            throw makeError('WP6_EVENT_OUT_OF_ORDER', 'Reconciled snapshot does not include the observed persisted event batch', {}, 409);
          }
          this.baseline = Object.freeze({ ...snapshot });
          this.onProjection(this.snapshot());
        }
        return this.snapshot();
      } catch (error) {
        if ((error.reasonCode || error.code) === 'EVENT_SEQUENCE_GAP') return this._refetchAfterGap();
        throw error;
      }
    })();
    this.pollPromise = task;
    try { return await task; } finally { if (this.pollPromise === task) this.pollPromise = null; }
  }

  async _command(type, payload = {}, options = {}) {
    if (!this.baseline) throw makeError('WP6_RUNTIME_BASELINE_REQUIRED', 'Runtime command requires a trusted API v2 baseline', {}, 409);
    if (this.mutationsBlocked && options.allowDuringStop !== true) throw makeError('WP6_RUNTIME_MUTATIONS_BLOCKED', 'Runtime mutations are blocked during stop/restart', {}, 409);
    const expectedStateVersion = Number(options.expectedStateVersion ?? this.baseline.stateVersion);
    const commandId = options.commandId;
    this.metrics.commandsSubmitted += 1;
    let response;
    if (type === 'runtime.setOperatingMode') response = await this.client.setOperatingMode({ commandId, expectedStateVersion, ...payload }, { requireTrusted: true, timeoutMs: options.timeoutMs });
    else if (type === 'runtime.stop') response = await this.client.requestStop({ commandId, expectedStateVersion, ...payload }, { requireTrusted: true, timeoutMs: options.timeoutMs });
    else if (type === 'runtime.setNetwork') response = await this.client.setNetwork({ commandId, expectedStateVersion, ...payload }, { requireTrusted: true, timeoutMs: options.timeoutMs });
    else if (type === 'runtime.suspend') response = await this.client.suspend({ commandId, expectedStateVersion, ...payload }, { requireTrusted: true, timeoutMs: options.timeoutMs });
    else if (type === 'runtime.resume') response = await this.client.resume({ commandId, expectedStateVersion, ...payload }, { requireTrusted: true, timeoutMs: options.timeoutMs });
    else throw makeError('COMMAND_TYPE_UNSUPPORTED', `Unsupported projection command: ${type}`, {}, 400);
    if (type !== 'runtime.stop') {
      const refreshed = this._assertOwner(await this.client.getSnapshot({ requireTrusted: true, expectedBuildId: this.expectedBuildId }), this.baseline);
      this.metrics.snapshotsFetched += 1;
      this.baseline = Object.freeze({ ...refreshed });
      this.onProjection(this.snapshot());
    }
    return response;
  }

  setOperatingMode(operatingMode, reason = '', options = {}) { return this._command('runtime.setOperatingMode', { operatingMode, reason }, options); }
  requestStop(reason = '', options = {}) {
    this.prepareForStop();
    let operation = this.stopOperation;
    if (operation) {
      this._assertStopRequestMatches(operation, reason, options);
      if (operation.status === 'CONFIRMED') {
        this.state = operation.processCustody?.exitConfirmed === true ? 'STOP_CONFIRMED_AND_PROCESS_EXITED' : 'STOP_REQUEST_CONFIRMED';
        return Promise.resolve(clone(operation.response));
      }
      if (['OWNER_EXITED', 'PROCESS_CUSTODY_CONFIRMED'].includes(operation.status)) {
        this.state = operation.status === 'OWNER_EXITED' ? 'STOP_OWNER_EXITED_RECOVERY_REQUIRED' : 'STOP_PROCESS_CUSTODY_CONFIRMED';
        return this.recoverStopOperation(options);
      }
      if (operation.status === 'FAILED_PERMANENT') {
        return Promise.reject(makeError(operation.lastError?.reasonCode || 'WP6_STOP_OPERATION_FAILED_PERMANENT', 'The retained stop operation is permanently blocked and cannot be replaced by a new intent', {
          commandId: operation.commandId,
          status: operation.status
        }, 409));
      }
      if (operation.status === 'TRANSPORT_OUTCOME_UNKNOWN' || operation.status === 'RECOVERY_BLOCKED') {
        return this.recoverStopOperation(options);
      }
      if (operation.inFlight) return operation.inFlight;
      throw makeError('WP6_STOP_OPERATION_ALREADY_PENDING', 'A stop operation is already pending and must reach a recoverable or terminal state', {
        commandId: operation.commandId,
        status: operation.status
      }, 409);
    }
    operation = this._createStopOperation(reason, options);
    return this._submitStopOperation(operation, { timeoutMs: options.timeoutMs });
  }
  setNetwork(online, reason = '', options = {}) { return this._command('runtime.setNetwork', { online, reason }, options); }
  suspend(reason = '', options = {}) { return this._command('runtime.suspend', { reason }, options); }
  resume(reason = '', options = {}) { return this._command('runtime.resume', { reason }, options); }

  snapshot() {
    const baseline = this.baseline;
    return Object.freeze({
      role: 'READ_ONLY_RUNTIME_PROJECTION',
      state: this.state,
      generation: this.generation,
      trustedOwnerBound: Boolean(this.binding && baseline),
      backendStartInstance: this.binding?.backendSessionId || '',
      ownerSession: this.binding?.ownerSessionId || this.binding?.fd6PipeInstanceId || '',
      apiSessionGeneration: this.binding?.sessionFingerprint || '',
      authorityTriple: baseline ? {
        stateVersion: baseline.stateVersion,
        operatingModeRevision: baseline.runtime.operatingModeRevision,
        lastEventSequence: baseline.lastEventSequence
      } : null,
      runtime: baseline ? clone(baseline.runtime) : null,
      capabilities: baseline ? clone(baseline.capabilities) : null,
      diagnosticsSummary: baseline ? clone(baseline.diagnosticsSummary) : null,
      mutationsBlocked: this.mutationsBlocked,
      polling: Boolean(this.pollTimer),
      metrics: { ...this.metrics },
      stopOperation: this._stopOperationSummary(),
      lastStopOperation: this.lastStopOperation ? clone(this.lastStopOperation) : null,
      lastFailure: this.lastFailure ? { ...this.lastFailure } : null
    });
  }
}

module.exports = { RuntimeProjectionCoordinator };
