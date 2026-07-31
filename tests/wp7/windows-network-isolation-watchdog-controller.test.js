'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  WindowsIsolationWatchdogController,
  createWindowsWatchdogLauncher,
  withWindowsNetworkIsolation,
  canonical,
  overwriteExistingFile
} = require('../../tools/wp7/windows-network-isolation-watchdog-controller');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function stateFor(request, receipt, state, overrides = {}) {
  return {
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE',
    executionNonce: request.executionNonce,
    state,
    reason: state.toLowerCase(),
    generatedAtUtc: new Date().toISOString(),
    ownerPid: request.ownerPid,
    ownerSid: 'S-1-5-21-1000',
    elevatedWatchdogPid: receipt.elevatedProcessId,
    guardianPid: 23456,
    guardianScriptSha256: receipt.watchdogScriptSha256,
    requestSha256: receipt.requestSha256,
    watchdogScriptSha256: receipt.watchdogScriptSha256,
    launcherScriptSha256: receipt.launcherScriptSha256,
    powerShellExecutableSha256: receipt.powerShellExecutableSha256,
    restoreDeadlineUtc: request.restoreDeadlineUtc,
    adaptersBefore: [{ interfaceIndex: 15, name: 'Ethernet', adminStatus: 'Up', status: 'Up' }],
    routesBefore: [{ destinationPrefix: '0.0.0.0/0', interfaceIndex: 15 }],
    disableOperation: {
      startedAtUtc: new Date(Date.now() - 1000).toISOString(),
      endedAtUtc: new Date().toISOString(),
      exitCode: 0,
      expectedExitCode: 0,
      passed: true,
      operationCount: 1,
      operations: [{ interfaceIndex: 15, exitCode: 0, passed: true, executionKind: 'POWERSHELL_CMDLET', resultCodeSource: 'POWERSHELL_EXCEPTION_MAPPING', invocationCompleted: true, commandName: 'Disable-NetAdapter' }]
    },
    adaptersAfterDisable: [{ interfaceIndex: 15, name: 'Ethernet', adminStatus: 'Down', status: 'Disabled' }],
    routesAfterDisable: [],
    isolationPostcondition: {
      allOriginallyEnabledPhysicalAdaptersDisabled: true,
      allOriginallyEnabledIsolatableAdaptersDisabled: true,
      remainingDefaultRouteCount: 0,
      noDefaultRoutesRemain: true,
      passed: true
    },
    restorePostcondition: { passed: state === 'RESTORED' },
    ...overrides
  };
}

function fixture(finalState = 'RESTORED') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-watchdog-controller-'));
  const protectedRoot = path.join(root, 'protected');
  const alivePids = new Set([12345, 23456]);
  const launch = async ({ request, requestSha256 }) => {
    const receipt = {
      schemaVersion: 2,
      documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH',
      executionNonce: request.executionNonce,
      requestSha256,
      watchdogScriptSha256: HASH_A,
      launcherScriptSha256: HASH_B,
      powerShellExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      powerShellExecutableSha256: HASH_C,
      elevatedProcessId: 12345
    };
    const session = path.join(protectedRoot, request.executionNonce);
    const statePath = path.join(session, 'state.json');
    const isolatedPath = path.join(session, 'isolated-state.json');
    const releasePath = path.join(session, 'release.signal');
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(releasePath, '');
    const isolated = stateFor(request, receipt, 'ISOLATED');
    fs.writeFileSync(statePath, canonical(isolated));
    fs.writeFileSync(isolatedPath, canonical(isolated));
    const timer = setInterval(() => {
      if (!fs.existsSync(releasePath)) {
        clearInterval(timer);
        return;
      }
      if (fs.readFileSync(releasePath, 'utf8').trim()) {
        clearInterval(timer);
        const final = stateFor(request, receipt, finalState, {
          restorePostcondition: { passed: finalState === 'RESTORED' }
        });
        fs.writeFileSync(statePath, canonical(final));
        alivePids.clear();
      }
    }, 10);
    timer.unref();
    return receipt;
  };
  const controller = new WindowsIsolationWatchdogController({ root, protectedRoot, launch, processExists: (pid) => alivePids.has(pid) });
  return { root, protectedRoot, controller };
}

