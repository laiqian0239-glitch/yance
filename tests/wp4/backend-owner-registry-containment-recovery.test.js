'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const {
  BackendOwnerRegistry,
  processIdentityMatches,
  validateOwnerRecord,
  validateProcessIdentity,
  windowsProcessIdentity
} = require('../../electron/desktopHost/BackendOwnerRegistry');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-owner-registry-')); }
function identity(pid, suffix = 'a') { return { platform: 'test', startTicks: `${pid}-${suffix}`, commandDigest: `cmd-${pid}-${suffix}` }; }
function writeLiveOwner(file, pid, processIdentity = identity(pid)) {
  const registry = new BackendOwnerRegistry({ file, isProcessAlive: () => true, captureIdentity: () => processIdentity });
  registry.register({ state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: pid, startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f', ownerSession: { backendPid: pid }, processIdentity });
}


test('spawn identity failure before owner claim terminates child without false rejected-owner containment', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const child = new EventEmitter();
    child.pid = 43210;
    child.exitCode = null;
    child.signalCode = null;
    child.connected = false;
    child.stdio = [];
    child.kill = signal => {
      process.nextTick(() => {
        child.exitCode = signal === 'SIGTERM' ? 0 : 1;
        child.signalCode = signal;
        child.__desktopHostExited = true;
        child.emit('exit', child.exitCode, signal);
      });
      return true;
    };
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      fork: () => child,
      isProcessAlive: pid => pid === child.pid && child.exitCode === null,
      captureProcessIdentity: () => null
    });

    await assert.rejects(host.start({
      entry: __filename,
      cwd: dir,
      nodeRuntimeExecutablePath: process.execPath,
      releaseStartupConfig: { manifestSha256: 'a'.repeat(64), expectedBuildId: 'b', resourcesPath: dir },
      credentialHandshakeRequired: false,
      forceExitTimeoutMs: 100
    }), error => {
      assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID');
      assert.equal(error.rejectedOwnerContainmentSkipped, true);
      assert.equal(error.rejectedOwnerContainmentSkippedReason, 'CHILD_FAILED_BEFORE_OWNER_CLAIM');
      return true;
    });
    assert.equal(host.snapshot().rejectedOwner, null);
    assert.equal(host.snapshot().ownerRegistry, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('orphan owner registry restores a live backend as rejected and terminates it without ChildProcess ownership', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43121;
    writeLiveOwner(file, pid);
    let live = true;
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: value => value === pid && live,
      captureProcessIdentity: value => identity(value),
      killProcess(value, signal) { signals.push([value, signal]); if (value === pid && signal === 'SIGTERM') live = false; return true; }
    });
    assert.equal(host.snapshot().ownerTrusted, false);
    assert.equal(host.snapshot().rejectedOwner.restoredFromOwnerRegistry, true);
    assert.equal(host.getApiSessionToken(), '');
    await assert.rejects(host.start({}), error => error.reasonCode === 'WP4_DESKTOP_REJECTED_OWNER_STILL_LIVE');
    const stopped = await host.stop({ gracefulMs: 30, forceMs: 30 });
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.exitConfirmed, true);
    assert.deepEqual(signals[0], [pid, 'SIGTERM']);
    assert.equal(await host.clearRejectedOwner(), true);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('live identity-matched rejected owner marker cannot clear before real process exit', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43125;
    writeLiveOwner(file, pid);
    let live = true;
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: value => value === pid && live,
      captureProcessIdentity: value => identity(value)
    });
    assert.equal(host.snapshot().ownerTrusted, false);
    assert.equal(host.snapshot().rejectedOwner.childStillLive, true);
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_REJECTED_OWNER_STILL_LIVE');
    assert.ok(host.snapshot().rejectedOwner);
    assert.notEqual(host.snapshot().ownerRegistry.state, 'RECOVERED');
    live = false;
    assert.equal(await host.clearRejectedOwner(), true);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('PID reuse never kills the reused process and permits recovery of only the stale owner identity', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43122;
    writeLiveOwner(file, pid, identity(pid, 'old'));
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: value => value === pid,
      captureProcessIdentity: value => identity(value, 'new'),
      killProcess(value, signal) { signals.push([value, signal]); return true; }
    });
    assert.equal(host.snapshot().rejectedOwner.pidIdentityMatch, false);
    assert.equal(host.snapshot().ownerRegistryFailure.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED');
    const stopped = await host.stop();
    assert.equal(stopped.stopped, false);
    assert.equal(stopped.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED');
    assert.equal(signals.length, 0);
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
    assert.equal(await host.clearRejectedOwner({ force: true }), true);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('EPERM or unverifiable orphan liveness remains contained and cannot clear the rejected marker', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43123;
    writeLiveOwner(file, pid);
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive() { const error = new Error('permission denied'); error.code = 'EPERM'; throw error; },
      captureProcessIdentity: () => null,
      killProcess() { const error = new Error('permission denied'); error.code = 'EPERM'; throw error; }
    });
    assert.equal(host.snapshot().ownerTrusted, false);
    const stopped = await host.stop({ gracefulMs: 25, forceMs: 25 });
    assert.equal(stopped.stopped, false);
    assert.match(stopped.reasonCode, /EPERM|UNVERIFIED/);
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('corrupt owner registry is not overwritten or automatically recovered', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    fs.writeFileSync(file, '{"schemaVersion":1,"backendPid":');
    const original = fs.readFileSync(file, 'utf8');
    const host = new BackendProcessHost({ ownerRecordPath: file, isProcessAlive: () => true, captureProcessIdentity: () => null });
    assert.equal(host.snapshot().ownerTrusted, false);
    assert.equal(host.snapshot().ownerRegistryFailure.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID');
    assert.equal(host.getApiSessionToken(), '');
    const marker = await host.containRejectedOwner({ reasonCode: 'JOURNAL_CORRUPT' });
    assert.equal(marker.ownerRecordDurable, false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    const stopped = await host.stop();
    assert.equal(stopped.stopped, false);
    assert.equal(stopped.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID');
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

function validPersistentOwner(pid = 43124) {
  return {
    schemaVersion: 1,
    state: 'RUNNING',
    ownershipActive: true,
    trusted: true,
    backendPid: pid,
    startupNonce: 'startup-nonce',
    backendSessionId: 'backend-session',
    fd6PipeInstanceId: 'fd6-instance',
    processIdentity: identity(pid),
    ownerSession: { backendPid: pid },
    reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED'
  };
}

async function assertSemanticRecordFailsClosed(record, expectedField = '') {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const original = fs.readFileSync(file, 'utf8');
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: () => true,
      captureProcessIdentity: pid => identity(pid)
    });
    const snapshot = host.snapshot();
    assert.equal(snapshot.ownerTrusted, false);
    assert.equal(snapshot.ownerRegistry, null);
    assert.equal(snapshot.ownerRegistryFailure.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID');
    assert.equal(snapshot.ownerRegistryFailure.recoveryRequired, true);
    if (expectedField) assert.equal(snapshot.ownerRegistryFailure.details?.field, expectedField);
    assert.equal(host.getApiSessionToken(), '');
    assert.equal(snapshot.credentialCustody, null);
    await assert.rejects(host.start({}), error => {
      assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID');
      return true;
    });
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'semantic-invalid owner record must not be silently overwritten');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test('syntax-valid but semantically invalid active owner records fail closed before replacement start', async t => {
  const cases = [
    ['RUNNING active owner with PID zero', record => { record.backendPid = 0; }, 'backendPid'],
    ['negative backend PID', record => { record.backendPid = -7; }, 'backendPid'],
    ['fractional backend PID', record => { record.backendPid = 7.5; }, 'backendPid'],
    ['string backend PID', record => { record.backendPid = '43124'; }, 'backendPid'],
    ['missing startupNonce', record => { delete record.startupNonce; }, 'startupNonce'],
    ['missing backendSessionId', record => { delete record.backendSessionId; }, 'backendSessionId'],
    ['missing fd6PipeInstanceId', record => { delete record.fd6PipeInstanceId; }, 'fd6PipeInstanceId'],
    ['active ownership in terminal state', record => { record.state = 'EXITED'; }, ''],
    ['live STARTING state without active ownership', record => { record.state = 'STARTING'; record.ownershipActive = false; record.trusted = false; }, ''],
    ['trusted owner without ownership', record => { record.state = 'EXITED'; record.ownershipActive = false; }, ''],
    ['untrusted RUNNING record claiming accepted runtime', record => { record.trusted = false; }, ''],
    ['missing process identity', record => { delete record.processIdentity; }, 'processIdentity'],
    ['unknown state', record => { record.state = 'RUNNING_V2'; }, 'state'],
    ['ownershipActive wrong type', record => { record.ownershipActive = 'true'; }, 'ownershipActive'],
    ['trusted wrong type', record => { record.trusted = 1; }, 'trusted'],
    ['legacy and current PID fields mixed', record => { record.pid = record.backendPid; }, 'pid'],
    ['string schema version mixed with current fields', record => { record.schemaVersion = '1'; }, 'schemaVersion'],
    ['inactive state with active ownership contradiction', record => { record.state = 'RECOVERED'; record.trusted = false; }, '']
  ];
  for (const [name, mutate, field] of cases) {
    await t.test(name, async () => {
      const record = validPersistentOwner();
      mutate(record);
      await assertSemanticRecordFailsClosed(record, field);
    });
  }
});

test('RUNNING untrusted record is accepted only for the explicit pre-acceptance state', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const record = validPersistentOwner();
    record.trusted = false;
    record.reasonCode = 'BACKEND_READY_AWAITING_APPLICATION_VALIDATION';
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const registry = new BackendOwnerRegistry({ file, isProcessAlive: () => true, captureIdentity: pid => identity(pid) });
    assert.equal(registry.loadFailure, null);
    assert.equal(registry.snapshot().trusted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('persisted owner identity mismatch establishes registry recovery failure and never kills the reused PID', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43125;
    writeLiveOwner(file, pid, identity(pid, 'old'));
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: value => value === pid,
      captureProcessIdentity: value => identity(value, 'new'),
      killProcess(value, signal) { signals.push([value, signal]); return true; }
    });
    const snapshot = host.snapshot();
    assert.equal(snapshot.ownerTrusted, false);
    assert.equal(snapshot.ownerRegistryFailure.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED');
    assert.equal(snapshot.rejectedOwner.pidIdentityMatch, false);
    await assert.rejects(host.start({}), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED');
    const stopped = await host.stop();
    assert.equal(stopped.stopped, false);
    assert.equal(signals.length, 0);
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
    assert.equal(await host.clearRejectedOwner({ force: true }), true);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('live owner whose process identity cannot be read remains registry-failed and replacement-blocked', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43126;
    writeLiveOwner(file, pid);
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: value => value === pid,
      captureProcessIdentity: () => null
    });
    const snapshot = host.snapshot();
    assert.equal(snapshot.ownerTrusted, false);
    assert.equal(snapshot.ownerRegistryFailure.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED');
    assert.equal(snapshot.rejectedOwner.childStillLive, true);
    await assert.rejects(host.start({}), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED');
    await assert.rejects(host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('durable active owner proven exited still requires an explicit RECOVERED transition before replacement', async () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const pid = 43127;
    writeLiveOwner(file, pid);
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      isProcessAlive: () => false,
      captureProcessIdentity: value => identity(value)
    });
    const snapshot = host.snapshot();
    assert.equal(snapshot.ownerTrusted, false);
    assert.equal(snapshot.rejectedOwner.reasonCode, 'WP4_DESKTOP_ORPHAN_OWNER_EXIT_RECOVERY_REQUIRED');
    await assert.rejects(host.start({}), error => error.reasonCode === 'WP4_DESKTOP_REJECTED_OWNER_RECOVERY_REQUIRED');
    assert.equal(await host.clearRejectedOwner(), true);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});


test('Windows native process identity is normalized and PID reuse is distinguished by creation time and digests', () => {
  const calls = [];
  const execFile = (command, args, options) => {
    calls.push({ command, args, options });
    return JSON.stringify({
      ProcessId: 43128,
      CreationDate: '2026-07-04T03:01:02.1234567Z',
      ExecutablePath: 'C:\\Program Files\\Yance\\backend.exe',
      CommandLine: '"C:\\Program Files\\Yance\\backend.exe" --fd6 6'
    });
  };
  const captured = windowsProcessIdentity(43128, execFile, 'win32');
  assert.equal(captured.platform, 'win32');
  assert.equal(captured.creationTimeUtc, '2026-07-04T03:01:02.1234567Z');
  assert.match(captured.executablePathDigest, /^[a-f0-9]{64}$/);
  assert.match(captured.commandDigest, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /(?:^|[\\/])powershell\.exe$/i);
  assert.match(calls[0].args.join(' '), /YanceNativeProcessIdentity/);
  assert.equal(validateProcessIdentity(captured), true);
  assert.equal(processIdentityMatches(captured, { ...captured }), true);
  assert.equal(processIdentityMatches(captured, { ...captured, creationTimeUtc: '2026-07-04T03:01:03.1234567Z' }), false);
  assert.equal(processIdentityMatches(captured, { ...captured, commandDigest: '0'.repeat(64) }), false);
});

test('Windows process identity capture fails closed when authority data is absent, partial, mismatched, or unreadable', () => {
  const responses = [
    JSON.stringify({ ProcessId: 999, CreationDate: '2026-07-04T03:01:02Z', ExecutablePath: 'C:\\x.exe', CommandLine: 'x' }),
    JSON.stringify({ ProcessId: 43129, CreationDate: '', ExecutablePath: 'C:\\x.exe', CommandLine: 'x' }),
    JSON.stringify({ ProcessId: 43129, CreationDate: '2026-07-04T03:01:02Z', ExecutablePath: '', CommandLine: 'x' }),
    JSON.stringify({ ProcessId: 43129, CreationDate: '2026-07-04T03:01:02Z', ExecutablePath: 'C:\\x.exe', CommandLine: '' }),
    'not-json'
  ];
  for (const response of responses) {
    assert.equal(windowsProcessIdentity(43129, () => response, 'win32'), null);
  }
  assert.equal(windowsProcessIdentity(43129, () => { throw new Error('access denied'); }, 'win32'), null);
  assert.equal(windowsProcessIdentity(0, () => { throw new Error('must not execute'); }, 'win32'), null);
  assert.equal(windowsProcessIdentity(43129, () => '{}', 'linux'), null);
});


test('active persisted identity must match the configured production platform policy', () => {
  const record = validPersistentOwner(43130);
  assert.throws(
    () => validateOwnerRecord(record, { expectedPlatform: 'win32' }),
    error => error.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID'
      && error.details?.field === 'processIdentity.platform'
  );
  const win = {
    ...record,
    processIdentity: {
      platform: 'win32',
      creationTimeUtc: '2026-07-04T03:01:02.1234567Z',
      executablePathDigest: '1'.repeat(64),
      commandDigest: '2'.repeat(64)
    }
  };
  assert.equal(validateOwnerRecord(win, { expectedPlatform: 'win32' }), win);
});


test('Windows process identity succeeds through provider-independent native authority without WMI', () => {
  const calls = [];

  const captured = windowsProcessIdentity(43130, (command, args, options) => {
    const script = args.join(' ');
    calls.push({ command, script, options });

    assert.match(script, /YanceNativeProcessIdentity/);
    assert.doesNotMatch(script, /Get-CimInstance Win32_Process/);
    assert.doesNotMatch(script, /ManagementObjectSearcher/);

    return JSON.stringify({
      ProcessId: 43130,
      CreationDate: '2026-08-31T07:00:00.1234567Z',
      ExecutablePath: 'C:\\Program Files\\Yance\\runtime\\node.exe',
      CommandLine: '"C:\\Program Files\\Yance\\runtime\\node.exe" backend.js'
    });
  }, 'win32', { deadlineAtMs: Date.now() + 60_000 });

  assert.equal(calls.length, 1);
  assert.equal(captured.platform, 'win32');
  assert.equal(validateProcessIdentity(captured), true);
  assert.match(captured.executablePathDigest, /^[a-f0-9]{64}$/);
  assert.match(captured.commandDigest, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(calls[0].options.timeout) && calls[0].options.timeout > 0 && calls[0].options.timeout <= 60_000);
});

test('Windows process identity remains fail closed when native and WMI authority both fail', () => {
  const calls = [];

  const captured = windowsProcessIdentity(43132, (command, args, options) => {
    const script = args.join(' ');
    calls.push({ script, options });

    const error = new Error('collector unavailable');
    error.code = 'ETIMEDOUT';
    throw error;
  }, 'win32', { deadlineAtMs: Date.now() + 60_000 });

  assert.equal(captured, null);
  assert.equal(calls.length, 2);

  assert.match(calls[0].script, /YanceNativeProcessIdentity/);
  assert.doesNotMatch(calls[0].script, /Win32_Process/);

  assert.match(calls[1].script, /ManagementObjectSearcher/);

  assert.ok(calls.every(call =>
    Number.isFinite(call.options.timeout) &&
    call.options.timeout > 0 &&
    call.options.timeout <= 60_000
  ));
});

test('deadline-exhausted Windows owner identity remains fail closed and never degrades to PID-only trust', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'owner.json');
    const registry = new BackendOwnerRegistry({
      file,
      isProcessAlive: () => true,
      captureIdentity: () => null,
      processIdentityPlatform: 'win32'
    });

    assert.throws(
      () => registry.register({
        state: 'SPAWNED',
        ownershipActive: true,
        trusted: false,
        backendPid: 43291,
        startupNonce: 'startup-nonce',
        backendSessionId: 'backend-session',
        fd6PipeInstanceId: 'fd6-instance',
        reasonCode: 'BACKEND_SPAWNED'
      }),
      error => {
        assert.equal(
          error.reasonCode,
          'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID'
        );
        return true;
      }
    );

    assert.equal(registry.snapshot(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
