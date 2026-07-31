'use strict';

const crypto = require('node:crypto');
const { CONSUMER_PROFILES, createIdentityObservation } = require('../../shared/release/identityObservation');

const BUILD_ID = 'YANCE-29.2.5-S6.4.5.9-P1-abcdef123456-20260705T130000Z';
const SOURCE_COMMIT = 'c'.repeat(40);
const SOURCE_TREE = 'd'.repeat(40);
const MANIFEST_SHA256 = 'e'.repeat(64);
const INSTALLER_SHA256 = 'b'.repeat(64);
const BUILD_SESSION_ID = 'a'.repeat(32);

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function identityConsumer(consumer, observationSource = `${consumer}-source`) {
  const profile = CONSUMER_PROFILES[consumer];
  const producerPids = { electron: 101, backend: 202, installer: 0, diagnostics: 303 };
  const producerProcesses = {
    electron: 'electron/main.js',
    backend: 'backend/server.js',
    installer: 'YanceFinalInstaller.nsi',
    diagnostics: 'backend/services/systemCenterService.js'
  };
  const observedDocument = {
    schemaVersion: 1,
    documentType: `TEST_${consumer.toUpperCase()}_RELEASE_IDENTITY`,
    consumer,
    producerType: profile.producerType,
    producerProcess: producerProcesses[consumer],
    producerPid: producerPids[consumer],
    observedAtUtc: '2026-07-05T13:00:00.000Z',
    buildId: BUILD_ID,
    productVersion: '29.2.5',
    stageVersion: '6.4.5.9',
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    manifestSha256: MANIFEST_SHA256
  };
  return createIdentityObservation({
    consumer,
    identity: observedDocument,
    observedDocument,
    producerType: profile.producerType,
    producerProcess: producerProcesses[consumer],
    producerPid: producerPids[consumer],
    sourceKind: profile.sourceKind,
    observationSource,
    observedAtUtc: observedDocument.observedAtUtc
  });
}

function ownerSample(observedAtUtc, aliveOwnerPids, trustedOwnerPid = aliveOwnerPids[0] || null) {
  return {
    observedAtUtc,
    aliveOwnerPids,
    concurrentOwnerCount: new Set(aliveOwnerPids).size,
    trustedOwnerPid,
    ownerInstanceId: trustedOwnerPid ? `owner-${trustedOwnerPid}` : null,
    leaseId: trustedOwnerPid ? `lease-${trustedOwnerPid}` : null
  };
}

function safeModeRow(sourceId) {
  const row = {
    sourceId,
    injected: true,
    sourcePresenceObserved: true,
    authorityChanges: 0,
    sqliteAuthorityRetained: true,
    authoritySource: 'Yance SQLite runtime_state.operating_mode'
  };
  return { ...row, injectionSha256: sha(row) };
}

