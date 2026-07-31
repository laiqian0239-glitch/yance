'use strict';

const { randomUUID } = require('node:crypto');
const { assertCommandEnvelope } = require('../../shared/core/contracts');
const { normalizeCoreError, CoreError } = require('../../shared/core/errors');
const { AppRuntimeError } = require('./errors');
const { recordConstruction, snapshotConstructionCounts } = require('./RuntimeConstructionDiagnostics');
const { OperatingModeTransitionGateway } = require('./OperatingModeTransitionGateway');
const { RuntimeControlCommandGateway } = require('./RuntimeControlCommandGateway');
const { OPERATING_MODES, assertOperatingMode } = require('./OperatingMode');

const LOCAL_CRITICAL_WORKERS = Object.freeze([
  'runtime_state_worker',
  'transition_persistence_worker',
  'outbox_claim_coordinator',
  'diagnostics_worker',
  'lease_heartbeat_worker'
]);
const EXTERNAL_WORKERS = Object.freeze([
  'telegram_connector_worker',
  'facebook_connector_worker',
  'ai_provider_worker',
  'translation_provider_worker'
]);

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validateEnvelope(envelope) {
  const commandId = String(envelope?.commandId || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!isObject(envelope) || envelope.contractVersion !== 2 || !uuid.test(commandId) ||
      !String(envelope.commandType || '').trim() || !Number.isInteger(envelope.expectedStateVersion) ||
      !String(envelope.issuedAtUtc || '').trim() || Number.isNaN(Date.parse(envelope.issuedAtUtc)) || !isObject(envelope.payload)) {
    throw new AppRuntimeError('COMMAND_ENVELOPE_INVALID', 'Command envelope is malformed', { status: 400 });
  }
  return envelope;
}

class AppRuntime {
  constructor(options = {}) {
    recordConstruction('AppRuntime');
    this.ownership = options.ownership;
    this.store = options.store;
    this.lifecycle = options.lifecycle;
    this.buildId = String(options.buildId || '');
    this.onStopRequested = options.onStopRequested || (() => {});
    if (!this.ownership || !this.store || !this.lifecycle || !this.buildId) throw new TypeError('AppRuntime dependencies are required');
    this.workerClassification = Object.freeze({ localCritical: LOCAL_CRITICAL_WORKERS, externalAfterLocalReady: EXTERNAL_WORKERS });
    this.composition = null;
    this.productionServicesStarted = false;
    this.credentialHydration = options.credentialHydration || null;
    this.localCriticalWorkerState = Object.fromEntries(LOCAL_CRITICAL_WORKERS.map(name => [name, 'pending']));
    this.externalWorkerState = Object.fromEntries(EXTERNAL_WORKERS.map(name => [name, 'not_started']));
    this.externalWorkerStarters = options.externalWorkerStarters || {};
    this.externalWorkersPromise = null;
    this.appliedOperatingMode = '';
    this.appliedOperatingModeRevision = 0;
    this.runtimeControlGateway = new RuntimeControlCommandGateway({
      store: this.store,
      ownership: this.ownership,
      apply: (commandType, payload, context) => this._applyRuntimeControl(commandType, payload, context)
    });
    this.operatingModeGateway = new OperatingModeTransitionGateway({
      store: this.store,
      ownership: this.ownership,
      applyMode: (mode, context) => this._applyOperatingMode(mode, context),
      publishMode: (mode, context) => this._publishOperatingMode(mode, context)
    });
  }

  get state() { return this.lifecycle.state; }
  get operatingMode() { return this.store.snapshot().runtime.operatingMode; }

  async startLocalCriticalWorkers() {
    for (const name of LOCAL_CRITICAL_WORKERS) this.localCriticalWorkerState[name] = 'ready';
    return Object.freeze({ ...this.localCriticalWorkerState });
  }

