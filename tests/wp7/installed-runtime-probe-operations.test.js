'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInstalledRuntimeProbeOperations } = require('../../electron/wp7InstalledRuntimeProbeOperations');
const { validateMeasurements } = require('../../electron/wp7InstalledRuntimeProbe');
const { measurementFor, releaseIdentity } = require('./installed-runtime-probe-fixtures');

const tempRoots = new Set();
test.afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  tempRoots.clear();
});

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-probe-ops-'));
  tempRoots.add(dataRoot);
  const sqlitePath = path.join(dataRoot, 'store', 'yance-r32.db');
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  fs.writeFileSync(sqlitePath, 'db');
  const all = Object.fromEntries([
    'first-start','controlled-stop','restart','offline-start','crash-recovery','safe-mode-negative','credential-gate-negative','event-gap-recovery','boot-failure'
  ].map((id) => [id, measurementFor(id)]));
  const snapshot = {
    runtime: { localReady: true, online: false, operatingMode: 'normal', ownerInstanceId: 'owner-101' },
    capabilities: { whatsapp: 'temporarily_unavailable', telegram: 'no_accounts_configured' },
    credentialHydration: { entryCount: 0, restoredReferenceCount: 0 }
  };
  const projection = { trustedOwnerBound: true, backendStartInstance: 'session-1', runtime: { localReady: true, ownerInstanceId: 'owner-101' } };
  const deps = {
    releaseIdentity: releaseIdentity(),
    initialState: { dataRootExisted: false, sqliteExisted: false, oldProcessesDetected: 0, oldProcessesTerminated: 0, oldBuildArtifactCount: 0, oldStagingArtifactCount: 0 },
    dataRoot,
    sqlitePath,
    runtimeSnapshot: async () => snapshot,
    projectionSnapshot: () => projection,
    releaseIdentityConsumers: async () => all['first-start'].releaseIdentityConsumers,
    stopBackend: async () => ({ stopped: true, exitConfirmed: true, runtimeStop: { confirmed: true }, stopResolution: { status: 'PROCESS_EXIT_CONFIRMED' } }),
    restartWithOwnerTimeline: async () => all.restart,
    crashBackendAndRecover: async () => all['crash-recovery'],
    offlineStartupObservation: async () => {
      const row = { ...all['offline-start'] };
      delete row.localReady;
      delete row.capabilityStateExplicit;
      delete row.falseOnlineCapabilityCount;
      return row;
    },
    exerciseSafeModeSourceMatrix: async () => all['safe-mode-negative'],
    credentialReadyGateObservation: async () => all['credential-gate-negative'],
    triggerProductionEventGap: async () => all['event-gap-recovery'],
    runBootFailureProcess: async () => all['boot-failure'],
    currentOwnerObservation: async () => ({ maximumConcurrentAppRuntimeOwners: 1, ownerSamples: all['first-start'].ownerSamples }),
    scanInstalledRuntime: async () => ({ duplicateRuntimeEntrypointCount: 0 }),
    legacyDataRootConsumed: () => false
  };
  return { operations: createInstalledRuntimeProbeOperations(deps), dataRoot, all };
}

test('all nine installed runtime probe producers return semantically valid measurements', async () => {
  const { operations } = fixture();
  assert.deepEqual(Object.keys(operations).sort(), [
    'boot-failure','controlled-stop','crash-recovery','credential-gate-negative','event-gap-recovery','first-start','offline-start','restart','safe-mode-negative'
  ]);
  for (const [id, operation] of Object.entries(operations)) {
    const measurements = await operation();
    assert.ok(measurements && Object.keys(measurements).length > 0, `${id} produced no measurements`);
    assert.deepEqual(validateMeasurements(id, measurements), measurements);
  }
});

test('first-start derives fresh initialization and four independent release identities', async () => {
  const { operations } = fixture();
  const result = await operations['first-start']();
  assert.equal(result.freshInitialization, true);
  assert.equal(result.localReady, true);
  assert.equal(result.hydrationCompletedBeforeReady, true);
  assert.equal(result.credentialProtocolVersion, 3);
  assert.equal(result.duplicateRuntimeEntrypointCount, 0);
  assert.deepEqual(Object.keys(result.releaseIdentityConsumers).sort(), ['backend','diagnostics','electron','installer']);
  assert.equal(new Set(Object.values(result.releaseIdentityConsumers).map((row) => row.observationSource)).size, 4);
});

test('offline-start proves network absence before application and backend launch', async () => {
  const { operations } = fixture();
  const result = await operations['offline-start']();
  assert.equal(result.networkUnavailableBeforeApplicationStart, true);
  assert.equal(result.networkUnavailableBeforeBackendStart, true);
  assert.ok(Date.parse(result.networkObservedAtUtc) < Date.parse(result.backendLaunchStartedAtUtc));
  assert.equal(result.falseOnlineCapabilityCount, 0);
});

test('safe-mode negative covers all six authority inputs with zero effect', async () => {
  const { operations } = fixture();
  const result = await operations['safe-mode-negative']();
  assert.equal(result.sourceResults.length, 6);
  assert.equal(result.totalAuthorityChanges, 0);
  assert.ok(result.sourceResults.every((row) => row.sqliteAuthorityRetained && row.authorityChanges === 0));
});

test('credential, event-gap and boot-failure probes exercise real negative paths', async () => {
  const { operations } = fixture();
  const credential = await operations['credential-gate-negative']();
  assert.equal(credential.illegalTransitionAttempted, true);
  assert.equal(credential.illegalTransitionRejected, true);
  const gap = await operations['event-gap-recovery']();
  assert.equal(gap.injectedThroughProductionEventStore, true);
  assert.equal(gap.privateRecoveryMethodCalledDirectly, false);
  const boot = await operations['boot-failure']();
  assert.notEqual(boot.diagnosticProducerPid, boot.parentProbePid);
});
