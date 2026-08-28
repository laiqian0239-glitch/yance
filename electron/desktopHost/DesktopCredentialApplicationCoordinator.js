'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { mutationSha256 } = require('../../shared/credentialCustodyProtocol');
const {
  STATES,
  transitionDesktopCredentialApplication
} = require('../../shared/desktopCredentialApplicationStateMachine');
const { atomicWriteJsonAsync, closeAsync, existsAsync, fileSyncAsync, openAsync, readFileTextAsync, unlinkAsync } = require('./asyncDurability');

const JOURNAL_SCHEMA_VERSION = 3;
const CONTAINMENT_SENTINEL_SCHEMA_VERSION = 1;
const APPLICATION_BUSY = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_BUSY_RETRY';
const APPLICATION_UNAVAILABLE = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_UNAVAILABLE';
const APPLICATION_READY_MISMATCH = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH';
const APPLICATION_STOP_UNCHANGED_MISMATCH = 'WP4_DESKTOP_CREDENTIAL_STOP_FAILURE_AUTHORITY_CHANGED';
const APPLICATION_CONTAINMENT_ACTIVE = 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT';
const APPLICATION_CONTAINMENT_RELEASE_BLOCKED = 'WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RELEASE_BLOCKED';
const REJECTED_OWNER_CLEANUP_FAILED = 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CLEANUP_FAILED';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function makeError(reasonCode, message, detail = {}) {
  const error = new Error(message || reasonCode);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  Object.assign(error, detail);
  return error;
}
async function atomicWriteJson(file, value, fsApi = fs, phaseHook = null, platform = process.platform) {
  await atomicWriteJsonAsync(file, value, { fsApi, phaseHook, platform });
}