  startExternalWorkersAfterLocalReady() {
    if (this.externalWorkersPromise) return this.externalWorkersPromise;
    this.externalWorkersPromise = Promise.all(EXTERNAL_WORKERS.map(async name => {
      const starter = this.externalWorkerStarters[name];
      try {
        if (typeof starter === 'function') {
          this.externalWorkerState[name] = 'starting';
          await starter();
          this.externalWorkerState[name] = 'online';
        } else {
          this.externalWorkerState[name] = 'no_accounts_configured';
        }
      } catch (_) {
        this.externalWorkerState[name] = 'temporarily_unavailable';
      }
      return { name, state: this.externalWorkerState[name] };
    })).then(async rows => {
      const capabilities = { ...this.store.snapshot().capabilities, ...Object.fromEntries(rows.map(row => [row.name, row.state])) };
      try {
        this.store.updateRuntimeState({
          ...this.ownership.guard(), patch: { capabilities }, eventType: 'runtime.external_capabilities_updated', eventPayload: { capabilities }
        });
      } catch (_) {}
      return rows;
    });
    return this.externalWorkersPromise;
  }

  credentialMetadata() {
    const value = this.credentialHydration;
    return value ? Object.freeze({ vaultEpoch: value.vaultEpoch, generation: value.generation, authorityEventId: value.authorityEventId || '', authorityHeadDigest: value.authorityHeadDigest || '', vaultReferenceCount: Number(value.vaultReferenceCount ?? value.entryCount ?? 0), decryptedEntryCount: Number(value.decryptedEntryCount ?? value.entryCount ?? 0), frameEntryCount: Number(value.frameEntryCount ?? value.entryCount ?? 0), entryCount: value.entryCount, payloadBytes: value.payloadBytes, restoredReferenceCount: Number(value.restoredReferenceCount ?? value.entryCount ?? 0) }) : null;
  }

  applyCredentialMutationMetadata(metadata = {}) {
    const current = this.credentialMetadata();
    if (!current || current.vaultEpoch !== String(metadata.vaultEpoch || '') || Number(metadata.generation) !== Number(current.generation) + 1 ||
        !String(metadata.authorityEventId || '') || !/^[0-9a-f]{64}$/.test(String(metadata.authorityHeadDigest || '')) ||
        !Number.isInteger(Number(metadata.entryCount)) || Number(metadata.entryCount) < 0 || Number(metadata.restoredReferenceCount ?? metadata.entryCount) !== Number(metadata.entryCount)) {
      throw new AppRuntimeError('CREDENTIAL_GENERATION_MISMATCH', 'AppRuntime credential metadata rejected an incomplete or non-monotonic authority mutation', { status: 409 });
    }
    this.credentialHydration = Object.freeze({
      vaultEpoch: current.vaultEpoch,
      generation: Number(metadata.generation),
      authorityEventId: String(metadata.authorityEventId || ''),
      authorityHeadDigest: String(metadata.authorityHeadDigest || current.authorityHeadDigest || ''),
      vaultReferenceCount: Number(metadata.entryCount || 0),
      decryptedEntryCount: Number(metadata.entryCount || 0),
      frameEntryCount: Number(metadata.entryCount || 0),
      entryCount: Number(metadata.entryCount || 0),
      payloadBytes: Number(metadata.payloadBytes || 0),
      restoredReferenceCount: Number(metadata.restoredReferenceCount ?? metadata.entryCount ?? 0)
    });
    return this.credentialMetadata();
  }

  restoreCredentialMutationMetadata(metadata = null) {
    if (!metadata) { this.credentialHydration = null; return null; }
    this.credentialHydration = Object.freeze({
      vaultEpoch: String(metadata.vaultEpoch || ''),
      generation: Number(metadata.generation || 0),
      authorityEventId: String(metadata.authorityEventId || ''),
      authorityHeadDigest: String(metadata.authorityHeadDigest || ''),
      vaultReferenceCount: Number(metadata.vaultReferenceCount ?? metadata.entryCount ?? 0),
      decryptedEntryCount: Number(metadata.decryptedEntryCount ?? metadata.entryCount ?? 0),
      frameEntryCount: Number(metadata.frameEntryCount ?? metadata.entryCount ?? 0),
      entryCount: Number(metadata.entryCount || 0),
      payloadBytes: Number(metadata.payloadBytes || 0),
      restoredReferenceCount: Number(metadata.restoredReferenceCount ?? metadata.entryCount ?? 0)
    });
    return this.credentialMetadata();
  }

  configureProductionServices() {
    if (!this.composition) {
      const { createAppRuntimeComposition } = require('./AppRuntimeComposition');
      this.composition = createAppRuntimeComposition(this);
    }
    return this.composition;
  }

