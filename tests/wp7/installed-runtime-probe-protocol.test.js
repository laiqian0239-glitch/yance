'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FORMAL_PROBE_IDS,
  bindProbeIdentity,
  executeInstalledRuntimeProbe,
  readInstalledRuntimeProbeRequest,
  validateMeasurements
} = require('../../electron/wp7InstalledRuntimeProbe');
const {
  BUILD_ID, BUILD_SESSION_ID, INSTALLER_SHA256, SOURCE_COMMIT, SOURCE_TREE, measurementFor, releaseIdentity
} = require('./installed-runtime-probe-fixtures');
const { sha256 } = require('../../shared/release/identityObservation');
const crypto = require('node:crypto');
const REPO = path.resolve(__dirname, '..', '..');
const MAIN_ENTRY = path.join(REPO, 'electron', 'main.js');
const EXECUTABLE_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const MAIN_ENTRY_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(MAIN_ENTRY)).digest('hex');

const tempRoots = new Set();
test.afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  tempRoots.clear();
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-installed-probe-'));
  tempRoots.add(root);
  fs.mkdirSync(path.join(root, 'probe-results'), { recursive: true });
  return root;
}
function envFor(root, probeId = 'first-start') {
  return {
    WP7_PROBE_ID: probeId,
    WP7_PROBE_ROOT: root,
    WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', `${probeId}.json`),
    WP7_PROBE_BUILD_SESSION_ID: BUILD_SESSION_ID,
    WP7_PROBE_INSTALLER_SHA256: INSTALLER_SHA256,
    WP7_PROBE_EXPECTED_BUILD_ID: BUILD_ID,
    WP7_PROBE_EXPECTED_SOURCE_COMMIT: SOURCE_COMMIT,
    WP7_PROBE_EXPECTED_SOURCE_TREE: SOURCE_TREE,
    WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000',
    WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: EXECUTABLE_SHA256,
    WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: MAIN_ENTRY_SHA256
  };
}

function preReviewEnvFor(root, probeId = 'first-start') {
  const env = envFor(root, probeId);
  env.WP7_PROBE_EXECUTION_CLASS = 'PRE_REVIEW_PACKAGED_INTEGRATION';
  delete env.WP7_PROBE_INSTALLER_SHA256;
  env.WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_SHA256 = 'f'.repeat(64);
  env.WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_TYPE = 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1';
  return env;
}

function reason(fn, expected) {
  assert.throws(fn, (error) => error?.reasonCode === expected);
}

for (const probeId of FORMAL_PROBE_IDS) {
  test(`formal probe request accepts ${probeId}`, () => {
    const root = tempRoot();
    const request = readInstalledRuntimeProbeRequest(envFor(root, probeId), { isPackaged: true, platform: 'win32' });
    assert.equal(request.probeId, probeId);
    assert.equal(request.outputPath, path.join(root, 'probe-results', `${probeId}.json`));
  });
}


test('pre-review packaged probe uses the verified sealed artifact identity and rejects installer hash substitution', async () => {
  const root = tempRoot();
  const env = preReviewEnvFor(root);
  const request = readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'linux', allowPreReviewPackagedIntegration: true });
  assert.equal(request.preReviewSealedArtifactSha256, 'f'.repeat(64));
  assert.equal(request.preReviewSealedArtifactType, 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1');
  assert.equal(request.installerSha256, undefined);
  const result = await executeInstalledRuntimeProbe(request, {
    releaseIdentity: releaseIdentity(),
    platform: 'linux',
    producerExecutablePath: process.execPath,
    producerMainEntryPath: MAIN_ENTRY,
    operations: { 'first-start': async () => measurementFor('first-start') }
  });
  assert.equal(result.preReviewSealedArtifactSha256, 'f'.repeat(64));
  assert.equal(result.preReviewSealedArtifactType, 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1');
  assert.equal(result.installerSha256, undefined);

  const root2 = tempRoot();
  const substituted = preReviewEnvFor(root2);
  substituted.WP7_PROBE_INSTALLER_SHA256 = INSTALLER_SHA256;
  reason(() => readInstalledRuntimeProbeRequest(substituted, { isPackaged: true, platform: 'linux', allowPreReviewPackagedIntegration: true }), 'WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID');
});