function measurementFor(probeId) {
  const t0 = '2026-07-05T13:00:00.000Z';
  const t1 = '2026-07-05T13:00:01.000Z';
  const t2 = '2026-07-05T13:00:02.000Z';
  const t3 = '2026-07-05T13:00:03.000Z';
  const t4 = '2026-07-05T13:00:04.000Z';
  const firstStart = {
    oldProcessesDetected: 0,
    oldProcessesTerminated: 0,
    freshInitialization: true,
    freshConfigurationCreated: true,
    freshDatabaseCreated: true,
    legacyDataRootConsumed: false,
    localReady: true,
    releaseIdentityConsumers: {
      electron: identityConsumer('electron', 'C:/Yance/evidence/release-identity-observations/electron-release-identity.json'),
      backend: identityConsumer('backend', '/api/ready'),
      installer: identityConsumer('installer', 'C:/Yance/resources/installer-release-identity.json'),
      diagnostics: identityConsumer('diagnostics', '/api/r32/system/release-identity')
    },
    maximumConcurrentAppRuntimeOwners: 1,
    ownerSamples: [ownerSample(t0, [101])],
    hydrationCompletedBeforeReady: true,
    trustedOwnerVerified: true,
    projectionAgreementBeforeReady: true,
    duplicateRuntimeEntrypointCount: 0,
    oldBuildArtifactCount: 0,
    oldStagingArtifactCount: 0,
    apiContractVersion: 2,
    credentialProtocolVersion: 3,
    runtimeLockProtocolVersion: 1
  };
  const table = {
    'first-start': firstStart,
    'controlled-stop': {
      ownerExitConfirmed: true,
      runtimeStopConfirmed: true,
      stopResolutionStatus: 'PROCESS_EXIT_CONFIRMED'
    },
    restart: {
      localReady: true,
      ownerChanged: true,
      maximumConcurrentAppRuntimeOwners: 1,
      ownerSamples: [ownerSample(t0, [101]), ownerSample(t2, [202])],
      restartSource: 'controlled-restart'
    },
    'offline-start': {
      applicationProcessStartedAtUtc: t0,
      networkObservedAtUtc: t1,
      backendLaunchStartedAtUtc: t2,
      credentialHydrationCompletedAtUtc: t3,
      localReadyAtUtc: t4,
      networkUnavailableBeforeApplicationStart: true,
      networkUnavailableBeforeBackendStart: true,
      networkIsolationPreMainProof: true,
      networkIsolationProofPid: 101,
      networkIsolationProofParentPid: 100,
      networkIsolationProofNonce: '123e4567-e89b-42d3-a456-426614174000',
      networkIsolationProofSha256: 'a'.repeat(64),
      networkIsolationSourceSha256: 'b'.repeat(64),
      networkIsolationLibrarySha256: 'c'.repeat(64),
      networkIsolationProofClass: 'REVIEWED_NETWORK_ISOLATION_PROOF',
      nonLoopbackConnectDenied: true,
      loopbackConnectAllowed: true,
      backendStartedOffline: true,
      credentialHydrationCompletedOffline: true,
      localReadyFormedOffline: true,
      localReady: true,
      capabilityStateExplicit: true,
      falseOnlineCapabilityCount: 0
    },
    'crash-recovery': {
      maximumConcurrentAppRuntimeOwners: 1,
      overlapViolationCount: 0,
      trustedReplacementOwnerObserved: true,
      backendCrashRecoveryVerified: true,
      replacementOwnerPid: 202,
      oldOwnerExitAtUtc: t2,
      newOwnerAuthorityAtUtc: t3,
      recoveryStateSequence: ['LEASE_ACQUIRED','OWNER_EXIT_CONFIRMED','OWNER_RECOVERING','IDLE','LEASE_ACQUIRED','OWNER_EXIT_CONFIRMED','OWNER_RECOVERING','NEW_OWNER_STARTING','NEW_OWNER_HYDRATING','NEW_OWNER_READY','IDLE'],
      ownerExitConfirmedBeforeRecovery: true,
      ownerRecoveryCompletedBeforeReplacementStart: true,
      ownerSamples: [
        ownerSample(t0, [101]),
        ownerSample(t2, []),
        ownerSample(t3, [202])
      ],
      ownerIntervals: [
        { pid: 101, startedAtUtc: t0, endedAtUtc: t2 },
        { pid: 202, startedAtUtc: t3, endedAtUtc: null }
      ]
    },
    'safe-mode-negative': {
      sourceResults: ['legacy-file','environment','desktop-settings','renderer-storage','system-policy','combined-conflict'].map(safeModeRow),
      totalAuthorityChanges: 0
    },
    'credential-gate-negative': {
      illegalTransitionAttempted: true,
      illegalTransitionRejected: true,
      rejectionReasonCode: 'LIFECYCLE_TRANSITION_INVALID',
      fromState: 'runtime_state_ready',
      toState: 'local_ready',
      localReadyAtAttempt: false,
      hydrationCompleteAtAttempt: false,
      finalHydrationCompleted: true,
      finalLocalReady: true,
      attemptedAtUtc: t1,
      hydrationCompletedAtUtc: t2,
      localReadyAtUtc: t3
    },
    'event-gap-recovery': {
      injectedThroughProductionEventStore: true,
      detectedByProductionPollPath: true,
      privateRecoveryMethodCalledDirectly: false,
      snapshotRefetchForced: true,
      eventGapMetricIncremented: true,
      baselineRestored: true,
      expectedNextSequence: 10,
      oldestAvailableSequence: 11,
      lastAvailableSequence: 12
    },
    'boot-failure': {
      childProcessSpawned: true,
      generatedByFailedApplicationProcess: true,
      failureObserved: true,
      childExitCode: 72,
      childSignal: null,
      failedPhase: 'release-manifest-verification',
      reasonCode: 'BOOT_MANIFEST_MISSING',
      diagnosticBuildId: BUILD_ID,
      diagnosticPath: 'C:/evidence/boot-failure.json',
      diagnosticSha256: 'f'.repeat(64),
      diagnosticProducerPid: 202,
      parentProbePid: 101,
      startedAtUtc: t0,
      completedAtUtc: t1,
      stdoutSha256: '1'.repeat(64),
      stderrSha256: '2'.repeat(64)
    }
  };
  return structuredClone(table[probeId]);
}

function releaseIdentity() {
  return {
    buildId: BUILD_ID,
    productVersion: '29.2.5',
    stageVersion: '6.4.5.9',
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    manifestSha256: MANIFEST_SHA256,
    apiContractVersion: 2,
    credentialProtocolVersion: 3,
    runtimeLockProtocolVersion: 1
  };
}

module.exports = {
  BUILD_ID,
  BUILD_SESSION_ID,
  INSTALLER_SHA256,
  MANIFEST_SHA256,
  SOURCE_COMMIT,
  SOURCE_TREE,
  identityConsumer,
  measurementFor,
  ownerSample,
  releaseIdentity,
  safeModeRow,
  sha
};
