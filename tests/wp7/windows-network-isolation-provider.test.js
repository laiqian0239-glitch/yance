'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowsNetworkIsolationProvider } = require('../../tools/wp7/windows-network-isolation-provider');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function handle() {
  return {
    executionNonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestSha256: HASH_A,
    isolatedStateSha256: HASH_B,
    protectedSessionRoot: 'C:\\ProgramData\\Yance\\WP7NetworkIsolation\\session',
    launchReceipt: {
      elevatedProcessId: 400,
      watchdogScriptSha256: HASH_C,
      launcherScriptSha256: HASH_D,
      powerShellExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      powerShellExecutableSha256: HASH_A
    },
    isolatedState: {
      state: 'ISOLATED',
      ownerPid: 100,
      elevatedWatchdogPid: 400,
      guardianPid: 401,
      guardianScriptSha256: HASH_C,
      requestSha256: HASH_A,
      watchdogScriptSha256: HASH_C,
      launcherScriptSha256: HASH_D,
      powerShellExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      powerShellExecutableSha256: HASH_A,
      staleRecoveryCount: 1,
      disableOperation: {
        startedAtUtc: '2026-07-11T00:00:00.000Z',
        endedAtUtc: '2026-07-11T00:00:00.500Z',
        exitCode: 0,
        expectedExitCode: 0,
        passed: true,
        executionKind: 'POWERSHELL_CMDLET_BATCH',
        resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING',
        postconditionVerified: true,
        operationCount: 1,
        operations: [{ interfaceIndex: 15, exitCode: 0, passed: true, executionKind: 'POWERSHELL_CMDLET', resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING', invocationCompleted: true, commandName: 'Disable-NetAdapter' }]
      },
      adaptersBefore: [{ interfaceIndex: 15, adminStatus: 'Up' }],
      adaptersAfterDisable: [{ interfaceIndex: 15, adminStatus: 'Down' }],
      routesBefore: [{ destinationPrefix: '0.0.0.0/0', interfaceIndex: 15 }],
      routesAfterDisable: [],
      isolationPostcondition: {
        allOriginallyEnabledPhysicalAdaptersDisabled: true,
      allOriginallyEnabledIsolatableAdaptersDisabled: true,
        remainingDefaultRouteCount: 0,
        noDefaultRoutesRemain: true,
        passed: true
      }
    }
  };
}

test('provider delegates acquire and release to the durable elevated watchdog controller', async () => {
  const calls = [];
  const expected = handle();
  const controller = {
    async acquire(options) { calls.push(['acquire', options]); return expected; },
    async release(value) { calls.push(['release', value]); return { state: 'RESTORED' }; }
  };
  const provider = new WindowsNetworkIsolationProvider({ controller });
  assert.equal(await provider.acquire({ watchdogMs: 90_000 }), expected);
  assert.deepEqual(await provider.release(expected), { state: 'RESTORED' });
  assert.equal(calls[0][0], 'acquire');
  assert.equal(calls[1][0], 'release');
});

test('provider creates schema v2 attestation from real watchdog operation evidence', () => {
  const provider = new WindowsNetworkIsolationProvider({ controller: { acquire() {}, release() {} } });
  const attestation = provider.createControlAttestation(handle(), {
    producerPid: 100,
    executionNonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    buildSessionId: '1'.repeat(32),
    buildId: 'build-1',
    installerSha256: HASH_A,
    productExecutableSha256: HASH_B,
    mainEntrySha256: HASH_C,
    controlProgramSha256: HASH_D
  });
  assert.equal(attestation.schemaVersion, 2);
  assert.equal(attestation.producerPid, 100);
  assert.equal(attestation.ownerPid, 100);
  assert.equal(attestation.elevatedWatchdogPid, 400);
  assert.equal(attestation.guardianPid, 401);
  assert.equal(attestation.requestSha256, HASH_A);
  assert.equal(attestation.isolatedStateSha256, HASH_B);
  assert.equal(attestation.controlProgramSha256, HASH_D);
  assert.equal(attestation.powerShellExecutableSha256, HASH_A);
  assert.equal(attestation.disableCommand.exitCode, 0);
  assert.equal(attestation.disableCommand.operations.length, 1);
  assert.equal(attestation.isolationPostcondition.passed, true);
});

test('provider refuses to attest unverified isolation', () => {
  const provider = new WindowsNetworkIsolationProvider({ controller: { acquire() {}, release() {} } });
  const invalid = handle();
  invalid.isolatedState.isolationPostcondition.passed = false;
  assert.throws(
    () => provider.createControlAttestation(invalid, { producerPid: 100 }),
    (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID'
  );
});

test('provider withIsolation restores after operation failure', async () => {
  const calls = [];
  const controller = {
    async acquire() { calls.push('acquire'); return handle(); },
    async release() { calls.push('release'); }
  };
  const provider = new WindowsNetworkIsolationProvider({ controller });
  await assert.rejects(provider.withIsolation(async () => {
    calls.push('operation');
    throw new Error('operation failed');
  }), /operation failed/);
  assert.deepEqual(calls, ['acquire', 'operation', 'release']);
});
