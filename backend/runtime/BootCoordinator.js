'use strict';

const { RuntimeOwnership } = require('./RuntimeOwnership');
const { LifecycleStateMachine } = require('./LifecycleStateMachine');
const { AppRuntimeFactory } = require('./AppRuntimeFactory');
const { clearRuntimeCoordinator, setRuntimeCoordinator } = require('./runtimeSingleton');
const { normalizeRuntimeError } = require('./errors');
const { canonicalizeRuntimePaths } = require('./RuntimePathIdentity');
const { hydrateCredentialsFromPipe } = require('../bootstrap/credentialHydrationPipe');
const { applyCredentialSnapshot } = require('../bootstrap/applyCredentialSnapshot');
const { RuntimeAuthorityMigrationCoordinator } = require('./RuntimeAuthorityMigrationCoordinator');

class BootCoordinator {
  constructor(options = {}) {
    this.options = options;
    this.context = options.context;
    this.runtimePaths = options.runtimePaths || canonicalizeRuntimePaths({ dataRoot: options.dataRoot, dbPath: options.dbPath, platform: options.platform });
    this.dataRoot = this.runtimePaths.dataRoot;
    this.dbPath = this.runtimePaths.dbPath;
    this.buildId = String(options.buildId || this.context?.buildId || '');
    this.ownership = null;
    this.lifecycle = null;
    this.runtime = null;
    this.started = false;
    this.stopped = false;
    this.createdRuntime = false;
    this.createdRuntimeReference = null;
    this.runtimeAuthority = null;
    this.sqliteBroker = options.sqliteBroker || null;
    const probeId = String(process.env.WP7_PROBE_ID || '').trim();
    const executionClass = String(process.env.WP7_PROBE_EXECUTION_CLASS || '').trim();
    const formalProbe = ['FINAL_WINDOWS', 'PRE_REVIEW_PACKAGED_INTEGRATION'].includes(executionClass);
    const preMainIsolation = formalProbe && probeId === 'offline-start' && process.env.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN === '1';
    this.probeObservations = {
      credentialReadyGate: null,
      credentialHydratedAtUtc: '',
      localReadyAtUtc: '',
      offlineStartup: {
        formalProbe,
        probeId,
        preMainIsolation,
        backendStartedOffline: preMainIsolation,
        networkCommandAppliedBeforeLocalReady: preMainIsolation
      }
    };
  }

