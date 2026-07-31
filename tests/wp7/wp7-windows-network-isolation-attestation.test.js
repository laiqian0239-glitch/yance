'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readNetworkIsolationStartupObservation } = require('../../electron/wp7InstalledRuntimeProbeProductionHost');
const { readPreMainProof } = require('../../tools/wp7/linux-network-isolation');

const EXECUTION_NONCE = '123e4567-e89b-42d3-a456-426614174000';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const HASH_F = 'f'.repeat(64);
const HASH_0 = '0'.repeat(64);
const HASH_9 = '9'.repeat(64);

function canonical(value) {
  function sort(input) {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-windows-network-'));
  const controlProgramPath = path.join(root, 'trusted', 'windows-network-isolation-control-cli.js');
  fs.mkdirSync(path.dirname(controlProgramPath), { recursive: true });
  fs.writeFileSync(controlProgramPath, 'trusted control program\n');
  const controlProgramHash = sha256(fs.readFileSync(controlProgramPath));
  const attestationPath = path.join(root, 'network-isolation', 'windows-control-attestation.json');
  const proofPath = path.join(root, 'network-isolation', `${EXECUTION_NONCE}.json`);
  fs.mkdirSync(path.dirname(attestationPath), { recursive: true });
  const document = {
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION',
    generatedAtUtc: '2026-07-11T00:00:00.500Z',
    producerPid: 100,
    ownerPid: 100,
    elevatedWatchdogPid: 400,
    guardianPid: 401,
    guardianScriptSha256: HASH_0,
    executionNonce: EXECUTION_NONCE,
    controlNonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    buildSessionId: '1'.repeat(32),
    buildId: 'build-1',
    installerSha256: HASH_A,
    productExecutableSha256: HASH_B,
    mainEntrySha256: HASH_C,
    requestSha256: HASH_E,
    isolatedStateSha256: HASH_F,
    watchdogScriptSha256: HASH_0,
    launcherScriptSha256: HASH_9,
    controlProgramSha256: controlProgramHash,
    powerShellExecutableSha256: HASH_A,
    disableCommandPassed: true,
    disableCommand: {
      id: 'windows-network-isolation-watchdog-disable',
      startedAtUtc: '2026-07-11T00:00:00.000Z',
      endedAtUtc: '2026-07-11T00:00:00.400Z',
      exitCode: 0,
      expectedExitCode: 0,
      passed: true,
      executionKind: 'POWERSHELL_CMDLET_BATCH',
      resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING',
      postconditionVerified: true,
      operationCount: 1,
      operations: [{ interfaceIndex: 15, exitCode: 0, passed: true, executionKind: 'POWERSHELL_CMDLET', resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING', invocationCompleted: true, commandName: 'Disable-NetAdapter' }]
    },
    adaptersBefore: [{ interfaceIndex: 15, adminStatus: 'Up', status: 'Up' }],
    adaptersAfterDisable: [{ interfaceIndex: 15, adminStatus: 'Down', status: 'Disabled' }],
    routesBefore: [{ destinationPrefix: '0.0.0.0/0', interfaceIndex: 15 }],
    routesAfterDisable: [],
    isolationPostcondition: {
      allOriginallyEnabledPhysicalAdaptersDisabled: true,
      allOriginallyEnabledIsolatableAdaptersDisabled: true,
      remainingDefaultRouteCount: 0,
      noDefaultRoutesRemain: true,
      passed: true
    }
  };
  fs.writeFileSync(attestationPath, canonical(document));
  const attestationHash = sha256(fs.readFileSync(attestationPath));
  const sessionPath = path.join(root, 'network-isolation', `${EXECUTION_NONCE}.session.json`);
  fs.writeFileSync(sessionPath, canonical({
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_SERIALIZED_HANDLE',
    attestationSha256: attestationHash,
    requestSha256: HASH_E,
    isolatedStateSha256: HASH_F,
    controlProgramSha256: controlProgramHash,
    powerShellExecutableSha256: HASH_A
  }));
  return { root, controlProgramPath, controlProgramHash, attestationPath, sessionPath, proofPath, hash: attestationHash, sessionHash: sha256(fs.readFileSync(sessionPath)) };
}

function options(value, overrides = {}) {
  return {
    platform: 'win32',
    processPid: 200,
    processParentPid: 100,
    applicationProcessStartedAtUtc: '2026-07-11T00:00:01.000Z',
    networkObservedAtUtc: '2026-07-11T00:00:01.001Z',
    backendLaunchStartedAtUtc: '2026-07-11T00:00:02.000Z',
    networkOnlineAtProcessStart: false,
    env: {
      WP7_PROBE_ROOT: value.root,
      WP7_PROBE_EXECUTION_NONCE: EXECUTION_NONCE,
      WP7_PROBE_BUILD_SESSION_ID: '1'.repeat(32),
      WP7_PROBE_EXPECTED_BUILD_ID: 'build-1',
      WP7_PROBE_INSTALLER_SHA256: HASH_A,
      WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: HASH_B,
      WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: HASH_C,
      WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN: '1',
      WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_PATH: value.attestationPath,
      WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_SHA256: value.hash,
      WP7_WINDOWS_NETWORK_ISOLATION_PROOF_PATH: value.proofPath,
      WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_SHA256: HASH_E,
      WP7_WINDOWS_NETWORK_ISOLATION_STATE_SHA256: HASH_F,
      WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_SHA256: HASH_0,
      WP7_WINDOWS_NETWORK_ISOLATION_LAUNCHER_SHA256: HASH_9,
      WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_PROGRAM_SHA256: value.controlProgramHash,
      WP7_WINDOWS_NETWORK_ISOLATION_POWERSHELL_SHA256: HASH_A,
      WP7_WINDOWS_NETWORK_ISOLATION_ELEVATED_PID: '400',
      WP7_WINDOWS_NETWORK_ISOLATION_GUARDIAN_PID: '401'
    },
    ...overrides
  };
}

test('Windows offline-start binds trusted parent control, execution nonce and early Electron observation', () => {
  const value = fixture();
  try {
    const observation = readNetworkIsolationStartupObservation(options(value));
    assert.equal(observation.networkUnavailableBeforeApplicationStart, true);
    assert.equal(observation.networkUnavailableBeforeBackendStart, true);
    assert.equal(observation.networkIsolationPreMainProof, true);
    assert.equal(observation.nonLoopbackConnectDenied, true);
    assert.equal(observation.loopbackConnectAllowed, true);
    assert.equal(observation.networkIsolationProofClass, 'WINDOWS_PARENT_CONTROL_AND_EARLY_ELECTRON_NETWORK_OBSERVATION');
    assert.match(observation.networkIsolationProofSha256, /^[0-9a-f]{64}$/);
    assert.equal(observation.networkIsolationSourceSha256, value.hash);
    assert.match(observation.networkIsolationLibrarySha256, /^[0-9a-f]{64}$/);
    const proof = readPreMainProof(observation.processProofPath, { pid: 200, parentPid: 100, nonce: EXECUTION_NONCE });
    assert.equal(proof.controlAttestationValid, true);
    assert.equal(proof.controlAttestationSha256, value.hash);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Windows offline-start rejects a tampered parent control attestation', () => {
  const value = fixture();
  try {
    fs.appendFileSync(value.attestationPath, '\n');
    assert.throws(
      () => readNetworkIsolationStartupObservation(options(value)),
      (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Windows offline-start rejects an attestation that is not bound to the probe nonce', () => {
  const value = fixture();
  try {
    const document = JSON.parse(fs.readFileSync(value.attestationPath, 'utf8'));
    document.executionNonce = crypto.randomUUID();
    fs.writeFileSync(value.attestationPath, canonical(document));
    value.hash = sha256(fs.readFileSync(value.attestationPath));
    assert.throws(
      () => readNetworkIsolationStartupObservation(options(value)),
      (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Windows offline-start rejects an online-at-process-start observation', () => {
  const value = fixture();
  try {
    assert.throws(
      () => readNetworkIsolationStartupObservation(options(value, { networkOnlineAtProcessStart: true })),
      (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Windows offline-start proof and attestation paths cannot escape the trusted probe root', () => {
  const value = fixture();
  try {
    assert.throws(
      () => readNetworkIsolationStartupObservation(options(value, {
        env: { ...options(value).env, WP7_WINDOWS_NETWORK_ISOLATION_PROOF_PATH: path.join(value.root, '..', 'escaped.json') }
      })),
      (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('final Windows harness validation re-verifies offline proof and control attestation custody', () => {
  const value = fixture();
  try {
    const { validateHarnessResult } = require('../../tools/wp7/final-context');
    const observation = readNetworkIsolationStartupObservation(options(value));
    const stdoutPath = path.join(value.root, 'commands', 'probe-offline-start.stdout.txt');
    const stderrPath = path.join(value.root, 'commands', 'probe-offline-start.stderr.txt');
    fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
    fs.writeFileSync(stdoutPath, '');
    fs.writeFileSync(stderrPath, '');
    const relative = (filePath) => path.relative(value.root, filePath).split(path.sep).join('/');
    const record = {
      id: 'probe-offline-start',
      executableSha256: HASH_D,
      startedAtUtc: '2026-07-11T00:00:01.000Z',
      endedAtUtc: '2026-07-11T00:00:03.000Z',
      exitCode: 0,
      stdoutPath: relative(stdoutPath),
      stdoutSha256: sha256(fs.readFileSync(stdoutPath)),
      stderrPath: relative(stderrPath),
      stderrSha256: sha256(fs.readFileSync(stderrPath)),
      probeProducerPid: 200,
      probeProducerParentPid: 100,
      probeExecutionNonce: EXECUTION_NONCE,
      networkIsolationProofPath: relative(value.proofPath),
      networkIsolationProofSha256: observation.networkIsolationProofSha256,
      networkIsolationProofPid: 200,
      networkIsolationProofParentPid: 100,
      networkIsolationProofNonce: EXECUTION_NONCE,
      networkIsolationControlAttestationPath: relative(value.attestationPath),
      networkIsolationControlAttestationSha256: value.hash,
      networkIsolationSessionPath: relative(value.sessionPath),
      networkIsolationSessionSha256: value.sessionHash,
      networkIsolationControlProgramPath: value.controlProgramPath,
      networkIsolationControlProgramSha256: value.controlProgramHash,
      networkIsolationElevatedWatchdogPid: 400,
      networkIsolationGuardianPid: 401
    };
    const result = {
      schemaVersion: 2,
      documentType: 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_RESULT',
      status: 'RAW_EVIDENCE_READY',
      actualPlatform: 'win32',
      platform: 'win32',
      fixtureMode: false,
      installerSha256: HASH_A,
      frozenSourceCommit: '1'.repeat(40),
      frozenSourceTree: '2'.repeat(40),
      commandResults: [record]
    };
    assert.equal(validateHarnessResult(result, { rootDir: value.root }), result);
    fs.appendFileSync(value.proofPath, '\n');
    assert.throws(
      () => validateHarnessResult(result, { rootDir: value.root }),
      (error) => error?.reasonCode === 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