class DesktopCredentialApplicationCoordinator {
  constructor(options = {}) {
    if (!options.desktopHost) throw new TypeError('DesktopCredentialApplicationCoordinator requires DesktopHost');
    if (typeof options.startBackend !== 'function' || typeof options.stopBackend !== 'function') {
      throw new TypeError('DesktopCredentialApplicationCoordinator requires startBackend and stopBackend callbacks');
    }
    this.desktopHost = options.desktopHost;
    this.vaultHost = options.vaultHost || options.desktopHost.credentialVaultHost;
    if (!this.vaultHost) throw new TypeError('DesktopCredentialApplicationCoordinator requires CredentialVaultHost');
    this.startBackendCallback = options.startBackend;
    this.stopBackendCallback = options.stopBackend;
    this.backendSnapshot = options.backendSnapshot || (() => this.desktopHost.snapshot().backend);
    this.waitForOwnerExitRecovery = options.waitForOwnerExitRecovery || (child => this.desktopHost.waitForBackendOwnerExitRecovery(child));
    this.getOwnedBackendChild = options.getOwnedBackendChild || (() => this.desktopHost.backendProcessHost?.getOwnedChild?.() || null);
    this.validateRuntimeProjection = options.validateRuntimeProjection || null;
    this.isShutdownPending = options.isShutdownPending || (() => false);
    this.isProcessAlive = options.isProcessAlive || (pid => {
      const value = Number(pid || 0);
      if (!Number.isInteger(value) || value < 1) return false;
      try { process.kill(value, 0); return true; }
      catch (cause) { return cause?.code !== 'ESRCH'; }
    });
    this.clock = options.clock || (() => new Date().toISOString());
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.fs = options.fs || fs;
    this.platform = options.platform || process.platform;
    this.log = options.log || (() => {});
    this.persistenceFaultInjector = options.persistenceFaultInjector || null;
    this.containmentCrashInjector = options.containmentCrashInjector || null;
    this.failStopApplication = options.failStopApplication || (() => {});
    this.automaticStartupContainmentRecovery = options.automaticStartupContainmentRecovery === true;
    this.operation = Promise.resolve();
    this.pendingOperations = 0;
    this.activeLeaseToken = null;
    this.currentOperation = null;
    this.lastResult = null;
    this.lastFailure = null;
    this.interruptedOperation = null;
    this.containment = null;
    this.containmentSentinel = null;
    this.failStopRequired = false;
    this.persistenceFailures = [];
    this.expectedExitChildren = new WeakMap();
    const metadataPath = this.vaultHost.metadataPath || path.join(process.cwd(), 'vault-meta.json');
    this.journalPath = path.resolve(options.journalPath || path.join(path.dirname(metadataPath), 'desktop-credential-application-lifecycle.json'));
    this.containmentSentinelPath = path.resolve(options.containmentSentinelPath || path.join(path.dirname(metadataPath), 'desktop-credential-application-containment.json'));
    this.lifecycle = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      state: STATES.UNINITIALIZED,
      reasonCode: '',
      operationId: '',
      operationType: '',
      requestId: '',
      mutationCommitted: false,
      updatedAtUtc: this.clock(),
      stateHistory: []
    };
    this._initPromise = null;
    this._initialized = false;
    this.desktopHost.setCredentialApplicationCoordinator?.(this);
  }

  async initialize() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      await this._loadJournal();
      await this._loadContainmentSentinel();
      if (this.lifecycle.state === STATES.UNINITIALIZED) await this._transition(STATES.IDLE, 'constructed');
      await this._restorePersistentContainment();
      this._initialized = true;
    })();
    return this._initPromise;
  }

  async _loadJournal() {
    try {
      const text = await readFileTextAsync(this.journalPath, this.fs);
      if (text === null) return;
      const parsed = JSON.parse(text);
      if (!parsed || ![1, 2, JOURNAL_SCHEMA_VERSION].includes(Number(parsed.schemaVersion || 0)) || !parsed.lifecycle) return;
      this.lifecycle = {
        ...this.lifecycle,
        ...parsed.lifecycle,
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        stateHistory: Array.isArray(parsed.lifecycle.stateHistory) ? parsed.lifecycle.stateHistory.slice(-250) : []
      };
      this.lastResult = parsed.lastResult || null;
      this.lastFailure = parsed.lastFailure || null;
      this.containment = parsed.containment ? clone(parsed.containment) : null;
      const persistedOperation = clone(parsed.currentOperation || parsed.interruptedOperation || null);
      const containmentState = this._containmentStates().includes(this.lifecycle.state);
      const stable = [STATES.IDLE, STATES.STOPPED, STATES.FAILED_SAFE, STATES.UNAVAILABLE, ...this._containmentStates()];
      if (!stable.includes(this.lifecycle.state) || (persistedOperation && !containmentState)) {
        this.interruptedOperation = persistedOperation || {
          operationId: this.lifecycle.operationId,
          operationType: this.lifecycle.operationType,
          requestId: this.lifecycle.requestId,
          mutationCommitted: this.lifecycle.mutationCommitted === true
        };
        this.currentOperation = null;
        const recoveredFromState = this.lifecycle.state;
        this.lifecycle.state = STATES.FAILED_SAFE;
        this.lifecycle.reasonCode = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_INTERRUPTED';
        this.lifecycle.mutationCommitted = this.interruptedOperation?.mutationCommitted === true;
        this.lifecycle.updatedAtUtc = this.clock();
        this.lifecycle.stateHistory.push({
          state: STATES.FAILED_SAFE,
          atUtc: this.lifecycle.updatedAtUtc,
          reasonCode: this.lifecycle.reasonCode,
          recoveredFromState,
          mutationCommitted: this.lifecycle.mutationCommitted
        });
      } else if (containmentState && !this.containment) {
        const backendPid = this._lastKnownContainedBackendPid();
        this.containment = {
          schemaVersion: JOURNAL_SCHEMA_VERSION,
          containmentId: this.randomUUID(),
          active: true,
          state: this.lifecycle.state,
          rejectionReasonCode: this.lifecycle.reasonCode || APPLICATION_READY_MISMATCH,
          cleanupReasonCode: REJECTED_OWNER_CLEANUP_FAILED,
          backendPid,
          childStillLive: backendPid > 0,
          engagedAtUtc: this.clock(),
          updatedAtUtc: this.clock()
        };
      }
      await this._persist();
    } catch (cause) {
      this.lifecycle.state = STATES.UNAVAILABLE;
      this.lifecycle.reasonCode = APPLICATION_UNAVAILABLE;
      this.lastFailure = { atUtc: this.clock(), reasonCode: APPLICATION_UNAVAILABLE, message: cause.message };
    }
  }

  _persistencePhase(kind) {
    return (phase, detail) => this.persistenceFaultInjector?.({ kind, phase, ...detail });
  }

  _containmentCrashPoint(phase, detail = {}) {
    this.containmentCrashInjector?.({ phase, atUtc: this.clock(), ...clone(detail) });
  }

  _recordPersistenceFailure(kind, cause, detail = {}) {
    const failure = {
      atUtc: this.clock(),
      kind,
      reasonCode: cause?.reasonCode || cause?.code || 'WP4_DESKTOP_CREDENTIAL_CONTAINMENT_PERSISTENCE_FAILED',
      message: cause?.message || String(cause || 'persistence failed'),
      ...clone(detail)
    };
    this.persistenceFailures.push(failure);
    if (this.persistenceFailures.length > 50) this.persistenceFailures.shift();
    return failure;
  }

  async _loadContainmentSentinel() {
    try {
      const text = await readFileTextAsync(this.containmentSentinelPath, this.fs);
      if (text === null) return;
      const parsed = JSON.parse(text);
      if (!parsed || Number(parsed.schemaVersion || 0) !== CONTAINMENT_SENTINEL_SCHEMA_VERSION) {
        throw makeError('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_INVALID', 'Containment sentinel schema is invalid');
      }
      this.containmentSentinel = parsed;
      if (parsed.active === true && parsed.fenceReleaseAuthorized !== true) {
        this.containment = { ...(this.containment || {}), ...clone(parsed.containment || {}), active: true, sentinelDurable: true };
      }
    } catch (cause) {
      const failure = this._recordPersistenceFailure('containment-sentinel-load', cause);
      this.failStopRequired = true;
      this.containmentSentinel = {
        schemaVersion: CONTAINMENT_SENTINEL_SCHEMA_VERSION,
        active: true,
        corrupted: true,
        fenceReleaseAuthorized: false,
        failure,
        updatedAtUtc: this.clock()
      };
      this.containment = {
        ...(this.containment || {}),
        active: true,
        enforcementEstablished: false,
        sentinelDurable: false,
        cleanupReasonCode: failure.reasonCode,
        persistenceFailure: failure,
        updatedAtUtc: this.clock()
      };
    }
  }

  async _persistContainmentSentinel(reason = '') {
    const containment = clone(this.containment || {});
    const value = {
      schemaVersion: CONTAINMENT_SENTINEL_SCHEMA_VERSION,
      active: containment.active === true,
      containmentId: containment.containmentId || '',
      backendPid: Number(containment.backendPid || 0),
      rejectionReasonCode: containment.rejectionReasonCode || '',
      cleanupReasonCode: containment.cleanupReasonCode || '',
      enforcementFacts: clone(containment.enforcementFacts || {}),
      fenceReleaseAuthorized: containment.enforcementFacts?.fenceReleaseAuthorized === true,
      failStopRequired: this.failStopRequired === true,
      reason,
      containment,
      updatedAtUtc: this.clock()
    };
    await atomicWriteJson(this.containmentSentinelPath, value, this.fs, this._persistencePhase('containment-sentinel'), this.platform);
    this.containmentSentinel = value;
    if (this.containment) this.containment.sentinelDurable = true;
    return value;
  }

  async _clearContainmentSentinel() {
    if (!(await existsAsync(this.containmentSentinelPath, this.fs))) {
      this.containmentSentinel = null;
      return true;
    }
    this.persistenceFaultInjector?.({ kind: 'containment-sentinel-remove', phase: 'unlink', file: this.containmentSentinelPath });
    await unlinkAsync(this.containmentSentinelPath, this.fs);
    let directory = null;
    try {
      directory = await openAsync(path.dirname(this.containmentSentinelPath), 'r', undefined, this.fs);
      this.persistenceFaultInjector?.({ kind: 'containment-sentinel-remove', phase: 'directory-fsync', file: this.containmentSentinelPath });
      await fileSyncAsync(directory, 'directory', this.platform);
    } finally {
      await closeAsync(directory);
    }
    this.containmentSentinel = null;
    return true;
  }

  async _persist() {
    await atomicWriteJson(this.journalPath, {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      updatedAtUtc: this.clock(),
      lifecycle: clone(this.lifecycle),
      currentOperation: clone(this.currentOperation),
      interruptedOperation: clone(this.interruptedOperation),
      containment: clone(this.containment),
      containmentSentinel: clone(this.containmentSentinel),
      failStopRequired: this.failStopRequired === true,
      persistenceFailures: clone(this.persistenceFailures),
      lastResult: clone(this.lastResult),
      lastFailure: clone(this.lastFailure)
    }, this.fs, this._persistencePhase('lifecycle-journal'), this.platform);
  }

  _containmentStates() {
    return [
      STATES.REJECTED_OWNER_TERMINATION_PENDING,
      STATES.REJECTED_OWNER_STILL_LIVE,
      STATES.FATAL_OWNER_CONTAINMENT
    ];
  }

  _lastKnownContainedBackendPid() {
    const direct = Number(this.containment?.backendPid || 0);
    if (direct > 0) return direct;
    const history = Array.isArray(this.lifecycle?.stateHistory) ? this.lifecycle.stateHistory : [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index] || {};
      if (!this._containmentStates().includes(entry.state)) continue;
      const backendPid = Number(entry.backendPid || 0);
      if (backendPid > 0) return backendPid;
    }
    return 0;
  }

  _requestFailStop(reasonCode, detail = {}) {
    this.failStopRequired = true;
    const payload = {
      atUtc: this.clock(),
      reasonCode: String(reasonCode || 'WP4_DESKTOP_CREDENTIAL_FATAL_CONTAINMENT'),
      coordinatorState: this.lifecycle.state,
      containment: clone(this.containment),
      applicationFence: this.vaultHost.applicationFenceSnapshot?.() || null,
      ...clone(detail)
    };
    try { this.failStopApplication(payload); } catch (cause) {
      this._recordPersistenceFailure('fail-stop-callback', cause, { requestedReasonCode: payload.reasonCode });
    }
    return payload;
  }

  isRejectedOwnerContainmentActive() {
    const backend = this._backend();
    const facts = this.containment?.enforcementFacts || {};
    const provisionalReadyOwner = backend.ownerTrusted === false &&
      !backend.rejectedOwner &&
      !backend.ownerRegistryFailure &&
      backend.ownerRegistry?.state === 'RUNNING' &&
      backend.ownerRegistry?.ownershipActive === true &&
      backend.ownerRegistry?.trusted === false &&
      backend.ownerRegistry?.reasonCode === 'BACKEND_READY_AWAITING_APPLICATION_VALIDATION';
    return Boolean(
      this.failStopRequired === true ||
      this.containmentSentinel?.active === true ||
      this.containment?.active === true && (
        this.containment?.enforcementEstablished === true ||
        facts.backendOwnerRevoked === true ||
        facts.fd6Closed === true && facts.applicationFenceInstalled === true
      ) ||
      this.vaultHost.applicationFenceSnapshot?.() ||
      backend.rejectedOwner ||
      backend.ownerTrusted === false && !provisionalReadyOwner ||
      backend.ownerRegistryFailure
    );
  }

  _verifyRejectedOwnerEnforcement(marker = null) {
    const backend = this._backend();
    const fence = this.vaultHost.applicationFenceSnapshot?.() || null;
    const facts = {
      containmentIntentCreated: true,
      backendOwnerRevoked: backend.ownerTrusted === false && Boolean(backend.rejectedOwner || marker),
      apiAuthorityRevoked: backend.apiSessionEstablished !== true && marker?.apiAuthorityRevoked !== false,
      fd6Closed: backend.credentialCustody?.dedicatedPipeActive !== true && marker?.fd6Closed !== false,
      applicationFenceInstalled: Boolean(fence),
      ownerRecordDurable: marker?.ownerRecordDurable === true || backend.ownerRegistry?.state === 'REJECTED',
      containmentJournalDurable: false,
      containmentSentinelDurable: false,
      terminationRequested: false,
      realChildExitConfirmed: false,
      ownerRecoveryCompleted: false,
      fenceReleaseAuthorized: false,
      verifiedAtUtc: this.clock()
    };
    facts.enforcementEstablished = facts.backendOwnerRevoked && facts.apiAuthorityRevoked && facts.fd6Closed && facts.applicationFenceInstalled;
    return { facts, backend, fence };
  }

  async _establishRejectedOwnerEnforcement(cause, options = {}) {
    const backend = this._backend();
    const authority = this.vaultHost.snapshotMetadata?.() || {};
    const existing = this.containment || {};
    const rejectionReasonCode = String(cause?.reasonCode || cause?.code || existing.rejectionReasonCode || APPLICATION_READY_MISMATCH);
    const containmentId = String(existing.containmentId || this.containmentSentinel?.containmentId || this.randomUUID());
    const backendPid = Number(backend.backendPid || backend.rejectedOwner?.backendPid || existing.backendPid || this.containmentSentinel?.backendPid || 0);

    this.containment = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      containmentId,
      active: true,
      enforcementEstablished: false,
      state: this.lifecycle.state,
      rejectionReasonCode,
      cleanupReasonCode: String(options.cleanupReasonCode || existing.cleanupReasonCode || ''),
      backendPid,
      childStillLive: true,
      ownerSession: clone(existing.ownerSession || authority.activeOwnerSession || backend.ownerContext || backend.ownerRegistry?.ownerSession || null),
      enforcementFacts: {
        containmentIntentCreated: true,
        backendOwnerRevoked: false,
        apiAuthorityRevoked: false,
        fd6Closed: false,
        applicationFenceInstalled: false,
        ownerRecordDurable: false,
        containmentJournalDurable: false,
        containmentSentinelDurable: false,
        terminationRequested: false,
        realChildExitConfirmed: false,
        ownerRecoveryCompleted: false,
        fenceReleaseAuthorized: false
      },
      engagedAtUtc: String(existing.engagedAtUtc || this.clock()),
      updatedAtUtc: this.clock()
    };

    let marker = null;
    this._containmentCrashPoint('before-backend-owner-revocation', { backendPid, containmentId, rejectionReasonCode });
    try {
      marker = this.desktopHost.containRejectedBackendOwner?.({
        backendPid,
        startupNonce: backend.startupNonce,
        backendSessionId: backend.backendSessionId,
        fd6PipeInstanceId: backend.fd6PipeInstanceId,
        reasonCode: rejectionReasonCode,
        persistOwnerRecord: false
      }) || null;
    } catch (containCause) {
      this._recordPersistenceFailure('backend-owner-enforcement', containCause);
    }
    this._containmentCrashPoint('after-backend-owner-revocation', { backendPid, containmentId, marker: clone(marker) });

    let fence = null;
    this._containmentCrashPoint('before-application-fence', { backendPid, containmentId });
    try {
      fence = this.vaultHost.setApplicationFence?.({
        containmentId,
        reasonCode: APPLICATION_CONTAINMENT_ACTIVE,
        rejectionReasonCode,
        cleanupReasonCode: this.containment.cleanupReasonCode,
        coordinatorState: STATES.REJECTED_OWNER_TERMINATION_PENDING,
        backendPid,
        ownerSession: this.containment.ownerSession,
        retryable: true,
        fatal: options.fatal === true
      }) || this.vaultHost.applicationFenceSnapshot?.() || null;
    } catch (fenceCause) {
      this._recordPersistenceFailure('application-fence-enforcement', fenceCause);
    }
    this._containmentCrashPoint('after-application-fence', { backendPid, containmentId, fence: clone(fence) });

    const verified = this._verifyRejectedOwnerEnforcement(marker);
    this.containment.backendPid = Number(marker?.backendPid || verified.backend.backendPid || backendPid || 0);
    this.containment.childStillLive = Boolean(marker?.childStillLive === true || verified.backend.ownershipPresent === true || Number(verified.backend.backendPid || 0) > 0);
    this.containment.ownerSession = clone(this.containment.ownerSession || verified.backend.ownerContext || verified.backend.ownerRegistry?.ownerSession || null);
    this.containment.enforcementFacts = verified.facts;
    this.containment.enforcementEstablished = verified.facts.enforcementEstablished;
    this.containment.fd6Closed = verified.facts.fd6Closed;
    this.containment.ownerTrusted = !verified.facts.backendOwnerRevoked;
    this.containment.updatedAtUtc = this.clock();

    if (!verified.facts.enforcementEstablished) {
      const error = makeError('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_ENFORCEMENT_INCOMPLETE', 'Rejected owner safety enforcement could not be fully established', { facts: verified.facts, backend: verified.backend, fence });
      this.containment.cleanupReasonCode = error.reasonCode;
      this._requestFailStop(error.reasonCode, { facts: verified.facts });
      throw error;
    }

    this._containmentCrashPoint('after-enforcement-before-owner-record', { backendPid: this.containment.backendPid, containmentId });
    try {
      marker = await this.desktopHost.persistRejectedBackendOwner?.({
        backendPid: this.containment.backendPid,
        reasonCode: rejectionReasonCode,
        ownerSession: this.containment.ownerSession
      }) || marker;
      this.containment.enforcementFacts.ownerRecordDurable = marker?.ownerRecordDurable === true || this._backend().ownerRegistry?.state === 'REJECTED';
    } catch (ownerRecordCause) {
      const failure = this._recordPersistenceFailure('backend-owner-record-write', ownerRecordCause, { backendPid: this.containment.backendPid });
      this.containment.persistenceFailure = failure;
      this.containment.enforcementFacts.ownerRecordDurable = false;
    }
    this._containmentCrashPoint('after-owner-record-before-sentinel', { backendPid: this.containment.backendPid, containmentId, ownerRecordDurable: this.containment.enforcementFacts.ownerRecordDurable });

    this._containmentCrashPoint('after-enforcement-before-sentinel', { backendPid: this.containment.backendPid, containmentId });
    let sentinelDurable = false;
    try {
      await this._persistContainmentSentinel('enforcement-established-before-lifecycle-journal');
      this.containment.enforcementFacts.containmentSentinelDurable = true;
      this.containment.sentinelDurable = true;
      sentinelDurable = true;
    } catch (sentinelCause) {
      const failure = this._recordPersistenceFailure('containment-sentinel-write', sentinelCause, { backendPid: this.containment.backendPid });
      this.containment.persistenceFailure = failure;
      this.containment.enforcementFacts.containmentSentinelDurable = false;
      this.containment.sentinelDurable = false;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });
    }
    if (sentinelDurable) this._containmentCrashPoint('after-sentinel-before-lifecycle-journal', { backendPid: this.containment.backendPid, containmentId });
    return clone(this.containment);
  }

  async _recordContainmentState(state, reasonCode, detail = {}) {
    transitionDesktopCredentialApplication(this.lifecycle, state, this.clock, reasonCode, detail);
    this.containment.state = state;
    this.containment.updatedAtUtc = this.clock();
    this.containment.enforcementFacts.containmentJournalDurable = true;
    try {
      await this._persist();
      try { await this._persistContainmentSentinel(`lifecycle-${state}-durable`); } catch (sentinelCause) {
        this.containment.enforcementFacts.containmentSentinelDurable = false;
        const failure = this._recordPersistenceFailure('containment-sentinel-update', sentinelCause, { state });
        this.containment.persistenceFailure = failure;
        this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });
      }
      this.log('desktop-credential-application-state', { state, reasonCode, ...detail, enforcementFacts: clone(this.containment.enforcementFacts) });
      return true;
    } catch (journalCause) {
      this.containment.enforcementFacts.containmentJournalDurable = false;
      const failure = this._recordPersistenceFailure('containment-lifecycle-journal-write', journalCause, { state, backendPid: this.containment.backendPid });
      this.containment.persistenceFailure = failure;
      this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.lifecycle.reasonCode = failure.reasonCode;
      this.lifecycle.updatedAtUtc = this.clock();
      this.containment.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.containment.cleanupReasonCode = failure.reasonCode;
      this.vaultHost.setApplicationFence?.({
        containmentId: this.containment.containmentId,
        reasonCode: APPLICATION_CONTAINMENT_ACTIVE,
        rejectionReasonCode: this.containment.rejectionReasonCode,
        cleanupReasonCode: failure.reasonCode,
        coordinatorState: STATES.FATAL_OWNER_CONTAINMENT,
        backendPid: this.containment.backendPid,
        ownerSession: this.containment.ownerSession,
        retryable: false,
        fatal: true
      });
      try { await this._persistContainmentSentinel('lifecycle-journal-write-failed'); } catch (sentinelCause) {
        this._recordPersistenceFailure('containment-sentinel-after-journal-failure', sentinelCause, { state });
      }
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_JOURNAL_WRITE_FAILED', { failure });
      return false;
    }
  }

  async _restorePersistentContainment() {
    const backend = this._backend();
    const recoveryIntent = Boolean(
      this.containment?.active === true ||
      this.containmentSentinel?.active === true ||
      this._containmentStates().includes(this.lifecycle.state) ||
      this.vaultHost.applicationFenceSnapshot?.() ||
      backend.rejectedOwner ||
      backend.ownerTrusted === false ||
      backend.ownerRegistryFailure
    );
    if (!recoveryIntent) return false;

    const reason = makeError(
      this.containment?.rejectionReasonCode || this.lifecycle.reasonCode || APPLICATION_CONTAINMENT_ACTIVE,
      'Restoring rejected owner containment from durable or owner-registry evidence'
    );
    try {
      await this._establishRejectedOwnerEnforcement(reason, { fatal: true, cleanupReasonCode: this.containment?.cleanupReasonCode || '' });
      this.failStopRequired = this.containmentSentinel?.failStopRequired === true ||
        this.containment?.active === true ||
        this._containmentStates().includes(this.lifecycle.state);
    } catch (enforcementCause) {
      this.failStopRequired = true;
      this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.lifecycle.reasonCode = enforcementCause.reasonCode || APPLICATION_CONTAINMENT_ACTIVE;
      this.lifecycle.updatedAtUtc = this.clock();
      return true;
    }
    if (!this._containmentStates().includes(this.lifecycle.state)) {
      this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.lifecycle.reasonCode = APPLICATION_CONTAINMENT_ACTIVE;
      this.lifecycle.updatedAtUtc = this.clock();
      this.lifecycle.stateHistory.push({ state: STATES.FATAL_OWNER_CONTAINMENT, atUtc: this.lifecycle.updatedAtUtc, reasonCode: APPLICATION_CONTAINMENT_ACTIVE, restored: true, backendPid: this.containment.backendPid });
    }
    this.containment.state = this.lifecycle.state;
    try {
      this.containment.enforcementFacts.containmentJournalDurable = true;
      await this._persist();
    } catch (cause) {
      this.containment.enforcementFacts.containmentJournalDurable = false;
      const failure = this._recordPersistenceFailure('containment-restore-journal', cause);
      this.containment.persistenceFailure = failure;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RESTORE_PERSIST_FAILED', { failure });
    }
    return true;
  }

  _failedSafeResetBoundary() {
    const backend = this._backend();
    const authority = this.vaultHost.snapshotMetadata?.() || {};
    const fd6Active = backend.credentialCustody?.dedicatedPipeActive === true;
    const backendPid = Number(backend.backendPid || backend.rejectedOwner?.backendPid || (this.containment?.active ? this.containment.backendPid : 0) || 0);
    const rejectedOwnerLive = this.desktopHost.isRejectedBackendOwnerLive?.() === true ||
      backend.rejectedOwner?.childStillLive === true ||
      this._persistedContainmentPidLive();
    const safe = !this.isRejectedOwnerContainmentActive() &&
      !this._backendOwned() &&
      backendPid === 0 &&
      backend.ownerTrusted !== false &&
      !backend.rejectedOwner &&
      !rejectedOwnerLive &&
      !fd6Active &&
      !authority.activeOwnerSession &&
      !authority.pendingOwnerSession &&
      !authority.activeTransactionId &&
      Number(authority.pendingOperations || 0) === 0 &&
      authority.available === true &&
      authority.lifecycle?.state === 'ACTIVE';
    return {
      safe,
      backendOwned: this._backendOwned(),
      backendPid,
      rejectedOwnerLive,
      ownerTrusted: backend.ownerTrusted !== false,
      fd6Active,
      activeOwnerSession: clone(authority.activeOwnerSession),
      pendingOwnerSession: clone(authority.pendingOwnerSession),
      activeTransactionId: authority.activeTransactionId || '',
      pendingOperations: Number(authority.pendingOperations || 0),
      authorityAvailable: authority.available === true,
      authorityState: authority.lifecycle?.state || ''
    };
  }

  _assertFailedSafeResettable() {
    const boundary = this._failedSafeResetBoundary();
    if (!boundary.safe) {
      throw makeError('WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED', 'FAILED_SAFE cannot return to IDLE while backend ownership, FD6, owner sessions, transactions or authority recovery remain unresolved', { boundary, retryable: true });
    }
    return boundary;
  }

  _containmentError(message = 'A rejected backend owner may still be live') {
    const fatal = this.lifecycle.state === STATES.FATAL_OWNER_CONTAINMENT;
    return makeError(APPLICATION_CONTAINMENT_ACTIVE, message, {
      retryable: !fatal,
      fatal,
      containment: clone(this.containment),
      applicationFence: this.vaultHost.applicationFenceSnapshot?.() || null
    });
  }

  async _transition(state, reasonCode = '', detail = {}) {
    transitionDesktopCredentialApplication(this.lifecycle, state, this.clock, reasonCode, detail);
    await this._persist();
    this.log('desktop-credential-application-state', {
      state,
      reasonCode,
      operationId: this.lifecycle.operationId,
      operationType: this.lifecycle.operationType,
      requestId: this.lifecycle.requestId,
      ...detail
    });
  }

  async _begin(operationType, options = {}) {
    const containmentRecovery = operationType === 'APPLICATION_SHUTDOWN' || operationType === 'BACKEND_EXIT_RECOVERY' || options.allowContainmentRecovery === true;
    if (this.isRejectedOwnerContainmentActive() && !containmentRecovery) throw this._containmentError();
    if (this.lifecycle.state === STATES.FAILED_SAFE && !containmentRecovery) this._assertFailedSafeResettable();
    const operationId = String(options.operationId || this.randomUUID());
    const requestId = String(options.requestId || '');
    this.currentOperation = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      operationId,
      operationType,
      requestId,
      mutationSha256: String(options.mutationSha256 || ''),
      mutationCommitted: false,
      startedAtUtc: this.clock(),
      updatedAtUtc: this.clock(),
      baselineAuthority: null,
      committedAuthority: null
    };
    this.lifecycle.operationId = operationId;
    this.lifecycle.operationType = operationType;
    this.lifecycle.requestId = requestId;
    this.lifecycle.mutationCommitted = false;
    if ([STATES.FAILED_SAFE, STATES.STOPPED, STATES.NEW_OWNER_READY].includes(this.lifecycle.state)) {
      if (this.lifecycle.state === STATES.FAILED_SAFE && !containmentRecovery) this._assertFailedSafeResettable();
      if (!this.isRejectedOwnerContainmentActive()) await this._transition(STATES.IDLE, 'operation-begin-reset');
    }
    await this._persist();
    return this.currentOperation;
  }

  async _complete(result, finalState = STATES.IDLE) {
    if (this.isRejectedOwnerContainmentActive()) throw this._containmentError('Contained rejected owner prevents operation success');
    this.lastResult = { ...clone(result), atUtc: this.clock(), operationId: this.currentOperation?.operationId || '' };
    this.lastFailure = null;
    if (this.lifecycle.state !== finalState) await this._transition(finalState, 'operation-complete');
    if (finalState !== STATES.IDLE) await this._transition(STATES.IDLE, 'coordinator-idle');
    this.currentOperation = null;
    this.lifecycle.operationId = '';
    this.lifecycle.operationType = '';
    this.lifecycle.requestId = '';
    this.lifecycle.mutationCommitted = false;
    this.interruptedOperation = null;
    await this._persist();
    return result;
  }

  async _fail(cause, detail = {}) {
    const reasonCode = cause?.reasonCode || cause?.code || APPLICATION_UNAVAILABLE;
    const containmentActive = this.isRejectedOwnerContainmentActive();
    this.lastFailure = {
      atUtc: this.clock(),
      reasonCode,
      message: cause?.message || String(cause || reasonCode),
      operationId: this.currentOperation?.operationId || '',
      operationType: this.currentOperation?.operationType || '',
      requestId: this.currentOperation?.requestId || '',
      mutationCommitted: this.currentOperation?.mutationCommitted === true,
      containmentActive,
      ...clone(detail)
    };
    if (containmentActive) {
      this.lifecycle.reasonCode = this.containment?.cleanupReasonCode || reasonCode || APPLICATION_CONTAINMENT_ACTIVE;
      if (!this._containmentStates().includes(this.lifecycle.state)) this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.lifecycle.updatedAtUtc = this.clock();
    } else {
      const unavailable = this.vaultHost.snapshotMetadata?.().available === false && reasonCode !== APPLICATION_BUSY;
      const target = unavailable ? STATES.UNAVAILABLE : STATES.FAILED_SAFE;
      if (this.lifecycle.state !== target && this.lifecycle.state !== STATES.UNAVAILABLE) {
        try { await this._transition(target, reasonCode, detail); }
        catch (_) {
          this.lifecycle.state = target;
          this.lifecycle.reasonCode = reasonCode;
          this.lifecycle.updatedAtUtc = this.clock();
        }
      }
    }
    await this._persist();
    return cause;
  }

  _enqueue(operationType, work) {
    this.pendingOperations += 1;
    const next = this.operation.catch(() => {}).then(async () => {
      await this.initialize();
      if (this.lifecycle.state === STATES.UNAVAILABLE) throw makeError(APPLICATION_UNAVAILABLE, 'Desktop credential application lifecycle is unavailable');
      return work();
    });
    this.operation = next.catch(() => {});
    return next.finally(() => { this.pendingOperations = Math.max(0, this.pendingOperations - 1); });
  }

  _assertOperationMayContinue(options = {}, phase = '') {
    if (options.forShutdown === true || options.allowDuringShutdown === true) return;
    if (!this.isShutdownPending()) return;
    throw makeError('WP4_DESKTOP_CREDENTIAL_APPLICATION_SHUTDOWN_PENDING', `Desktop credential application operation was cancelled by application shutdown (${phase || 'unspecified'})`, { phase });
  }

  async _acquireLease(operation) {
    if (this.activeLeaseToken) throw makeError(APPLICATION_BUSY, 'Desktop credential application lease is already held', { retryable: true });
    await this.vaultHost.initialize();
    const token = await this.vaultHost.acquireApplicationLease({
      operationId: operation.operationId,
      operationType: operation.operationType,
      requestId: operation.requestId
    });
    this.activeLeaseToken = token;
    if (!this.isRejectedOwnerContainmentActive() && this.lifecycle.state !== STATES.FAILED_SAFE) {
      await this._transition(STATES.LEASE_ACQUIRED, '', { operationId: operation.operationId });
    }
    return token;
  }

  async _releaseLease(token) {
    if (!token) return false;
    const fence = this.vaultHost.applicationFenceSnapshot?.() || null;
    if ((this.failStopRequired === true || this.containment?.active === true) && !fence) {
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_LEASE_RELEASE_WITHOUT_FENCE_BLOCKED', { containment: clone(this.containment) });
      return false;
    }
    const released = await this.vaultHost.releaseApplicationLease(token);
    if (released !== false && this.activeLeaseToken === token) this.activeLeaseToken = null;
    return released;
  }

  _authorityBoundary() {
    if (typeof this.vaultHost.snapshotAuthorityBoundary === 'function') return this.vaultHost.snapshotAuthorityBoundary();
    const snapshot = this.vaultHost.snapshotMetadata();
    return {
      vaultEpoch: snapshot.vaultEpoch,
      generation: snapshot.generation,
      authorityEventId: snapshot.authorityEventId,
      authorityHeadDigest: snapshot.authorityHeadDigest,
      referenceCount: snapshot.referenceCount,
      journalTransactionCount: snapshot.journalTransactionCount
    };
  }

  _sameBoundary(left, right) {
    const fields = ['vaultEpoch', 'generation', 'vaultDigest', 'authorityEventId', 'authorityHeadDigest', 'referenceCount', 'journalTransactionCount'];
    return fields.every(field => left?.[field] === right?.[field]);
  }

  _assertBoundaryUnchanged(before, reasonCode = APPLICATION_STOP_UNCHANGED_MISMATCH) {
    const after = this._authorityBoundary();
    if (!this._sameBoundary(before, after)) {
      throw makeError(reasonCode, 'Credential authority changed even though backend stop was not confirmed', { before, after });
    }
    return after;
  }

  _backend() { return this.backendSnapshot() || {}; }
  _backendOwned() {
    const backend = this._backend();
    return backend.ownershipPresent === true || backend.startupPending === true || backend.shutdownPending === true || Number(backend.backendPid || 0) > 0 || ['STARTING', 'RUNNING', 'STOPPING'].includes(String(backend.state || ''));
  }

  _assertOwnerReleased() {
    const authority = this.vaultHost.snapshotMetadata();
    const backend = this._backend();
    const blocked = authority.activeOwnerSession || authority.pendingOwnerSession || authority.activeTransactionId || authority.pendingOperations > 0;
    if (blocked || authority.lifecycle?.state !== 'ACTIVE' || authority.available !== true) {
      throw makeError('WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED', 'Credential authority did not reach an owner-free ACTIVE boundary', { authority, backend });
    }
    if (this._backendOwned()) {
      throw makeError('DESKTOP_BACKEND_OWNERSHIP_RETAINED', 'Backend ownership remains after confirmed stop', { backend });
    }
    return authority;
  }

  _backendChildLive(child = this.getOwnedBackendChild()) {
    if (!child) return false;
    const backend = this._backend();
    const expectedPid = Number(this.containment?.backendPid || backend.rejectedOwner?.backendPid || backend.backendPid || 0);
    const childPid = Number(child.pid || 0);
    if (expectedPid > 0 && childPid > 0 && expectedPid !== childPid) return false;
    return child.__desktopHostExited !== true && child.exitCode == null;
  }

  _persistedContainmentPidLive() {
    const backend = this._backend();
    if (backend.rejectedOwner?.pidIdentityMatch === false || backend.ownerRegistry?.state === 'EXITED' || backend.ownerRegistry?.state === 'RECOVERED') return false;
    return Boolean(
      backend.rejectedOwner?.childStillLive === true ||
      this.containment?.childStillLive === true ||
      backend.ownerRegistry?.ownershipActive === true
    );
  }

  async _backendChildLiveAsync(child = this.getOwnedBackendChild()) {
    if (this._backendChildLive(child)) return true;
    const backend = this._backend();
    if (backend.rejectedOwner?.pidIdentityMatch === false || backend.ownerRegistry?.state === 'EXITED' || backend.ownerRegistry?.state === 'RECOVERED') return false;
    const host = this.desktopHost.backendProcessHost;
    if (typeof host?.isRejectedOwnerLiveAsync === 'function') return await host.isRejectedOwnerLiveAsync();
    return this._persistedContainmentPidLive();
  }

  async _persistedContainmentPidLiveAsync() {
    const backend = this._backend();
    if (backend.rejectedOwner?.pidIdentityMatch === false || backend.ownerRegistry?.state === 'EXITED' || backend.ownerRegistry?.state === 'RECOVERED') return false;
    const host = this.desktopHost.backendProcessHost;
    if (typeof host?.isRejectedOwnerLiveAsync === 'function') return await host.isRejectedOwnerLiveAsync();
    return this._persistedContainmentPidLive();
  }

  async _engageRejectedOwnerContainment(cause, options = {}) {
    if (!this.containment?.enforcementEstablished) {
      return await this._establishRejectedOwnerEnforcement(cause, options);
    }
    const cleanupReasonCode = String(options.cleanupReasonCode || this.containment.cleanupReasonCode || '');
    this.containment.cleanupReasonCode = cleanupReasonCode;
    this.containment.stopResult = clone(options.stopResult || this.containment.stopResult || null);
    this.containment.updatedAtUtc = this.clock();
    if (options.fatal === true) this.failStopRequired = true;
    this.vaultHost.setApplicationFence?.({
      containmentId: this.containment.containmentId,
      reasonCode: APPLICATION_CONTAINMENT_ACTIVE,
      rejectionReasonCode: this.containment.rejectionReasonCode,
      cleanupReasonCode,
      coordinatorState: options.fatal === true ? STATES.FATAL_OWNER_CONTAINMENT : this.lifecycle.state,
      backendPid: this.containment.backendPid,
      ownerSession: this.containment.ownerSession,
      retryable: options.fatal !== true,
      fatal: options.fatal === true
    });
    try { await this._persistContainmentSentinel(options.fatal === true ? 'fatal-containment-refresh' : 'containment-refresh'); }
    catch (cause2) {
      const failure = this._recordPersistenceFailure('containment-sentinel-refresh', cause2);
      this.containment.persistenceFailure = failure;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });
    }
    return clone(this.containment);
  }

  async _markRejectedOwnerStillLive(cleanupCause, stopResult = null) {
    const cleanupReasonCode = String(cleanupCause?.reasonCode || cleanupCause?.code || REJECTED_OWNER_CLEANUP_FAILED);
    await this._engageRejectedOwnerContainment(cleanupCause, { cleanupReasonCode, stopResult, fatal: true });
    const childLive = await this._backendChildLiveAsync();
    const persistedPidLive = await this._persistedContainmentPidLiveAsync();
    this.containment.childStillLive = Boolean(childLive || persistedPidLive || this._backendOwned());
    this.containment.cleanupReasonCode = cleanupReasonCode;
    this.containment.stopResult = clone(stopResult);
    this.containment.enforcementFacts.terminationRequested = true;
    this.containment.enforcementFacts.realChildExitConfirmed = false;
    this.containment.enforcementFacts.ownerRecoveryCompleted = false;
    this.containment.enforcementFacts.fenceReleaseAuthorized = false;
    if (this.lifecycle.state === STATES.REJECTED_OWNER_TERMINATION_PENDING) {
      await this._recordContainmentState(STATES.REJECTED_OWNER_STILL_LIVE, cleanupReasonCode, { backendPid: this.containment.backendPid });
    }
    if (this.lifecycle.state !== STATES.FATAL_OWNER_CONTAINMENT) {
      await this._recordContainmentState(STATES.FATAL_OWNER_CONTAINMENT, cleanupReasonCode, { backendPid: this.containment.backendPid });
    }
    this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
    this.lifecycle.reasonCode = cleanupReasonCode;
    this.lifecycle.updatedAtUtc = this.clock();
    this.containment.state = STATES.FATAL_OWNER_CONTAINMENT;
    this.containment.updatedAtUtc = this.clock();
    this.vaultHost.setApplicationFence?.({
      containmentId: this.containment.containmentId,
      reasonCode: APPLICATION_CONTAINMENT_ACTIVE,
      rejectionReasonCode: this.containment.rejectionReasonCode,
      cleanupReasonCode,
      coordinatorState: STATES.FATAL_OWNER_CONTAINMENT,
      backendPid: this.containment.backendPid,
      ownerSession: this.containment.ownerSession,
      retryable: false,
      fatal: true
    });
    try { await this._persistContainmentSentinel('rejected-owner-still-live'); }
    catch (cause2) {
      const failure = this._recordPersistenceFailure('containment-sentinel-still-live', cause2);
      this.containment.persistenceFailure = failure;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });
    }
    return clone(this.containment);
  }

  async _assertRejectedOwnerTerminated() {
    const backend = this._backend();
    const authority = this.vaultHost.snapshotMetadata?.() || {};
    const childLive = await this._backendChildLiveAsync();
    const persistedPidLive = await this._persistedContainmentPidLiveAsync();
    const fd6Active = backend.credentialCustody?.dedicatedPipeActive === true;
    const blocked = childLive || persistedPidLive || this._backendOwned() || fd6Active ||
      authority.activeOwnerSession || authority.pendingOwnerSession || authority.activeTransactionId || Number(authority.pendingOperations || 0) > 0 ||
      authority.available !== true || authority.lifecycle?.state !== 'ACTIVE';
    if (blocked) {
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Rejected owner containment cannot be released before real child exit and owner recovery', {
        childLive,
        persistedPidLive,
        backend,
        activeOwnerSession: clone(authority.activeOwnerSession),
        pendingOwnerSession: clone(authority.pendingOwnerSession),
        activeTransactionId: authority.activeTransactionId || '',
        pendingOperations: Number(authority.pendingOperations || 0),
        authorityAvailable: authority.available === true,
        authorityState: authority.lifecycle?.state || ''
      });
    }
    const facts = this.containment?.enforcementFacts || {};
    if (facts.applicationFenceInstalled !== true || facts.backendOwnerRevoked !== true || facts.fd6Closed !== true) {
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Containment enforcement facts are incomplete and cannot authorize fence release', { facts, backend });
    }
    if (facts.containmentSentinelDurable !== true && facts.ownerRecordDurable !== true) {
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'No durable rejected-owner discovery record exists; fail-stop containment cannot be released', { facts, backend });
    }
    return { backend, authority, childLive, persistedPidLive };
  }

  async _resolveRejectedOwnerContainment(child = null, options = {}) {
    if (child) {
      const recovery = await this.waitForOwnerExitRecovery(child);
      if (recovery?.recovered !== true) {
        throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Rejected owner exit was observed without completed owner recovery', { recovery, backendPid: Number(child?.pid || 0) });
      }
    }
    const boundary = await this._assertRejectedOwnerTerminated();
    const facts = this.containment.enforcementFacts;
    facts.realChildExitConfirmed = true;
    facts.ownerRecoveryCompleted = true;
    facts.terminationRequested = true;
    facts.fenceReleaseAuthorized = false;
    this.containment.childStillLive = false;
    this.containment.updatedAtUtc = this.clock();

    try {
      await this._persistContainmentSentinel('owner-exit-and-recovery-confirmed-before-release');
      facts.containmentSentinelDurable = true;
    } catch (cause) {
      const failure = this._recordPersistenceFailure('containment-pre-release-sentinel', cause);
      this.containment.persistenceFailure = failure;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RELEASE_PERSIST_FAILED', { failure });
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Cannot release containment because pre-release facts are not durable', { failure });
    }

    if (this._containmentStates().includes(this.lifecycle.state)) {
      if (!await this._recordContainmentState(STATES.OWNER_EXIT_CONFIRMED, 'rejected-owner-exit-confirmed', { backendPid: Number(this.containment?.backendPid || child?.pid || 0) })) {
        throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Lifecycle journal did not durably record rejected owner exit', { containment: clone(this.containment) });
      }
      if (!await this._recordContainmentState(STATES.OWNER_RECOVERING, 'rejected-owner-recovery-complete')) {
        throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Lifecycle journal did not durably record owner recovery', { containment: clone(this.containment) });
      }
    }

    await this.desktopHost.clearRejectedBackendOwner?.({ force: false });
    const backendAfterMarkerClear = this._backend();
    if (backendAfterMarkerClear.rejectedOwner || backendAfterMarkerClear.ownerTrusted === false || backendAfterMarkerClear.ownerRegistryFailure) {
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Rejected owner marker was not safely cleared', { backend: backendAfterMarkerClear });
    }

    facts.rejectedOwnerMarkerCleared = true;
    facts.fenceReleaseAuthorized = true;
    this.containment.updatedAtUtc = this.clock();
    try {
      await this._persistContainmentSentinel('fence-release-authorized');
      facts.containmentSentinelDurable = true;
    } catch (cause) {
      facts.fenceReleaseAuthorized = false;
      const failure = this._recordPersistenceFailure('containment-release-authorization-sentinel', cause);
      this.containment.persistenceFailure = failure;
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RELEASE_PERSIST_FAILED', { failure });
      throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Fence release authorization could not be durably recorded', { failure });
    }

    this.vaultHost.clearApplicationFence?.({ force: false });
    facts.applicationFenceInstalled = false;
    const resolved = clone(this.containment);
    this.containment = resolved ? {
      ...resolved,
      active: false,
      enforcementEstablished: false,
      childStillLive: false,
      resolvedAtUtc: this.clock(),
      updatedAtUtc: this.clock()
    } : null;
    this.failStopRequired = false;
    const target = options.finalState || STATES.FAILED_SAFE;
    if (this.lifecycle.state !== target) await this._transition(target, 'rejected-owner-containment-resolved');
    try { await this._clearContainmentSentinel(); }
    catch (cause) {
      this._recordPersistenceFailure('containment-sentinel-remove', cause, { releaseAuthorized: true });
    }
    await this._persist();
    return { recovered: true, containment: clone(this.containment), boundary };
  }

  async _recoverContainmentIfOwnerExited(options = {}) {
    if (typeof this.vaultHost.initialize === 'function') {
      await this.vaultHost.initialize();
    }
    await this.initialize();
    if (!this.isRejectedOwnerContainmentActive()) return { recovered: false, notRequired: true };
    const child = this.getOwnedBackendChild();
    let childLive = await this._backendChildLiveAsync(child);
    let persistedPidLive = await this._persistedContainmentPidLiveAsync();
    if (!childLive && !persistedPidLive && this._backendOwned()) {
      const stopped = await this.stopBackendCallback({
        ...options,
        reason: options.reason || 'reconcile-exited-rejected-owner'
      });
      if (stopped?.stopped !== true || stopped?.exitConfirmed !== true) throw this._containmentError();
      childLive = await this._backendChildLiveAsync(child);
      persistedPidLive = await this._persistedContainmentPidLiveAsync();
    }
    if (childLive || persistedPidLive || this._backendOwned()) throw this._containmentError();
    return this._resolveRejectedOwnerContainment(child, options);
  }

  async _recoverContainmentForStartup(token, options = {}) {
    if (!this.isRejectedOwnerContainmentActive()) return { recovered: false, notRequired: true };
    const child = this.getOwnedBackendChild();
    const childLive = await this._backendChildLiveAsync(child);
    const persistedPidLive = await this._persistedContainmentPidLiveAsync();
    const liveOrOwned = Boolean(childLive || persistedPidLive || this._backendOwned());
    this.log('desktop-credential-startup-containment-recovery', {
      liveOrOwned,
      backendPid: Number(this.containment?.backendPid || this._backend().backendPid || child?.pid || 0)
    });
    if (liveOrOwned) {
      return this._attemptContainedOwnerStop(token, {
        ...options,
        reason: 'automatic-startup-rejected-owner-recovery',
        forceProcessCustody: true
      });
    }
    return this._recoverContainmentIfOwnerExited({ finalState: STATES.FAILED_SAFE });
  }

  async _attemptContainedOwnerStop(token, options = {}) {
    const child = this.getOwnedBackendChild();
    let result;
    try {
      result = await this.stopBackendCallback({ ...options, reason: options.reason || 'rejected-owner-containment-shutdown', applicationLeaseToken: token });
      if (result?.stopped !== true || result?.exitConfirmed !== true) {
        throw makeError(result?.reasonCode || 'DESKTOP_BACKEND_EXIT_NOT_CONFIRMED', 'Contained rejected owner could not be stopped', { stopped: result });
      }
      return this._resolveRejectedOwnerContainment(child, { finalState: STATES.STOPPED });
    } catch (cause) {
      await this._markRejectedOwnerStillLive(cause, result);
      throw this._containmentError('Rejected backend owner remains live after containment stop attempt');
    }
  }

  async _stopAndRecover(token, options = {}) {
    const before = this._authorityBoundary();
    this.currentOperation.baselineAuthority = clone(before);
    this.currentOperation.updatedAtUtc = this.clock();
    await this._persist();
    if (!this._backendOwned()) {
      await this._transition(STATES.OWNER_EXIT_CONFIRMED, 'backend-not-owned');
      await this._transition(STATES.OWNER_RECOVERING, 'owner-recovery-not-required');
      this._assertOwnerReleased();
      return { stopped: true, exitConfirmed: true, alreadyStopped: true, authority: this._authorityBoundary() };
    }
    const child = this.getOwnedBackendChild();
    if (child && typeof child === 'object') {
      this.expectedExitChildren.set(child, {
        operationId: this.currentOperation?.operationId || '',
        operationType: this.currentOperation?.operationType || '',
        registeredAtUtc: this.clock()
      });
    }
    await this._transition(STATES.OWNER_STOPPING, '', { backendPid: Number(this._backend().backendPid || 0) });
    let result;
    try {
      result = await this.stopBackendCallback({ ...options, applicationLeaseToken: token });
    } catch (cause) {
      if (child && !child.__desktopHostExited && child.exitCode == null) this.expectedExitChildren.delete(child);
      this._assertBoundaryUnchanged(before);
      throw cause;
    }
    if (result?.stopped !== true || result?.exitConfirmed !== true) {
      this._assertBoundaryUnchanged(before);
      throw makeError(result?.reasonCode || 'DESKTOP_BACKEND_EXIT_NOT_CONFIRMED', 'Desktop credential lifecycle requires a real backend exit before authority mutation', { result });
    }
    await this._transition(STATES.OWNER_EXIT_CONFIRMED, '', { backendPid: Number(result.backendPid || 0), forced: result.forced === true });
    await this._transition(STATES.OWNER_RECOVERING, 'owner-exit-recovery');
    this._assertOwnerReleased();
    return { ...result, authority: this._authorityBoundary() };
  }

  _assertReady(expectedAuthority = null) {
    const backend = this._backend();
    const authority = this.vaultHost.snapshotMetadata();
    const owner = authority.activeOwnerSession;
    const custody = backend.credentialCustody || {};
    const failures = [];
    if (this.isRejectedOwnerContainmentActive()) failures.push('application-containment-active');
    const provisionalReadyOwner = backend.ownerTrusted === false &&
      !backend.rejectedOwner &&
      !backend.ownerRegistryFailure &&
      backend.ownerRegistry?.state === 'RUNNING' &&
      backend.ownerRegistry?.ownershipActive === true &&
      backend.ownerRegistry?.trusted === false &&
      backend.ownerRegistry?.reasonCode === 'BACKEND_READY_AWAITING_APPLICATION_VALIDATION';
    if ((backend.ownerTrusted === false && !provisionalReadyOwner) || backend.rejectedOwner) failures.push('backend-owner-rejected');
    if (authority.applicationFence) failures.push('authority-application-fenced');
    if (backend.state !== 'RUNNING' || backend.running !== true || Number(backend.backendPid || 0) < 1) failures.push('backend-not-running');
    if (backend.credentialHydrated !== true) failures.push('credential-not-hydrated');
    if (custody.dedicatedPipeActive !== true) failures.push('fd6-not-active');
    if (!owner || authority.pendingOwnerSession) failures.push('owner-session-not-active');
    if (authority.activeTransactionId || authority.pendingOperations > 0) failures.push('authority-busy');
    if (authority.available !== true || authority.lifecycle?.state !== 'ACTIVE') failures.push('authority-not-active');
    if (Number(backend.credentialGeneration || 0) !== Number(authority.generation || 0)) failures.push('generation-mismatch');
    if (String(backend.credentialVaultEpoch || '') !== String(authority.vaultEpoch || '')) failures.push('vault-epoch-mismatch');
    if (String(backend.credentialAuthorityEventId || '') !== String(authority.authorityEventId || '')) failures.push('authority-event-mismatch');
    if (String(backend.credentialAuthorityHeadDigest || '') !== String(authority.authorityHeadDigest || '')) failures.push('authority-digest-mismatch');
    if (Number(backend.credentialVaultReferenceCount ?? -1) !== Number(authority.referenceCount ?? -2)) failures.push('reference-count-mismatch');
    if (Number(backend.credentialDecryptedEntryCount ?? -1) !== Number(authority.decryptedEntryCount ?? -2)) failures.push('decrypted-count-mismatch');
    if (owner) {
      if (Number(owner.backendPid || 0) !== Number(backend.backendPid || 0)) failures.push('owner-pid-mismatch');
      if (String(owner.startupNonce || '') !== String(backend.startupNonce || '')) failures.push('owner-startup-nonce-mismatch');
      if (String(owner.backendSessionId || '') !== String(backend.backendSessionId || '')) failures.push('owner-session-id-mismatch');
      if (String(owner.fd6PipeInstanceId || '') !== String(backend.fd6PipeInstanceId || '')) failures.push('owner-fd6-instance-mismatch');
      if (Number(owner.hydrationGeneration || 0) !== Number(backend.credentialGeneration || 0)) failures.push('owner-generation-mismatch');
    }
    const readyMetadata = backend.readyCredentialMetadata || {};
    const exactReadyFields = [
      ['vaultEpoch', authority.vaultEpoch],
      ['generation', Number(authority.generation || 0)],
      ['authorityEventId', authority.authorityEventId],
      ['authorityHeadDigest', authority.authorityHeadDigest],
      ['vaultReferenceCount', Number(authority.referenceCount || 0)],
      ['decryptedEntryCount', Number(authority.decryptedEntryCount || 0)],
      ['frameEntryCount', Number(authority.decryptedEntryCount || 0)],
      ['entryCount', Number(authority.decryptedEntryCount || 0)],
      ['restoredReferenceCount', Number(authority.decryptedEntryCount || 0)]
    ];
    for (const [field, expected] of exactReadyFields) {
      const actual = readyMetadata[field];
      if (typeof expected === 'number' ? Number(actual) !== expected : String(actual || '') !== String(expected || '')) failures.push(`ready-${field}-mismatch`);
    }
    const custodyOwner = custody.ownerContext || {};
    if (Object.keys(custodyOwner).length) {
      if (Number(custodyOwner.backendPid || 0) !== Number(backend.backendPid || 0)) failures.push('fd6-owner-pid-mismatch');
      if (String(custodyOwner.startupNonce || '') !== String(backend.startupNonce || '')) failures.push('fd6-owner-startup-nonce-mismatch');
      if (String(custodyOwner.backendSessionId || '') !== String(backend.backendSessionId || '')) failures.push('fd6-owner-session-id-mismatch');
      if (String(custodyOwner.fd6PipeInstanceId || '') !== String(backend.fd6PipeInstanceId || '')) failures.push('fd6-owner-instance-mismatch');
      if (Number(custodyOwner.hydrationGeneration || 0) !== Number(backend.credentialGeneration || 0)) failures.push('fd6-owner-generation-mismatch');
    }
    if (expectedAuthority) {
      const actual = this._authorityBoundary();
      if (actual.vaultEpoch !== expectedAuthority.vaultEpoch) failures.push('expected-vaultEpoch-mismatch');
      if (actual.vaultDigest !== expectedAuthority.vaultDigest) failures.push('expected-vaultDigest-mismatch');
      if (actual.referenceCount !== expectedAuthority.referenceCount) failures.push('expected-referenceCount-mismatch');
      if (actual.journalTransactionCount !== expectedAuthority.journalTransactionCount) failures.push('expected-journalTransactionCount-mismatch');
      if (Number(actual.generation) !== Number(expectedAuthority.generation) + 1) failures.push('expected-hydration-generation-mismatch');
    }
    if (failures.length) throw makeError(APPLICATION_READY_MISMATCH, 'New backend owner did not satisfy the credential application READY boundary', { failures, backend, authority, expectedAuthority });
    return { backend, authority };
  }

  _assertRuntimeProjection(projection, ready) {
    if (!projection || typeof projection !== 'object') throw makeError(APPLICATION_READY_MISMATCH, 'Backend runtime projection validation did not return a projection');
    const authority = ready.authority;
    const runtime = projection.credentialMetadata || {};
    const sqlite = projection.sqliteCredentialMetadata || {};
    const security = projection.security || {};
    const secureBridge = projection.secureBridge || {};
    const failures = [];
    const same = (actual, expected) => typeof expected === 'number' ? Number(actual) === expected : String(actual || '') === String(expected || '');
    for (const row of [
      ['runtime-vaultEpoch', runtime.vaultEpoch, authority.vaultEpoch],
      ['runtime-generation', runtime.generation, Number(authority.generation || 0)],
      ['runtime-authorityEventId', runtime.authorityEventId, authority.authorityEventId],
      ['runtime-authorityHeadDigest', runtime.authorityHeadDigest, authority.authorityHeadDigest],
      ['runtime-referenceCount', runtime.restoredReferenceCount, Number(authority.referenceCount || 0)],
      ['sqlite-vaultEpoch', sqlite.vaultEpoch, authority.vaultEpoch],
      ['sqlite-generation', sqlite.generation, Number(authority.generation || 0)],
      ['sqlite-authorityEventId', sqlite.authorityEventId, authority.authorityEventId],
      ['sqlite-authorityHeadDigest', sqlite.authorityHeadDigest, authority.authorityHeadDigest],
      ['sqlite-referenceCount', sqlite.referenceCount, Number(authority.referenceCount || 0)],
      ['security-referenceCount', security.credentialRefs, Number(authority.referenceCount || 0)],
      ['secureBridge-referenceCount', secureBridge.credentialRefs, Number(authority.referenceCount || 0)]
    ]) if (!same(row[1], row[2])) failures.push(row[0]);
    if (sqlite.hydrated !== true) failures.push('sqlite-not-hydrated');
    if (security.secureStorageAvailable !== true) failures.push('security-custody-unavailable');
    if (secureBridge.available !== true) failures.push('secureBridge-custody-unavailable');
    if (secureBridge.pendingCandidates !== 0) failures.push('secureBridge-pending-candidates');
    if (failures.length) throw makeError(APPLICATION_READY_MISMATCH, 'SQLite, AppRuntime and SecureBridge did not converge on the new credential authority', { failures, projection, authority });
    return projection;
  }

  async _resolveRejectedOwnerAfterConcurrentExit(child, cause, stopped, options = {}) {
    const graceMs = Math.max(0, Math.min(5000, Number(options.concurrentExitGraceMs ?? 1000)));
    const deadline = Date.now() + graceMs;
    const childExited = () => Boolean(!child || child.__desktopHostExited === true || child.exitCode != null);

    while (child && !childExited() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (child && !childExited()) return null;

    let recovery = { recovered: true, notRequired: true };
    if (child) {
      recovery = await this.waitForOwnerExitRecovery(child);
      if (recovery?.recovered !== true) return null;
    }

    const childLive = await this._backendChildLiveAsync(child);
    const persistedPidLive = await this._persistedContainmentPidLiveAsync();
    if (childLive || persistedPidLive || this._backendOwned()) return null;

    const resolved = await this._resolveRejectedOwnerContainment(child, { finalState: STATES.FAILED_SAFE });
    const cleanupReasonCode = String(stopped?.reasonCode || cause?.cleanupReasonCode || REJECTED_OWNER_CLEANUP_FAILED);
    return {
      stopped: stopped?.stopped === true,
      exitConfirmed: true,
      childStillLive: false,
      ownerReleased: true,
      applicationFenceActive: false,
      fd6Closed: true,
      ownerTrusted: true,
      coordinatorState: this.lifecycle.state,
      failStopRequired: false,
      containmentResolved: true,
      recoveredAfterConcurrentExit: true,
      cleanupReasonCode,
      result: clone(stopped),
      recovery: clone(recovery),
      resolved: clone(resolved)
    };
  }

  async _cleanupRejectedNewOwner(token, cause, options = {}) {
    const child = this.getOwnedBackendChild();
    if (child && typeof child === 'object') {
      this.expectedExitChildren.set(child, {
        operationId: this.currentOperation?.operationId || '',
        operationType: this.currentOperation?.operationType || '',
        registeredAtUtc: this.clock(),
        rejectedReady: true
      });
    }

    let enforcementError = null;
    try { await this._establishRejectedOwnerEnforcement(cause); }
    catch (caught) { enforcementError = caught; }

    let journalDurable = false;
    if (!enforcementError) {
      journalDurable = await this._recordContainmentState(
        STATES.REJECTED_OWNER_TERMINATION_PENDING,
        cause?.reasonCode || APPLICATION_READY_MISMATCH,
        { backendPid: Number(this.containment?.backendPid || this._backend().backendPid || 0), enforcementEstablished: true }
      );
    }

    let stopped = null;
    try {
      if (enforcementError) throw enforcementError;
      this.containment.enforcementFacts.terminationRequested = true;
      try { await this._persistContainmentSentinel('termination-requested'); }
      catch (sentinelCause) {
        const failure = this._recordPersistenceFailure('containment-termination-sentinel', sentinelCause);
        this.containment.persistenceFailure = failure;
        this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });
      }
      if (this._backendOwned()) {
        stopped = await this.stopBackendCallback({
          ...options,
          reason: 'new-owner-readiness-rejected',
          applicationLeaseToken: token
        });
        if (stopped?.stopped !== true || stopped?.exitConfirmed !== true) {
          throw makeError(stopped?.reasonCode || 'DESKTOP_BACKEND_EXIT_NOT_CONFIRMED', 'Rejected backend owner could not be stopped', { stopped });
        }
      }
      if (!journalDurable) {
        throw makeError('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_JOURNAL_WRITE_FAILED', 'Rejected owner was enforced, but lifecycle journal durability failed; normal recovery is forbidden in this process', { stopped, failStopRequired: true });
      }
      const resolved = await this._resolveRejectedOwnerContainment(child, { finalState: STATES.FAILED_SAFE });
      cause.rejectedOwnerCleanup = {
        stopped: true,
        exitConfirmed: true,
        ownerReleased: true,
        applicationFenceActive: false,
        containmentResolved: true,
        enforcementFacts: clone(this.containment?.enforcementFacts || resolved?.containment?.enforcementFacts || null),
        result: clone(stopped),
        recovery: clone(resolved)
      };
    } catch (cleanupCause) {
      const cleanupReasonCode = cleanupCause.reasonCode || cleanupCause.code || REJECTED_OWNER_CLEANUP_FAILED;
      cause.cleanupReasonCode = cleanupReasonCode;

      try {
        const concurrentExit = await this._resolveRejectedOwnerAfterConcurrentExit(child, cause, stopped, options);
        if (concurrentExit) {
          cause.rejectedOwnerCleanup = { ...concurrentExit, message: cleanupCause.message };
          return cause;
        }
      } catch (recoveryCause) {
        cleanupCause.concurrentExitRecoveryReasonCode = recoveryCause.reasonCode || recoveryCause.code || APPLICATION_CONTAINMENT_RELEASE_BLOCKED;
      }

      await this._engageRejectedOwnerContainment(cause, { cleanupReasonCode, stopResult: stopped, fatal: true });
      await this._markRejectedOwnerStillLive(cleanupCause, stopped);
      const backend = this._backend();
      const childLive = await this._backendChildLiveAsync();
      const persistedPidLive = await this._persistedContainmentPidLiveAsync();
      const childStillLive = Boolean(childLive || persistedPidLive || this._backendOwned());
      cause.rejectedOwnerCleanup = {
        stopped: stopped?.stopped === true,
        exitConfirmed: stopped?.exitConfirmed === true,
        childStillLive,
        ownerReleased: false,
        applicationFenceActive: Boolean(this.vaultHost.applicationFenceSnapshot?.()),
        fd6Closed: backend.credentialCustody?.dedicatedPipeActive !== true,
        ownerTrusted: backend.ownerTrusted !== false,
        coordinatorState: this.lifecycle.state,
        failStopRequired: this.failStopRequired === true,
        enforcementFacts: clone(this.containment?.enforcementFacts || null),
        message: cleanupCause.message,
        concurrentExitRecoveryReasonCode: cleanupCause.concurrentExitRecoveryReasonCode || '',
        result: clone(stopped)
      };
    }
    return cause;
  }

  async _startAndValidate(token, expectedAuthority = null, options = {}) {
    this._assertOperationMayContinue(options, 'before-new-owner-start');
    await this._transition(STATES.NEW_OWNER_STARTING, '', { expectedGeneration: expectedAuthority?.generation ?? null });
    await this._transition(STATES.NEW_OWNER_HYDRATING, 'fd5-ready-handshake-pending');
    let result;
    try {
      result = await this.startBackendCallback({ ...options, applicationLeaseToken: token, containmentRecoveryValidated: true });
    } catch (cause) {
      const failedBeforeOwnerClaim = cause?.rejectedOwnerContainmentSkipped === true && cause?.rejectedOwnerContainmentSkippedReason === 'CHILD_FAILED_BEFORE_OWNER_CLAIM';
      const failedChild = cause?.backendChild || this.getOwnedBackendChild();
      let recovery = null;
      if (failedChild && !failedBeforeOwnerClaim) {
        try { recovery = await this.waitForOwnerExitRecovery(failedChild); }
        catch (recoveryCause) {
          cause.ownerRecoveryReasonCode = recoveryCause.reasonCode || recoveryCause.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED';
        }
      }
      const backend = this._backend();
      const unresolvedOwner = !failedBeforeOwnerClaim && Boolean(
        backend.ownershipPresent === true ||
        backend.rejectedOwner ||
        backend.ownerRegistryFailure ||
        backend.ownerRegistry?.ownershipActive === true ||
        recovery?.recovered === false
      );
      if (unresolvedOwner) await this._cleanupRejectedNewOwner(token, cause, options);
      throw cause;
    }
    let ready;
    let runtimeProjection = null;
    let ownerAcceptance = null;
    try {
      ready = this._assertReady(expectedAuthority);
      if (typeof this.validateRuntimeProjection !== 'function') {
        throw makeError(APPLICATION_READY_MISMATCH, 'Backend runtime projection validator is unavailable', { failures: ['runtime-projection-validator-unavailable'] });
      }
      runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ result, ready, applicationLeaseToken: token }), ready);
      ownerAcceptance = this.desktopHost.acceptBackendOwner?.({ backendPid: ready.backend.backendPid, generation: ready.authority.generation, authorityHeadDigest: ready.authority.authorityHeadDigest }) || null;
      ownerAcceptance = ownerAcceptance ? await ownerAcceptance : null;
    } catch (cause) {
      await this._cleanupRejectedNewOwner(token, cause, options);
      throw cause;
    }
    await this._transition(STATES.NEW_OWNER_READY, '', {
      backendPid: ready.backend.backendPid,
      generation: ready.authority.generation,
      authorityHeadDigest: ready.authority.authorityHeadDigest,
      runtimeProjectionValidated: true
    });
    return { result, ready, runtimeProjection, ownerAcceptance };
  }

  startBackend(options = {}) {
    return this._enqueue('START_BACKEND', async () => {
      const containmentAtStart = this.isRejectedOwnerContainmentActive();
      if (containmentAtStart && !this.automaticStartupContainmentRecovery) await this._recoverContainmentIfOwnerExited({ finalState: STATES.FAILED_SAFE });
      const operation = await this._begin('START_BACKEND', { ...options, allowContainmentRecovery: containmentAtStart && this.automaticStartupContainmentRecovery });
      let token;
      try {
        token = await this._acquireLease(operation);
        if (containmentAtStart && this.automaticStartupContainmentRecovery) await this._recoverContainmentForStartup(token, options);
        if (this._backend().running === true) {
          await this._transition(STATES.NEW_OWNER_HYDRATING, 'already-ready-full-validation');
          let ready;
          let runtimeProjection;
          try {
            ready = this._assertReady();
            if (typeof this.validateRuntimeProjection !== 'function') {
              throw makeError(APPLICATION_READY_MISMATCH, 'Backend runtime projection validator is unavailable', { failures: ['runtime-projection-validator-unavailable'] });
            }
            runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ alreadyReady: true, ready, applicationLeaseToken: token }), ready);
            await this.desktopHost.acceptBackendOwner?.({ backendPid: ready.backend.backendPid, generation: ready.authority.generation, authorityHeadDigest: ready.authority.authorityHeadDigest });
          } catch (cause) {
            await this._cleanupRejectedNewOwner(token, cause, options);
            throw cause;
          }
          await this._transition(STATES.NEW_OWNER_READY, 'already-ready-validated', { backendPid: ready.backend.backendPid, generation: ready.authority.generation, runtimeProjectionValidated: true });
          return await this._complete({ ok: true, alreadyReady: true, backend: ready.backend, authority: ready.authority, runtimeProjection }, STATES.NEW_OWNER_READY);
        }
        await this._stopAndRecover(token, { reason: this._backendOwned() ? 'stale-start-cleanup' : 'owner-free-start-validation' });
        const expected = this._authorityBoundary();
        const started = await this._startAndValidate(token, expected, options);
        return await this._complete({ ok: true, ...started.result, runtimeProjection: started.runtimeProjection, ownerAcceptance: started.ownerAcceptance, credentialApplication: this.snapshot() }, STATES.NEW_OWNER_READY);
      } catch (cause) {
        throw await this._fail(cause);
      } finally { await this._releaseLease(token); }
    });
  }

  restartBackend(options = {}) {
    return this._enqueue('RESTART_BACKEND', async () => {
      const containmentAtStart = this.isRejectedOwnerContainmentActive();
      if (containmentAtStart && !this.automaticStartupContainmentRecovery) await this._recoverContainmentIfOwnerExited({ finalState: STATES.FAILED_SAFE });
      const operation = await this._begin('RESTART_BACKEND', { ...options, allowContainmentRecovery: containmentAtStart && this.automaticStartupContainmentRecovery });
      let token;
      try {
        token = await this._acquireLease(operation);
        if (containmentAtStart && this.automaticStartupContainmentRecovery) await this._recoverContainmentForStartup(token, options);
        await this._stopAndRecover(token, { ...options, reason: options.reason || 'controlled-restart' });
        const expected = this._authorityBoundary();
        const started = await this._startAndValidate(token, expected, options);
        return await this._complete({ ok: true, restarted: true, ...started.result, runtimeProjection: started.runtimeProjection, ownerAcceptance: started.ownerAcceptance, credentialApplication: this.snapshot() }, STATES.NEW_OWNER_READY);
      } catch (cause) {
        throw await this._fail(cause);
      } finally { await this._releaseLease(token); }
    });
  }

  stopBackend(options = {}) {
    return this._enqueue('STOP_BACKEND', async () => {
      const containmentAtStart = this.isRejectedOwnerContainmentActive();
      const operationType = options.forShutdown ? 'APPLICATION_SHUTDOWN' : 'STOP_BACKEND';
      if (containmentAtStart && operationType !== 'APPLICATION_SHUTDOWN') throw this._containmentError();
      const operation = await this._begin(operationType, { ...options, allowContainmentRecovery: containmentAtStart && options.forShutdown === true });
      let token;
      try {
        token = await this._acquireLease(operation);
        if (containmentAtStart) {
          const result = await this._attemptContainedOwnerStop(token, options);
          return result;
        }
        const result = await this._stopAndRecover(token, options);
        await this._transition(STATES.STOPPED, '', { backendPid: Number(result.backendPid || 0) });
        return await this._complete(result, STATES.STOPPED);
      } catch (cause) {
        throw await this._fail(cause);
      } finally { await this._releaseLease(token); }
    });
  }

  applyVaultMutationWithRestart(operation, ref, value, options = {}) {
    const key = String(ref || '').trim();
    if (!key) return Promise.reject(makeError('INVALID_CREDENTIAL_REF', 'Credential reference is required'));
    if (!['persist', 'remove'].includes(operation)) return Promise.reject(makeError('CREDENTIAL_CUSTODY_OPERATION_INVALID', 'Desktop credential operation is invalid'));
    const requestId = String(options.requestId || this.randomUUID());
    const fingerprint = mutationSha256(operation, key, value);
    return this._enqueue('DESKTOP_MUTATION', async () => {
      const applicationOperation = await this._begin('DESKTOP_MUTATION', { ...options, requestId, mutationSha256: fingerprint });
      let token;
      try {
        this._assertOperationMayContinue(options, 'before-desktop-mutation');
        token = await this._acquireLease(applicationOperation);
        await this._stopAndRecover(token, { reason: 'desktop-credential-mutation' });
        this._assertOperationMayContinue(options, 'before-desktop-mutation-commit');
        await this._transition(STATES.MUTATION_COMMITTING, '', { requestId, mutationSha256: fingerprint });
        const mutation = await this.vaultHost.executeDesktopMutation(operation, key, value, {
          requestId,
          mutationSha256: fingerprint,
          applicationLeaseToken: token
        });
        if (mutation?.transactionState !== 'COMMITTED' || mutation?.persisted !== true) {
          throw makeError(mutation?.reasonCode || 'CREDENTIAL_TRANSACTION_PARTIAL_COMMIT', 'Desktop credential mutation did not reach a durable COMMITTED state', { mutation });
        }
        const committedAuthority = this._authorityBoundary();
        applicationOperation.mutationCommitted = true;
        applicationOperation.committedAuthority = clone(committedAuthority);
        applicationOperation.updatedAtUtc = this.clock();
        this.lifecycle.mutationCommitted = true;
        await this._persist();
        const started = await this._startAndValidate(token, committedAuthority, options);
        return await this._complete({
          ok: true,
          ref: key,
          operation,
          requestId,
          appliedBy: 'DESKTOP_CREDENTIAL_APPLICATION_COORDINATOR',
          durableReplay: mutation.durableReplay === true,
          mutation,
          backend: started.result,
          credentialMetadata: started.ready.authority,
          runtimeProjection: started.runtimeProjection,
          credentialApplication: this.snapshot()
        }, STATES.NEW_OWNER_READY);
      } catch (cause) {
        if (applicationOperation.mutationCommitted) {
          cause.mutationCommitted = true;
          cause.requestId = requestId;
          cause.committedAuthority = clone(applicationOperation.committedAuthority);
          cause.reasonCode = cause.reasonCode || 'WP4_DESKTOP_CREDENTIAL_RESTART_AFTER_COMMIT_FAILED';
        }
        throw await this._fail(cause, { requestId, mutationCommitted: applicationOperation.mutationCommitted === true });
      } finally { await this._releaseLease(token); }
    });
  }

  resetCredentialVault(options = {}) {
    const requestId = String(options.requestId || this.randomUUID());
    return this._enqueue('RESET_CREDENTIAL_VAULT', async () => {
      const operation = await this._begin('RESET_CREDENTIAL_VAULT', { ...options, requestId });
      let token;
      try {
        this._assertOperationMayContinue(options, 'before-credential-vault-reset');
        token = await this._acquireLease(operation);
        await this._stopAndRecover(token, { reason: 'credential-vault-reset' });
        this._assertOperationMayContinue(options, 'before-credential-vault-reset-commit');
        await this._transition(STATES.MUTATION_COMMITTING, '', { requestId, reset: true });
        const mutation = await this.vaultHost.resetAfterBackendStopped({ exitConfirmed: true, requestId, applicationLeaseToken: token });
        const committedAuthority = this._authorityBoundary();
        operation.mutationCommitted = mutation?.transactionState === 'COMMITTED';
        operation.committedAuthority = clone(committedAuthority);
        this.lifecycle.mutationCommitted = operation.mutationCommitted;
        await this._persist();
        if (!operation.mutationCommitted) throw makeError(mutation?.reasonCode || 'CREDENTIAL_TRANSACTION_PARTIAL_COMMIT', 'Credential reset did not commit', { mutation });
        const started = await this._startAndValidate(token, committedAuthority, options);
        return await this._complete({ ok: true, reset: true, requestId, mutation, backend: started.result, runtimeProjection: started.runtimeProjection, ownerAcceptance: started.ownerAcceptance }, STATES.NEW_OWNER_READY);
      } catch (cause) {
        throw await this._fail(cause, { requestId, mutationCommitted: operation.mutationCommitted === true });
      } finally { await this._releaseLease(token); }
    });
  }

  recoverStartupContainment(options = {}) {
    return this._enqueue('STARTUP_CONTAINMENT_RECOVERY', async () => {
      if (!this.isRejectedOwnerContainmentActive()) return { recovered: false, notRequired: true };
      const operation = await this._begin('STARTUP_CONTAINMENT_RECOVERY', {
        ...options,
        allowContainmentRecovery: true
      });
      let token;
      try {
        token = await this._acquireLease(operation);
        const recovery = await this._recoverContainmentForStartup(token, {
          ...options,
          reason: options.reason || 'automatic-bootstrap-rejected-owner-recovery'
        });
        return await this._complete({ ok: true, ...recovery }, STATES.IDLE);
      } catch (cause) {
        throw await this._fail(cause);
      } finally {
        await this._releaseLease(token);
      }
    });
  }

  runExclusive(operationType, work, options = {}) {
    if (typeof work !== 'function') return Promise.reject(new TypeError('runExclusive requires a function'));
    return this._enqueue(operationType, async () => {
      const operation = await this._begin(operationType, options);
      let token;
      try {
        token = await this._acquireLease(operation);
        await this._stopAndRecover(token, { reason: operationType });
        const result = await work(token);
        return await this._complete(result, STATES.IDLE);
      } catch (cause) {
        throw await this._fail(cause);
      } finally { await this._releaseLease(token); }
    });
  }

  recoverAfterBackendExit(child, options = {}) {
    const expected = child && typeof child === 'object' ? this.expectedExitChildren.get(child) : null;
    if (expected) {
      return Promise.resolve().then(async () => {
        await this.initialize();
        const result = await this.waitForOwnerExitRecovery(child);
        if (result?.recovered !== true) {
          throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Expected backend exit did not complete owner recovery', { recovery: result, backendPid: Number(child?.pid || 0) });
        }
        this.expectedExitChildren.delete(child);
        if (expected.rejectedReady || this.isRejectedOwnerContainmentActive()) {
          try {
            await this._resolveRejectedOwnerContainment(child, { finalState: STATES.FAILED_SAFE });
          } catch (cause) {
            await this._markRejectedOwnerStillLive(cause);
            throw cause;
          }
        }
        return { ...result, recovered: result?.recovered !== false, controlled: true, suppressAutomaticRestart: true, operationId: expected.operationId, operationType: expected.operationType, rejectedReady: expected.rejectedReady === true };
      });
    }
    return this._enqueue('BACKEND_EXIT_RECOVERY', async () => {
      const operation = await this._begin('BACKEND_EXIT_RECOVERY', { requestId: '', allowContainmentRecovery: true });
      let token;
      try {
        token = await this._acquireLease(operation);
        if (this.isRejectedOwnerContainmentActive()) {
          const result = await this.waitForOwnerExitRecovery(child);
          if (result?.recovered !== true) {
            throw makeError(APPLICATION_CONTAINMENT_RELEASE_BLOCKED, 'Rejected backend owner recovery remains pending after exit', { recovery: result, backendPid: Number(child?.pid || 0) });
          }
          const recovered = await this._resolveRejectedOwnerContainment(child, { finalState: STATES.FAILED_SAFE });
          return { ...recovered, controlled: false, suppressAutomaticRestart: true, rejectedOwnerRecovered: true, backendPid: child?.pid || 0 };
        }
        await this._transition(STATES.OWNER_EXIT_CONFIRMED, 'backend-exit-confirmed', {
          backendPid: Number(child?.pid || 0),
          unexpected: options.unexpected === true
        });
        await this._transition(STATES.OWNER_RECOVERING, 'backend-exit-observed', {
          backendPid: Number(child?.pid || 0),
          unexpected: options.unexpected === true
        });
        const result = await this.waitForOwnerExitRecovery(child);
        if (result?.recovered !== true) {
          throw makeError('WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_PENDING', 'Backend exit recovery is still pending', { recovery: result, backendPid: Number(child?.pid || 0) });
        }
        const backend = this._backend();
        if (backend.running === true && Number(backend.backendPid || 0) !== Number(child?.pid || 0)) {
          const ready = this._assertReady();
          if (typeof this.validateRuntimeProjection !== 'function') throw makeError(APPLICATION_READY_MISMATCH, 'Backend runtime projection validator is unavailable', { failures: ['runtime-projection-validator-unavailable'] });
          this._assertRuntimeProjection(await this.validateRuntimeProjection({ staleExit: true, ready, applicationLeaseToken: token }), ready);
          return await this._complete({ recovered: true, staleExit: true, backendPid: child?.pid || 0 }, STATES.IDLE);
        }
        this._assertOwnerReleased();
        return await this._complete({ recovered: true, staleExit: false, backendPid: child?.pid || 0, unexpected: options.unexpected === true }, STATES.IDLE);
      } catch (cause) {
        throw await this._fail(cause);
      } finally { await this._releaseLease(token); }
    });
  }

  isExpectedBackendExit(child) {
    return Boolean(child && typeof child === 'object' && this.expectedExitChildren.get(child));
  }

  isReplacingBackendOwner() {
    return Boolean(this.isRejectedOwnerContainmentActive() || (this.activeLeaseToken && [
      STATES.OWNER_STOPPING,
      STATES.OWNER_EXIT_CONFIRMED,
      STATES.OWNER_RECOVERING,
      STATES.MUTATION_COMMITTING,
      STATES.NEW_OWNER_STARTING,
      STATES.NEW_OWNER_HYDRATING,
      STATES.REJECTED_OWNER_TERMINATION_PENDING,
      STATES.REJECTED_OWNER_STILL_LIVE,
      STATES.FATAL_OWNER_CONTAINMENT
    ].includes(this.lifecycle.state)));
  }

  snapshot() {
    return Object.freeze({
      state: this.lifecycle.state,
      reasonCode: this.lifecycle.reasonCode,
      operationId: this.lifecycle.operationId,
      operationType: this.lifecycle.operationType,
      requestId: this.lifecycle.requestId,
      mutationCommitted: this.lifecycle.mutationCommitted === true,
      leaseHeld: Boolean(this.activeLeaseToken),
      pendingOperations: this.pendingOperations,
      containmentActive: this.isRejectedOwnerContainmentActive(),
      containment: clone(this.containment),
      containmentSentinel: clone(this.containmentSentinel),
      containmentSentinelPath: this.containmentSentinelPath,
      failStopRequired: this.failStopRequired === true,
      persistenceFailures: clone(this.persistenceFailures),
      applicationFence: this.vaultHost.applicationFenceSnapshot?.() || null,
      rejectedOwnerLive: this.desktopHost.isRejectedBackendOwnerLive?.() === true || this._persistedContainmentPidLive(),
      failedSafeResetBoundary: this._failedSafeResetBoundary(),
      interruptedOperation: clone(this.interruptedOperation),
      currentOperation: clone(this.currentOperation),
      lastResult: clone(this.lastResult),
      lastFailure: clone(this.lastFailure),
      journalPath: this.journalPath,
      stateHistory: clone(this.lifecycle.stateHistory)
    });
  }
}

module.exports = {
  APPLICATION_BUSY,
  APPLICATION_CONTAINMENT_ACTIVE,
  APPLICATION_CONTAINMENT_RELEASE_BLOCKED,
  APPLICATION_READY_MISMATCH,
  APPLICATION_STOP_UNCHANGED_MISMATCH,
  APPLICATION_UNAVAILABLE,
  DesktopCredentialApplicationCoordinator,
  JOURNAL_SCHEMA_VERSION,
  REJECTED_OWNER_CLEANUP_FAILED,
  atomicWriteJson
};