  async startProductionServices() {
    const composition = this.configureProductionServices();
    if (this.productionServicesStarted) return this.productionServicesSnapshot();
    for (const row of composition.participants) {
      try { await row.service.prepare?.(); await row.service.start?.(); }
      catch (error) { if (row.critical) throw error; composition.logger.warn('runtime', 'non-critical-production-service-start-failed', { participant: row.name, code: error.code || '', error: error.message }); }
    }
    this.productionServicesStarted = true;
    const authority = this.store.snapshot();
    await this._applyOperatingMode(assertOperatingMode(authority.runtime.operatingMode), { reason: 'production-services-started', source: 'startup', stateVersion: authority.runtime.operatingModeRevision, currentStateVersion: authority.stateVersion, recovering: true });
    return this.productionServicesSnapshot();
  }

  async shutdownProductionServices() {
    if (!this.composition) return this.productionServicesSnapshot();
    for (const row of [...this.composition.participants].reverse()) {
      try { await row.service.stop?.(); } catch (_) {}
    }
    this.productionServicesStarted = false;
    return this.productionServicesSnapshot();
  }

  async _applyOperatingMode(operatingMode, context = {}) {
    const mode = assertOperatingMode(operatingMode, { source: context.source || 'gateway' });
    const composition = this.configureProductionServices();
    if (mode === OPERATING_MODES.SAFE_MODE) await composition.accountContext.enterSafeMode?.();
    else if (this.productionServicesStarted) await composition.accountContext.exitSafeMode?.();
    this.appliedOperatingMode = mode;
    this.appliedOperatingModeRevision = Number(context.stateVersion || this.store.snapshot().stateVersion);
    return { operatingMode: mode, appliedRevision: this.appliedOperatingModeRevision };
  }

  async _publishOperatingMode(operatingMode, context = {}) {
    const composition = this.configureProductionServices();
    composition.eventBus?.publish?.('runtime:operating-mode-authority', {
      operatingMode: assertOperatingMode(operatingMode),
      stateVersion: Number(context.stateVersion || this.store.snapshot().stateVersion),
      commandId: String(context.commandId || ''),
      recovering: context.recovering === true
    });
    return true;
  }

  reconcileOperatingMode() { return this.operatingModeGateway.reconcile(); }

  async _setOperatingMode(operatingMode, reason = '', options = {}) {
    return this.operatingModeGateway.transition({ targetMode: operatingMode, reason, source: options.source || 'internal', commandId: options.commandId, envelope: options.envelope });
  }

  async _applyRuntimeControl(commandType, payload = {}, context = {}) {
    const composition = this.configureProductionServices();
    if (commandType === 'runtime.setNetwork') {
      const online = payload.online !== false;
      if (online) await composition.accountContext.online?.(); else await composition.accountContext.offline?.();
      return {
        eventType: 'runtime.network_changed',
        eventPayload: { online, reason: String(payload.reason || ''), recovered: context.recovering === true },
        result: { online }
      };
    }
    if (commandType === 'runtime.suspend') {
      await composition.accountContext.pause?.();
      return {
        eventType: 'runtime.suspended',
        eventPayload: { reason: String(payload.reason || ''), recovered: context.recovering === true },
        result: { suspended: true }
      };
    }
    if (commandType === 'runtime.resume') {
      await composition.accountContext.resume?.();
      return {
        eventType: 'runtime.resumed',
        eventPayload: { reason: String(payload.reason || ''), recovered: context.recovering === true },
        result: { resumed: true }
      };
    }
    throw new AppRuntimeError('COMMAND_TYPE_UNSUPPORTED', `Unsupported runtime control command: ${commandType}`, { status: 400 });
  }

  setOnline(online, reason = 'internal-network-change') {
    const state = this.store.snapshot();
    return this.runtimeControlGateway.execute({
      contractVersion: 2,
      commandId: randomUUID(),
      commandType: 'runtime.setNetwork',
      expectedStateVersion: state.stateVersion,
      issuedAtUtc: new Date().toISOString(),
      payload: { online: online !== false, reason, source: 'internal-runtime-control' }
    });
  }

