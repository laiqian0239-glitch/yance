'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertPolicy,
  assertWindowsIsolationAttestation
} = require('../../tools/wp7/windows-final-harness');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-final-harness.js'), 'utf8');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function policy(overrides = {}) {
  return {
    finalInstallationMode: 'CLEAN_INSTALL',
    legacyTestDataMigrationRequired: false,
    legacyTestVersionRollbackRequired: false,
    designatedValidationMachine: true,
    ...overrides
  };
}

function attestation(overrides = {}) {
  return {
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION',
    producerPid: 100,
    ownerPid: 100,
    elevatedWatchdogPid: 200,
    guardianPid: 201,
    guardianScriptSha256: HASH_C,
    executionNonce: '123e4567-e89b-42d3-a456-426614174000',
    buildSessionId: '1'.repeat(32),
    buildId: 'build-1',
    installerSha256: HASH_A,
    productExecutableSha256: HASH_B,
    mainEntrySha256: HASH_C,
    requestSha256: HASH_A,
    isolatedStateSha256: HASH_B,
    watchdogScriptSha256: HASH_C,
    launcherScriptSha256: HASH_D,
    controlProgramSha256: HASH_A,
    powerShellExecutableSha256: HASH_B,
    disableCommandPassed: true,
    disableCommand: {
      exitCode: 0,
      expectedExitCode: 0,
      passed: true,
      executionKind: 'POWERSHELL_CMDLET_BATCH',
      resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING',
      postconditionVerified: true,
      operations: [{ interfaceIndex: 15, exitCode: 0, passed: true, executionKind: 'POWERSHELL_CMDLET', resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING', invocationCompleted: true, commandName: 'Disable-NetAdapter' }]
    },
    adaptersBefore: [
      { interfaceIndex: 15, adminStatus: 'Up' },
      { interfaceIndex: 16, adminStatus: 'Down' }
    ],
    adaptersAfterDisable: [
      { interfaceIndex: 15, adminStatus: 'Down' },
      { interfaceIndex: 16, adminStatus: 'Down' }
    ],
    routesAfterDisable: [],
    isolationPostcondition: {
      passed: true,
      allOriginallyEnabledPhysicalAdaptersDisabled: true,
      allOriginallyEnabledIsolatableAdaptersDisabled: true,
      noDefaultRoutesRemain: true,
      remainingDefaultRouteCount: 0
    },
    ...overrides
  };
}

const expected = {
  producerPid: 100,
  ownerPid: 100,
  executionNonce: '123e4567-e89b-42d3-a456-426614174000',
  buildSessionId: '1'.repeat(32),
  buildId: 'build-1',
  installerSha256: HASH_A,
  productExecutableSha256: HASH_B,
  mainEntrySha256: HASH_C,
  controlProgramSha256: HASH_A
};

test('formal harness forbids caller-supplied network control commands', () => {
  assert.doesNotThrow(() => assertPolicy(policy()));
  assert.throws(
    () => assertPolicy(policy({ offlineNetworkControl: { disable: {}, restore: {} } })),
    (error) => error?.reasonCode === 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS'
  );
});

test('formal harness accepts only a hash-bound first-party attestation with independent guardian custody', () => {
  assert.equal(assertWindowsIsolationAttestation(attestation(), expected).guardianPid, 201);
  assert.throws(
    () => assertWindowsIsolationAttestation(attestation({ guardianPid: 200 }), expected),
    (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
  );
  assert.throws(
    () => assertWindowsIsolationAttestation(attestation({ routesAfterDisable: [{ destinationPrefix: '0.0.0.0/0' }] }), expected),
    (error) => error?.reasonCode === 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET'
  );
});

test('formal harness invokes the first-party control CLI and hash-binds its session before restore', () => {
  assert.match(source, /windows-network-isolation-control-cli\.js/);
  assert.match(source, /offlineSessionSha256 = sha256File\(offlineSessionPath\)/);
  assert.match(source, /'--session-sha256', offlineSessionSha256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_GUARDIAN_PID/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_PROGRAM_SHA256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_POWERSHELL_SHA256/);
  assert.match(source, /networkIsolationControlProgramSha256/);
  assert.match(source, /networkIsolationSessionSha256/);
  assert.doesNotMatch(source, /config\.offlineNetworkControl\.restore/);
  assert.doesNotMatch(source, /config\.offlineNetworkControl\.disable/);
});