test('unknown probe ID is rejected', () => {
  const root = tempRoot();
  reason(() => readInstalledRuntimeProbeRequest(envFor(root, 'unknown'), { isPackaged: true, platform: 'win32' }), 'WP7_INSTALLED_RUNTIME_PROBE_ID_UNKNOWN');
});

test('source-mode and non-Windows formal probes are rejected', () => {
  const root = tempRoot();
  reason(() => readInstalledRuntimeProbeRequest(envFor(root), { isPackaged: false, platform: 'win32' }), 'WP7_INSTALLED_RUNTIME_PROBE_PACKAGED_APP_REQUIRED');
  reason(() => readInstalledRuntimeProbeRequest(envFor(root), { isPackaged: true, platform: 'linux' }), 'WP7_WINDOWS_FINAL_BUILD_REQUIRED');
});

test('probe output path cannot escape or change the formal filename', () => {
  const root = tempRoot();
  const escaped = { ...envFor(root), WP7_PROBE_OUTPUT_PATH: path.join(root, '..', 'first-start.json') };
  reason(() => readInstalledRuntimeProbeRequest(escaped, { isPackaged: true, platform: 'win32' }), 'WP7_PROBE_OUTPUT_PATH_INVALID');
  const wrong = { ...envFor(root), WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', 'other.json') };
  reason(() => readInstalledRuntimeProbeRequest(wrong, { isPackaged: true, platform: 'win32' }), 'WP7_PROBE_OUTPUT_PATH_INVALID');
});

test('stale probe result is rejected before execution', () => {
  const root = tempRoot();
  const env = envFor(root);
  fs.writeFileSync(env.WP7_PROBE_OUTPUT_PATH, '{}');
  reason(() => readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' }), 'WP7_PROBE_STALE_RESULT_PRESENT');
});

test('release identity must match the sealed probe context', () => {
  const root = tempRoot();
  const request = readInstalledRuntimeProbeRequest(envFor(root), { isPackaged: true, platform: 'win32' });
  assert.equal(bindProbeIdentity(request, releaseIdentity()).frozenSourceTree, SOURCE_TREE);
  reason(() => bindProbeIdentity(request, { ...releaseIdentity(), sourceTree: 'e'.repeat(40) }), 'WP7_INSTALLED_RUNTIME_PROBE_IDENTITY_MISMATCH');
});

test('probe result is written once with canonical identity and fresh measurements', async () => {
  const root = tempRoot();
  const request = readInstalledRuntimeProbeRequest(envFor(root), { isPackaged: true, platform: 'win32' });
  const result = await executeInstalledRuntimeProbe(request, {
    releaseIdentity: releaseIdentity(),
    platform: 'win32',
    producerExecutablePath: process.execPath,
    producerMainEntryPath: MAIN_ENTRY,
    operations: { 'first-start': async () => measurementFor('first-start') }
  });
  assert.equal(result.documentType, 'WP7_INSTALLED_RUNTIME_PROBE_RESULT');
  assert.equal(result.status, 'PASS');
  assert.equal(result.actualPlatform, 'win32');
  assert.equal(result.fixtureMode, false);
  assert.equal(result.measurements.localReady, true);
  assert.equal(result.installerSha256, INSTALLER_SHA256);
  assert.equal(result.producerPid, process.pid);
  assert.equal(result.producerParentPid, process.ppid);
  assert.equal(result.producerExecutableSha256, EXECUTABLE_SHA256);
  assert.equal(result.producerMainEntrySha256, MAIN_ENTRY_SHA256);
  assert.deepEqual(JSON.parse(fs.readFileSync(request.outputPath, 'utf8')), result);
});

test('missing producer and caller attempts to override result fields are rejected', async () => {
  const root1 = tempRoot();
  const request1 = readInstalledRuntimeProbeRequest(envFor(root1), { isPackaged: true, platform: 'win32' });
  await assert.rejects(() => executeInstalledRuntimeProbe(request1, { releaseIdentity: releaseIdentity(), platform: 'win32', operations: {} }), (error) => error?.reasonCode === 'WP7_INSTALLED_RUNTIME_PROBE_IMPLEMENTATION_MISSING');

  const root2 = tempRoot();
  const request2 = readInstalledRuntimeProbeRequest(envFor(root2), { isPackaged: true, platform: 'win32' });
  await assert.rejects(() => executeInstalledRuntimeProbe(request2, {
    releaseIdentity: releaseIdentity(), platform: 'win32', producerExecutablePath: process.execPath, producerMainEntryPath: MAIN_ENTRY, operations: { 'first-start': async () => ({ status: 'PASS' }) }
  }), (error) => error?.reasonCode === 'WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_INVALID');
});


test('all nine formal semantic measurement fixtures are accepted', () => {
  for (const probeId of FORMAL_PROBE_IDS) assert.deepEqual(validateMeasurements(probeId, measurementFor(probeId)), measurementFor(probeId));
});

test('null, undefined, arrays and empty objects cannot satisfy a formal probe oracle', () => {
  for (const value of [null, undefined, [], {}]) {
    reason(() => validateMeasurements('first-start', value), 'WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_MISSING');
  }
});

test('semantic omissions and self-confirming shortcuts are rejected', () => {
  const cases = [
    ['offline-start', 'networkUnavailableBeforeApplicationStart', false],
    ['credential-gate-negative', 'illegalTransitionAttempted', false],
    ['event-gap-recovery', 'privateRecoveryMethodCalledDirectly', true],
    ['crash-recovery', 'maximumConcurrentAppRuntimeOwners', 2],
    ['boot-failure', 'diagnosticProducerPid', 101]
  ];
  for (const [probeId, key, value] of cases) {
    const measurements = measurementFor(probeId);
    measurements[key] = value;
    assert.throws(() => validateMeasurements(probeId, measurements), (error) => Boolean(error?.reasonCode));
  }
});

test('safe-mode negative requires all six authority sources', () => {
  const measurements = measurementFor('safe-mode-negative');
  measurements.sourceResults.pop();
  reason(() => validateMeasurements('safe-mode-negative', measurements), 'WP7_SAFE_MODE_NEGATIVE_SOURCE_MATRIX_INCOMPLETE');
});

test('independent release consumers cannot be copied, relabelled or self-declared', () => {
  {
    const measurements = measurementFor('first-start');
    measurements.releaseIdentityConsumers.installer.consumer = 'electron';
    reason(() => validateMeasurements('first-start', measurements), 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE');
  }
  {
    const measurements = measurementFor('first-start');
    const installer = measurements.releaseIdentityConsumers.installer;
    installer.independentlyObserved = true;
    const unsigned = { ...installer };
    delete unsigned.observationSha256;
    installer.observationSha256 = sha256(unsigned);
    reason(() => validateMeasurements('first-start', measurements), 'WP7_RUNTIME_PROBE_ACCEPTANCE_ORACLE_SELF_CONFIRMATION');
  }
  {
    const measurements = measurementFor('first-start');
    const electron = measurements.releaseIdentityConsumers.electron;
    const installer = measurements.releaseIdentityConsumers.installer;
    installer.observationSource = electron.observationSource;
    installer.sourceDocumentSha256 = electron.sourceDocumentSha256;
    const unsigned = { ...installer };
    delete unsigned.observationSha256;
    installer.observationSha256 = sha256(unsigned);
    reason(() => validateMeasurements('first-start', measurements), 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE');
  }
  {
    const measurements = measurementFor('first-start');
    const diagnostics = measurements.releaseIdentityConsumers.diagnostics;
    diagnostics.producerType = 'electron-main';
    const unsigned = { ...diagnostics };
    delete unsigned.observationSha256;
    diagnostics.observationSha256 = sha256(unsigned);
    reason(() => validateMeasurements('first-start', measurements), 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE');
  }
});