  suspend(reason = 'internal-suspend') {
    const state = this.store.snapshot();
    return this.runtimeControlGateway.execute({
      contractVersion: 2,
      commandId: randomUUID(),
      commandType: 'runtime.suspend',
      expectedStateVersion: state.stateVersion,
      issuedAtUtc: new Date().toISOString(),
      payload: { reason, source: 'internal-runtime-control' }
    });
  }

  resume(reason = 'internal-resume') {
    const state = this.store.snapshot();
    return this.runtimeControlGateway.execute({
      contractVersion: 2,
      commandId: randomUUID(),
      commandType: 'runtime.resume',
      expectedStateVersion: state.stateVersion,
      issuedAtUtc: new Date().toISOString(),
      payload: { reason, source: 'internal-runtime-control' }
    });
  }

  async enterSafeMode(reason = 'safe-mode', metadata = {}) {
    await this._setOperatingMode(OPERATING_MODES.SAFE_MODE, metadata.code || reason, { source: metadata.source || 'recovery' });
    return this.productionServicesSnapshot();
  }

  async exitSafeMode(reason = 'safe-mode-cleared') {
    await this._setOperatingMode(OPERATING_MODES.NORMAL, reason, { source: 'recovery' });
    return this.productionServicesSnapshot();
  }

  async beginUpdate() {
    const composition = this.configureProductionServices();
    await composition.accountContext.beforeUpdate?.();
    return this.productionServicesSnapshot();
  }

  productionServicesSnapshot() {
    const c = this.composition;
    return {
      runtimeAuthority: 'AppRuntime',
      lifecycleAuthority: 'LifecycleStateMachine',
      started: this.productionServicesStarted,
      state: this.state,
      operatingMode: this.operatingMode,
      appliedOperatingMode: this.appliedOperatingMode,
      appliedOperatingModeRevision: this.appliedOperatingModeRevision,
      participants: c ? c.participants.map(row => ({ name: row.name, critical: row.critical, snapshot: row.service.snapshot?.() || null })) : [],
      constructionCounts: snapshotConstructionCounts()
    };
  }

  snapshot() {
    const state = this.store.snapshot();
    return {
      contractVersion: 2,
      buildId: this.buildId,
      stateVersion: state.stateVersion,
      lastEventSequence: state.lastEventSequence,
      generatedAtUtc: new Date().toISOString(),
      runtime: state.runtime,
      capabilities: state.capabilities,
      diagnosticsSummary: state.diagnosticsSummary,
      workerClassification: this.workerClassification,
      credentialHydration: this.credentialMetadata(),
      localCriticalWorkers: { ...this.localCriticalWorkerState },
      externalWorkers: { ...this.externalWorkerState }
    };
  }

  executeCommand(input) {
    const envelope = validateEnvelope(input);
    const supported = new Set([
      'runtime.ping',
      'runtime.setOperatingMode',
      'runtime.stop',
      'runtime.setNetwork',
      'runtime.suspend',
      'runtime.resume'
    ]);
    if (!supported.has(envelope.commandType)) throw new AppRuntimeError('COMMAND_TYPE_UNSUPPORTED', `Unsupported commandType: ${envelope.commandType}`, { status: 400 });
    if (envelope.commandType === 'runtime.setOperatingMode') {
      const operatingMode = assertOperatingMode(envelope.payload.operatingMode, { source: 'api-v2' });
      return this._setOperatingMode(operatingMode, envelope.payload.reason || 'api-v2-command', { source: 'api-v2', commandId: envelope.commandId, envelope });
    }
    if (['runtime.setNetwork', 'runtime.suspend', 'runtime.resume'].includes(envelope.commandType)) {
      return this.runtimeControlGateway.execute(envelope);
    }
    const response = this.store.executeCommand({
      ...this.ownership.guard(), envelope,
      execute: () => {
        if (envelope.commandType === 'runtime.ping') return { eventType: 'runtime.command_ping', eventPayload: { commandId: envelope.commandId }, result: { pong: true } };
        return { patch: { lifecycleState: 'stopping', localReady: false }, eventType: 'runtime.stop_requested', eventPayload: { commandId: envelope.commandId }, result: { stopRequested: true } };
      }
    });
    if (!response.duplicate && envelope.commandType === 'runtime.stop') queueMicrotask(() => this.onStopRequested('api-v2-command'));
    return response;
  }