test('protected release overwrite truncates hostile trailing bytes without replacing the ACL-bound file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-release-overwrite-'));
  const filePath = path.join(root, 'release.signal');
  try {
    fs.writeFileSync(filePath, 'x'.repeat(4096));
    overwriteExistingFile(filePath, { schemaVersion: 2, status: 'RELEASE' });
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(document.schemaVersion, 2);
    assert.equal(document.status, 'RELEASE');
    assert.ok(fs.statSync(filePath).size < 4096);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('controller waits for verified isolated state then releases to verified restored state', async () => {
  const value = fixture();
  try {
    const handle = await value.controller.acquire({ executionNonce: crypto.randomUUID(), watchdogMs: 30_000 });
    assert.equal(handle.isolatedState.state, 'ISOLATED');
    assert.match(handle.isolatedStateSha256, /^[0-9a-f]{64}$/);
    const restored = await value.controller.release(handle);
    assert.equal(restored.state, 'RESTORED');
    assert.equal(restored.restorePostcondition.passed, true);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('controller rejects explicit restore failure', async () => {
  const value = fixture('RESTORE_FAILED');
  try {
    const handle = await value.controller.acquire({ executionNonce: crypto.randomUUID() });
    await assert.rejects(
      value.controller.release(handle),
      (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_RESTORE_FAILED'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('controller rejects state that is not bound to elevated watchdog PID', async () => {
  const value = fixture();
  try {
    const original = value.controller.launch;
    value.controller.launch = async (input) => {
      const receipt = await original(input);
      const statePath = path.join(value.protectedRoot, input.request.executionNonce, 'state.json');
      const isolatedPath = path.join(value.protectedRoot, input.request.executionNonce, 'isolated-state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.elevatedWatchdogPid += 1;
      fs.writeFileSync(statePath, canonical(state));
      fs.writeFileSync(isolatedPath, canonical(state));
      return receipt;
    };
    await assert.rejects(
      value.controller.acquire({ executionNonce: crypto.randomUUID() }),
      (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('controller rejects isolated state when the independent guardian is not alive', async () => {
  const value = fixture();
  try {
    value.controller.processExists = (pid) => pid === 12345;
    await assert.rejects(
      value.controller.acquire({ executionNonce: crypto.randomUUID() }),
      (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_PROCESS_CUSTODY_MISSING'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('controller fails release when elevated watchdog or guardian process remains alive after restore', async () => {
  const value = fixture();
  try {
    value.controller.processExists = () => true;
    value.controller.processExitTimeoutMs = 10;
    const handle = await value.controller.acquire({ executionNonce: crypto.randomUUID() });
    await assert.rejects(
      value.controller.release(handle),
      (error) => error?.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_PROCESS_RESIDUE'
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('real launcher factory is available without executing UAC', () => {
  assert.equal(typeof createWindowsWatchdogLauncher(), 'function');
});

test('operation failure still restores before propagating product failure', async () => {
  const calls = [];
  const provider = {
    async acquire() { calls.push('acquire'); return { executionNonce: crypto.randomUUID(), requestSha256: HASH_A }; },
    async release() { calls.push('release'); }
  };
  await assert.rejects(withWindowsNetworkIsolation(provider, async () => {
    calls.push('operation');
    throw new Error('product failed');
  }), /product failed/);
  assert.deepEqual(calls, ['acquire', 'operation', 'release']);
});

test('restore failure overrides product failure and preserves both causes', async () => {
  const provider = {
    async acquire() { return { executionNonce: crypto.randomUUID(), requestSha256: HASH_A }; },
    async release() {
      const error = new Error('restore failed');
      error.reasonCode = 'WP7_WINDOWS_NETWORK_ISOLATION_RESTORE_FAILED';
      throw error;
    }
  };
  await assert.rejects(
    withWindowsNetworkIsolation(provider, async () => { throw new Error('product failed'); }),
    (error) => error.reasonCode === 'WP7_WINDOWS_NETWORK_ISOLATION_RESTORE_FAILED'
      && error.details.operationError.message === 'product failed'
      && error.cause.message === 'product failed'
  );
});
