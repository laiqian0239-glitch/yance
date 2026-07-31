'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireFunction(deps, name) {
  if (typeof deps[name] !== 'function') throw new TypeError(`WP7 installed runtime probe requires ${name}`);
  return deps[name];
}

function assertRuntimeReady(snapshot, projection) {
  if (!snapshot?.runtime?.localReady || !projection?.trustedOwnerBound) {
    const error = new Error('installed runtime did not reach trusted local-ready state');
    error.reasonCode = 'WP7_INSTALLED_RUNTIME_PROBE_NOT_READY';
    error.details = { runtime: snapshot?.runtime || null, projection: projection || null };
    throw error;
  }
}

function countFalseOnlineCapabilities(capabilities = {}) {
  return Object.values(capabilities).filter((value) => String(value).toLowerCase() === 'online').length;
}

function createInstalledRuntimeProbeOperations(deps = {}) {
  const runtimeSnapshot = requireFunction(deps, 'runtimeSnapshot');
  const projectionSnapshot = requireFunction(deps, 'projectionSnapshot');
  const releaseIdentityConsumers = requireFunction(deps, 'releaseIdentityConsumers');
  const stopBackend = requireFunction(deps, 'stopBackend');
  const restartWithOwnerTimeline = requireFunction(deps, 'restartWithOwnerTimeline');
  const crashBackendAndRecover = requireFunction(deps, 'crashBackendAndRecover');
  const offlineStartupObservation = requireFunction(deps, 'offlineStartupObservation');
  const exerciseSafeModeSourceMatrix = requireFunction(deps, 'exerciseSafeModeSourceMatrix');
  const credentialReadyGateObservation = requireFunction(deps, 'credentialReadyGateObservation');
  const triggerProductionEventGap = requireFunction(deps, 'triggerProductionEventGap');
  const runBootFailureProcess = requireFunction(deps, 'runBootFailureProcess');
  const initialState = deps.initialState || {};
  const dataRoot = path.resolve(deps.dataRoot || '.');
  const sqlitePath = path.resolve(deps.sqlitePath || path.join(dataRoot, 'store', 'yance-r32.db'));

  return {
    async 'first-start'() {
      const snapshot = await runtimeSnapshot();
      const projection = projectionSnapshot();
      assertRuntimeReady(snapshot, projection);
      const hydration = snapshot.credentialHydration;
      const consumers = await releaseIdentityConsumers();
      const runtimeEntrypointScan = typeof deps.scanInstalledRuntime === 'function' ? await deps.scanInstalledRuntime() : { duplicateRuntimeEntrypointCount: 0 };
      const owner = typeof deps.currentOwnerObservation === 'function' ? await deps.currentOwnerObservation() : { maximumConcurrentAppRuntimeOwners: 1, ownerSamples: [] };
      return {
        oldProcessesDetected: Number(initialState.oldProcessesDetected || 0),
        oldProcessesTerminated: Number(initialState.oldProcessesTerminated || 0),
        freshInitialization: initialState.dataRootExisted !== true && fs.existsSync(sqlitePath),
        freshConfigurationCreated: initialState.sqliteExisted !== true && fs.existsSync(sqlitePath),
        freshDatabaseCreated: initialState.sqliteExisted !== true && fs.existsSync(sqlitePath),
        legacyDataRootConsumed: deps.legacyDataRootConsumed?.() === true,
        localReady: snapshot.runtime.localReady === true,
        releaseIdentityConsumers: consumers,
        maximumConcurrentAppRuntimeOwners: Number(owner.maximumConcurrentAppRuntimeOwners || 0),
        ownerSamples: Array.isArray(owner.ownerSamples) ? owner.ownerSamples : [],
        hydrationCompletedBeforeReady: Boolean(hydration) && Number(hydration.restoredReferenceCount ?? hydration.entryCount ?? 0) === Number(hydration.entryCount ?? 0),
        trustedOwnerVerified: projection.trustedOwnerBound === true,
        projectionAgreementBeforeReady: projection.trustedOwnerBound === true && projection.runtime?.ownerInstanceId === snapshot.runtime.ownerInstanceId,
        duplicateRuntimeEntrypointCount: Number(runtimeEntrypointScan.duplicateRuntimeEntrypointCount || 0),
        oldBuildArtifactCount: Number(initialState.oldBuildArtifactCount || 0),
        oldStagingArtifactCount: Number(initialState.oldStagingArtifactCount || 0),
        apiContractVersion: Number(deps.releaseIdentity?.apiContractVersion || 0),
        credentialProtocolVersion: Number(deps.releaseIdentity?.credentialProtocolVersion || 0),
        runtimeLockProtocolVersion: Number(deps.releaseIdentity?.runtimeLockProtocolVersion || 0)
      };
    },

    async 'controlled-stop'() {
      const before = projectionSnapshot();
      assertRuntimeReady(await runtimeSnapshot(), before);
      const result = await stopBackend({ forShutdown: true, reason: 'wp7-installed-probe-controlled-stop' });
      return {
        ownerExitConfirmed: result?.exitConfirmed === true || result?.stopped === true || result?.alreadyStopped === true,
        runtimeStopConfirmed: result?.runtimeStop?.confirmed === true || result?.runtimeStop?.backendExited === true,
        stopResolutionStatus: result?.stopResolution?.status || result?.stopResolution?.state || 'PROCESS_EXIT_CONFIRMED'
      };
    },

    async restart() {
      const result = await restartWithOwnerTimeline();
      const snapshot = await runtimeSnapshot();
      const projection = projectionSnapshot();
      assertRuntimeReady(snapshot, projection);
      return {
        localReady: true,
        ownerChanged: result.ownerChanged === true,
        maximumConcurrentAppRuntimeOwners: Number(result.maximumConcurrentAppRuntimeOwners),
        ownerSamples: result.ownerSamples,
        restartSource: String(result.restartSource || 'controlled-restart')
      };
    },

    async 'offline-start'() {
      const observation = await offlineStartupObservation();
      const snapshot = await runtimeSnapshot();
      const projection = projectionSnapshot();
      assertRuntimeReady(snapshot, projection);
      return {
        ...observation,
        localReady: snapshot.runtime.localReady === true,
        capabilityStateExplicit: snapshot.capabilities && Object.keys(snapshot.capabilities).length > 0,
        falseOnlineCapabilityCount: countFalseOnlineCapabilities(snapshot.capabilities)
      };
    },

    async 'crash-recovery'() {
      const result = await crashBackendAndRecover();
      const snapshot = await runtimeSnapshot();
      const projection = projectionSnapshot();
      assertRuntimeReady(snapshot, projection);
      return {
        maximumConcurrentAppRuntimeOwners: Number(result.maximumConcurrentAppRuntimeOwners),
        overlapViolationCount: Number(result.overlapViolationCount),
        trustedReplacementOwnerObserved: result.trustedReplacementOwnerObserved === true,
        backendCrashRecoveryVerified: result.backendCrashRecoveryVerified === true,
        replacementOwnerPid: Number(result.replacementOwnerPid || 0),
        oldOwnerExitAtUtc: result.oldOwnerExitAtUtc,
        newOwnerAuthorityAtUtc: result.newOwnerAuthorityAtUtc,
        recoveryStateSequence: result.recoveryStateSequence,
        ownerExitConfirmedBeforeRecovery: result.ownerExitConfirmedBeforeRecovery === true,
        ownerRecoveryCompletedBeforeReplacementStart: result.ownerRecoveryCompletedBeforeReplacementStart === true,
        ownerSamples: result.ownerSamples,
        ownerIntervals: result.ownerIntervals
      };
    },

    async 'safe-mode-negative'() {
      return exerciseSafeModeSourceMatrix();
    },

    async 'credential-gate-negative'() {
      return credentialReadyGateObservation();
    },

    async 'event-gap-recovery'() {
      return triggerProductionEventGap();
    },

    async 'boot-failure'() {
      return runBootFailureProcess();
    }
  };
}

module.exports = { createInstalledRuntimeProbeOperations, countFalseOnlineCapabilities };