  async executeBusinessCommand(input) {
    const composition = this.configureProductionServices();
    const envelope = assertCommandEnvelope(input);
    const correlationId = String(envelope.context.correlationId || randomUUID());
    const context = { ...envelope.context, correlationId, actor: envelope.context.actor || 'api-client' };
    const started = Date.now();
    const operationId = composition.productionDiagnostics?.beginOperation?.({ correlationId, command: envelope.command, actor: context.actor, lifecycleState: this.state });
    try {
      let result;
      if (envelope.command.startsWith('account.') || envelope.command.startsWith('message.')) result = await composition.accountContext.execute(envelope.command, envelope.payload, context);
      else if (envelope.command === 'lifecycle.getState') result = this.productionServicesSnapshot();
      else if (['lifecycle.setNetwork', 'lifecycle.suspend', 'lifecycle.resume', 'lifecycle.enterSafeMode', 'lifecycle.exitSafeMode', 'recovery.enterSafeMode', 'recovery.clearSafeMode'].includes(envelope.command)) {
        throw new CoreError('RUNTIME_CONTROL_API_V2_REQUIRED', `Runtime control command must use /api/app/v2/commands: ${envelope.command}`, { status: 409 });
      }
      else if (envelope.command === 'security.getState') result = composition.securityGuard.snapshot();
      else if (envelope.command === 'update.getRuntimeBlockers') result = composition.updateManager.snapshot();
      else if (envelope.command === 'update.preflight') result = await composition.updateManager.preflight(context);
      else if (envelope.command === 'update.prepareInstall') result = await composition.updateManager.prepareInstall(context);
      else if (envelope.command.startsWith('recovery.')) result = await composition.recoveryManager.execute(envelope.command, envelope.payload, context);
      else throw new CoreError('CORE_COMMAND_NOT_IMPLEMENTED', `核心命令尚未实现：${envelope.command}`, { status: 501 });
      const response = { ok: true, command: envelope.command, correlationId, durationMs: Date.now() - started, result };
      composition.eventBus?.publish?.('core:command-completed', { command: envelope.command, correlationId, durationMs: response.durationMs });
      composition.productionDiagnostics?.completeOperation?.(operationId, { ok: true, lifecycleState: this.state, metadata: { durationMs: response.durationMs } });
      return response;
    } catch (error) {
      const normalized = normalizeCoreError(error);
      composition.logger?.warn?.('core', 'core-command-failed', { command: envelope.command, correlationId, code: normalized.code, error: normalized.message });
      composition.eventBus?.publish?.('core:command-failed', { command: envelope.command, correlationId, code: normalized.code, error: normalized.message });
      composition.productionDiagnostics?.completeOperation?.(operationId, { ok: false, lifecycleState: this.state, code: normalized.code, message: normalized.message });
      normalized.correlationId = correlationId;
      throw normalized;
    }
  }

  reconcileRuntimeControlCommands() { return this.runtimeControlGateway.reconcile(); }
  events(afterSequence, limit) { return { contractVersion: 2, buildId: this.buildId, ...this.store.listEvents(afterSequence, limit) }; }

  injectWp7ProbeEventGap(afterSequence) {
    const formal = ['FINAL_WINDOWS', 'PRE_REVIEW_PACKAGED_INTEGRATION'].includes(String(process.env.WP7_PROBE_EXECUTION_CLASS || '').trim());
    if (!formal || String(process.env.WP7_PROBE_ID || '').trim() !== 'event-gap-recovery') {
      throw new AppRuntimeError('WP7_PROBE_OPERATION_FORBIDDEN', 'event-gap injection is available only to the formal isolated event-gap probe', { status: 404 });
    }
    return this.store.injectWp7ProbeEventGap(afterSequence);
  }
  enqueueOutbox(eventType, payload) { return this.store.enqueueOutbox({ ...this.ownership.guard(), eventType, payload }); }
  claimOutbox() { return this.store.claimOutbox(this.ownership.guard()); }
  acknowledgeOutbox(eventId) { return this.store.acknowledgeOutbox({ ...this.ownership.guard(), eventId }); }
  retryOutbox(eventId, error, availableAtUtc) { return this.store.retryOutbox({ ...this.ownership.guard(), eventId, error, availableAtUtc }); }
}

module.exports = { AppRuntime, EXTERNAL_WORKERS, LOCAL_CRITICAL_WORKERS, validateEnvelope };