  async start() {
    if (this.started) return this.runtime;
    let bootSubphase = 'ownership_acquire';
    this.ownership = new RuntimeOwnership({
      dataRoot: this.dataRoot,
      dbPath: this.dbPath,
      runtimePaths: this.runtimePaths,
      buildId: this.buildId,
      ownerPid: process.pid,
      platform: this.options.platform,
      leaseDurationMs: this.options.leaseDurationMs,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      mutex: this.options.mutex,
      storeFactory: this.options.storeFactory || (this.sqliteBroker ? (storeOptions => {
        const r32Store = this.sqliteBroker.open();
        const { RuntimeStateStore } = require('./RuntimeStateStore');
        return new RuntimeStateStore({ ...storeOptions, db: r32Store.db });
      }) : undefined),
      initializeRuntimeState: false
    });
    try {
      bootSubphase = 'ownership_acquire';
      await this.ownership.acquire();
      bootSubphase = 'runtime_authority_migration';
      const migrationCoordinator = this.options.runtimeAuthorityMigrationCoordinator || new RuntimeAuthorityMigrationCoordinator({
        store: this.ownership.store,
        ownership: this.ownership,
        currentRoot: this.dataRoot,
        legacyRoot: this.options.legacyDataRoot,
        platform: this.options.platform
      });
      this.runtimeAuthority = migrationCoordinator.ensureAuthority();
      bootSubphase = 'lifecycle_initialization';
      this.lifecycle = new LifecycleStateMachine({ store: this.ownership.store, ownership: this.ownership, buildId: this.buildId });
      this.lifecycle.transition('manifest_verified');
      this.lifecycle.transition('ownership_acquired');
      this.lifecycle.transition('database_ready');
      this.lifecycle.transition('runtime_state_ready');
      if (this.probeObservations.offlineStartup.formalProbe && this.probeObservations.offlineStartup.probeId === 'credential-gate-negative') {
        const attemptedAtUtc = new Date().toISOString();
        try {
          this.lifecycle.transition('local_ready', 'wp7-credential-gate-negative');
          this.probeObservations.credentialReadyGate = {
            illegalTransitionAttempted: true,
            illegalTransitionRejected: false,
            rejectionReasonCode: '',
            fromState: 'runtime_state_ready',
            toState: 'local_ready',
            localReadyAtAttempt: true,
            hydrationCompleteAtAttempt: false,
            attemptedAtUtc
          };
          const error = new Error('WP7 credential ready negative probe unexpectedly crossed the lifecycle gate');
          error.reasonCode = 'WP7_CREDENTIAL_READY_GATE_NEGATIVE_NOT_INJECTED';
          throw error;
        } catch (error) {
          if (error.reasonCode === 'WP7_CREDENTIAL_READY_GATE_NEGATIVE_NOT_INJECTED') throw error;
          this.probeObservations.credentialReadyGate = {
            illegalTransitionAttempted: true,
            illegalTransitionRejected: true,
            rejectionReasonCode: String(error.reasonCode || error.code || ''),
            fromState: 'runtime_state_ready',
            toState: 'local_ready',
            localReadyAtAttempt: false,
            hydrationCompleteAtAttempt: false,
            attemptedAtUtc
          };
        }
      }
      let credentialHydration = null;
      const credentialConfigured = Boolean(this.context?.credentialOneTimeToken && this.context?.credentialVaultEpoch);
      if (credentialConfigured || this.options.requireCredentialHydration === true) {
        bootSubphase = 'credential_hydration_read';
        this.lifecycle.transition('credential_channel_ready');
        const hydrate = this.options.hydrateCredentials || hydrateCredentialsFromPipe;
        credentialHydration = await hydrate({
          context: this.context,
          store: this.ownership.store,
          ownership: this.ownership,
          fd: this.options.credentialFd,
          stream: this.options.credentialStream,
          timeoutMs: this.options.credentialTimeoutMs
        });
        const applySnapshot = this.options.applyCredentialSnapshot || applyCredentialSnapshot;
        bootSubphase = 'credential_snapshot_apply';
        const accountRestore = await applySnapshot(credentialHydration.entries || []);
        const counts = [credentialHydration.vaultReferenceCount, credentialHydration.decryptedEntryCount, credentialHydration.frameEntryCount, credentialHydration.entryCount, Number(accountRestore?.entryCount)];
        if (counts.some(value => !Number.isInteger(value) || value < 0) || new Set(counts).size !== 1) {
          const error = new Error('Credential reference counts diverged before runtime authority acceptance');
          error.reasonCode = 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH';
          throw error;
        }
        bootSubphase = 'credential_authority_accept';
        this.ownership.store.acceptCredentialHydration({
          ...this.ownership.guard(), vaultEpoch: credentialHydration.vaultEpoch, generation: credentialHydration.generation,
          authorityEventId: credentialHydration.authorityEventId, authorityHeadDigest: credentialHydration.authorityHeadDigest,
          referenceCount: counts[0], payloadBytes: credentialHydration.payloadBytes,
          resetAuthorization: this.context.credentialResetAuthorization
        });
        credentialHydration = Object.freeze({
          vaultEpoch: credentialHydration.vaultEpoch,
          generation: credentialHydration.generation,
          authorityEventId: credentialHydration.authorityEventId,
          authorityHeadDigest: credentialHydration.authorityHeadDigest,
          vaultReferenceCount: counts[0], decryptedEntryCount: counts[1], frameEntryCount: counts[2],
          entryCount: counts[3], payloadBytes: credentialHydration.payloadBytes,
          restoredReferenceCount: counts[4]
        });
        this.lifecycle.transition('credential_hydrated');
        this.probeObservations.credentialHydratedAtUtc = new Date().toISOString();
        this.options.onCredentialHydrated?.({ ...credentialHydration });
        this.lifecycle.transition('local_account_state_restored');
      }
      this.lifecycle.transition('api_contract_verified');
      bootSubphase = 'runtime_factory_create';
      this.runtime = AppRuntimeFactory.create({
        ownership: this.ownership,
        store: this.ownership.store,
        lifecycle: this.lifecycle,
        buildId: this.buildId,
        onStopRequested: this.options.onStopRequested,
        credentialHydration,
        externalWorkerStarters: this.options.externalWorkerStarters
      });
      this.createdRuntime = true;
      this.createdRuntimeReference = this.runtime;
      bootSubphase = 'credential_authority_bind';
      const secureBridge = require('../services/secureBridge');
      this.unbindCredentialAuthority = secureBridge.bindCredentialAuthority({
        prepare: async metadata => {
          if (this.stopped || ['stopping', 'stopped', 'failed'].includes(this.lifecycle?.state)) {
            const error = new Error('Backend is shutting down'); error.reasonCode = 'CREDENTIAL_BACKEND_SHUTTING_DOWN'; throw error;
          }
          const guard = this.ownership.guard();
          const sqliteBefore = this.ownership.store.getCredentialHydrationState();
          const runtimeBefore = this.runtime.credentialMetadata();
          if (!runtimeBefore || sqliteBefore.vaultEpoch !== runtimeBefore.vaultEpoch || sqliteBefore.generation !== runtimeBefore.generation ||
              runtimeBefore.vaultEpoch !== String(metadata.vaultEpoch || '') || runtimeBefore.generation !== Number(metadata.previousGeneration) ||
              sqliteBefore.authorityEventId !== runtimeBefore.authorityEventId || sqliteBefore.referenceCount !== runtimeBefore.restoredReferenceCount ||
              secureBridge.listRefs().length !== runtimeBefore.restoredReferenceCount) {
            const error = new Error('Credential authority state is inconsistent'); error.reasonCode = 'CREDENTIAL_STATE_AUTHORITY_SPLIT'; throw error;
          }
          return Object.freeze({ guard, sqliteBefore, runtimeBefore, metadata: Object.freeze({ ...metadata }), appApplied: false });
        },
        commit: async (token, committedMetadata = {}) => {
          let appApplied = false;
          try {
            const appliedMetadata = {
              ...token.metadata,
              ...committedMetadata,
              restoredReferenceCount: Number(committedMetadata.entryCount ?? token.metadata.entryCount ?? 0)
            };
            this.runtime.applyCredentialMutationMetadata(appliedMetadata); appApplied = true;
            this.ownership.store.advanceCredentialGeneration({ ...token.guard, ...appliedMetadata });
            return this.runtime.credentialMetadata();
          } catch (cause) {
            if (appApplied) this.runtime.restoreCredentialMutationMetadata(token.runtimeBefore);
            const error = new Error('Credential state authority update failed');
            error.reasonCode = cause.reasonCode || cause.code || 'CREDENTIAL_STATE_AUTHORITY_UPDATE_FAILED';
            error.cause = cause;
            throw error;
          }
        },
        rollback: async token => {
          if (token?.runtimeBefore) this.runtime.restoreCredentialMutationMetadata(token.runtimeBefore);
          return this.runtime.credentialMetadata();
        }
      });
      bootSubphase = 'operating_mode_reconcile';
      await this.runtime.reconcileOperatingMode();
      bootSubphase = 'critical_workers_start';
      await this.runtime.startLocalCriticalWorkers();
      bootSubphase = 'local_ready_finalize';
      this.lifecycle.transition('critical_workers_ready');
      if (credentialConfigured || this.options.requireCredentialHydration === true) this.lifecycle.transition('local_ready');
      if (this.lifecycle.state === 'local_ready') this.probeObservations.localReadyAtUtc = new Date().toISOString();
      this.ownership.startHeartbeat();
      this.started = true;
      setRuntimeCoordinator(this);
      this.options.onLocalReady?.({ lifecycleState: this.lifecycle.state, credentialHydration: this.runtime.credentialMetadata() });
      if (this.lifecycle.state === 'local_ready') void this.runtime.startExternalWorkersAfterLocalReady();
      return this.runtime;
    } catch (error) {
      const normalized = normalizeRuntimeError(error, 'APP_RUNTIME_BOOT_FAILED');
      if (!normalized.failedPhase) normalized.failedPhase = bootSubphase;
      try { this.lifecycle?.fail(normalized.reasonCode, normalized.failedPhase || this.lifecycle?.state || 'runtime_boot'); } catch (_) {}
      try { this.ownership?.store?.markBootFailed(this.ownership.bootAttemptId, normalized.failedPhase || 'runtime_boot', normalized.reasonCode); } catch (_) {}
      await this.ownership?.release().catch(() => {});
      if (this.createdRuntime && this.createdRuntimeReference) AppRuntimeFactory.clear(this.createdRuntimeReference);
      throw normalized;
    }
  }

  async stop(reason = 'shutdown') {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.createdRuntime && this.createdRuntimeReference && this.ownership?._acquired) {
        if (this.lifecycle && !['stopping', 'stopped'].includes(this.lifecycle.state)) this.lifecycle.transition('stopping', reason);
        if (this.lifecycle?.state === 'stopping') this.lifecycle.transition('stopped', reason);
      }
    } finally {
      try { this.unbindCredentialAuthority?.(); } catch (_) {}
      clearRuntimeCoordinator(this);
      if (this.createdRuntime && this.createdRuntimeReference) AppRuntimeFactory.clear(this.createdRuntimeReference);
      await this.ownership?.release().catch(() => {});
      try { this.sqliteBroker?.checkpointAndClose?.(); } catch (_) {}
    }
  }

  snapshot() { return Object.freeze({ started: this.started, stopped: this.stopped, buildId: this.buildId, createdRuntime: this.createdRuntime, ownership: this.ownership?.snapshot() || null, lifecycle: this.lifecycle?.snapshot() || null, probeObservations: JSON.parse(JSON.stringify(this.probeObservations)) }); }
}

module.exports = { BootCoordinator };
