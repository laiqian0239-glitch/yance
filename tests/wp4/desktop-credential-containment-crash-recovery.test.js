'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { DesktopHost } = require('../../electron/desktopHost/DesktopHost');
const {
  APPLICATION_CONTAINMENT_ACTIVE,
  DesktopCredentialApplicationCoordinator
} = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}
function identity(pid, suffix = 'same') { return { platform: 'test', startTicks: `${pid}-${suffix}`, commandDigest: `cmd-${pid}-${suffix}` }; }
function paths(root) {
  return {
    vault: path.join(root, 'credentials.safe.json'), metadata: path.join(root, 'vault-meta.json'), owner: path.join(root, 'desktop-backend-owner.json'),
    journal: path.join(root, 'desktop-credential-application-lifecycle.json'), sentinel: path.join(root, 'desktop-credential-application-containment.json')
  };
}
function createVault(p) {
  const vault = new CredentialVault(p.vault, { safeStorage: safeStorage() });
  return new CredentialVaultHost({ vault, metadataPath: p.metadata });
}
function desktop(backendHost, vaultHost) {
  return new DesktopHost({ backendProcessHost: backendHost, credentialVaultHost: vaultHost, releaseManifestHost: { snapshot: () => ({}), verify: () => ({}), backendStartupConfig: () => ({}) } });
}
function seedLiveOwner(p, vaultHost, pid, liveRef, withSession = true) {
  const host = new BackendProcessHost({ ownerRecordPath: p.owner, isProcessAlive: value => value === pid && liveRef.value, captureProcessIdentity: value => identity(value) });
  const child = new EventEmitter();
  child.pid = pid; child.exitCode = null; child.signalCode = null; child.stdio = [];
  host.child = child; host.state = 'RUNNING';
  if (withSession) {
    host.session = Object.freeze({ backendPid: pid, startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f', apiSessionToken: 'api', ownerContext: { backendPid: pid, startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f', hydrationGeneration: vaultHost.snapshotMetadata().generation } });
    host.credentialCustodyHost = { close() {}, snapshot() { return { dedicatedPipeActive: true, ownerContext: host.session.ownerContext }; } };
  }
  host.ownerRegistry.register({ state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: pid, startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f', ownerSession: withSession ? host.session.ownerContext : null, processIdentity: identity(pid) });
  return { host, child };
}
function coordinator(p, vaultHost, backendHost, liveRef, options = {}) {
  const desktopHost = desktop(backendHost, vaultHost);
  const instance = new DesktopCredentialApplicationCoordinator({
    desktopHost, vaultHost,
    startBackend: options.startBackend || (async () => ({ ok: true })),
    stopBackend: options.stopBackend || (request => backendHost.stop(request)),
    backendSnapshot: () => backendHost.snapshot(),
    getOwnedBackendChild: () => backendHost.getOwnedChild(),
    isProcessAlive: pid => pid > 0 && liveRef.value,
    journalPath: p.journal,
    containmentSentinelPath: p.sentinel,
    fs: options.fs || fs,
    platform: options.platform,
    containmentCrashInjector: options.containmentCrashInjector,
    failStopApplication: options.failStopApplication || (() => {})
  });
  return { coordinator: instance, desktopHost };
}

function windowsDirectoryFsyncErrorFs(sentinelPath, code = 'EPERM') {
  let sentinelRemoved = false;
  let injected = 0;
  return {
    api: {
      ...fs,
      rmSync(file, options) {
        const result = fs.rmSync(file, options);
        if (path.resolve(file) === path.resolve(sentinelPath)) sentinelRemoved = true;
        return result;
      },
      fsyncSync(handle) {
        if (sentinelRemoved) {
          sentinelRemoved = false;
          injected += 1;
          const error = new Error(`Windows directory fsync failed with ${code}`);
          error.code = code;
          throw error;
        }
        return fs.fsyncSync(handle);
      }
    },
    injected: () => injected
  };
}

for (const phase of [
  'before-backend-owner-revocation',
  'after-backend-owner-revocation',
  'before-application-fence',
  'after-application-fence',
  'after-enforcement-before-owner-record',
  'after-owner-record-before-sentinel',
  'after-enforcement-before-sentinel',
  'after-sentinel-before-lifecycle-journal'
]) {
  test(`application relaunch rediscovers a live rejected owner after crash at ${phase}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-containment-crash-${phase}-`));
    const p = paths(root); const live = { value: true }; const pid = 45200 + Math.floor(Math.random() * 1000);
    try {
      const vault1 = createVault(p); const seeded = seedLiveOwner(p, vault1, pid, live);
      const first = coordinator(p, vault1, seeded.host, live, { containmentCrashInjector(event) { if (event.phase === phase) { const error = new Error(`simulated crash ${phase}`); error.simulatedCrash = true; throw error; } } });
      const before = vault1.snapshotAuthorityBoundary();
      const rejection = Object.assign(new Error('runtime projection rejected'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
      assert.throws(() => first.coordinator._establishRejectedOwnerEnforcement(rejection), error => error.simulatedCrash === true);

      // New application process: memory fence and ChildProcess object are gone. The
      // independent owner record must still rediscover and revoke the orphan owner.
      const vault2 = createVault(p);
      const backend2 = new BackendProcessHost({ ownerRecordPath: p.owner, isProcessAlive: value => value === pid && live.value, captureProcessIdentity: value => identity(value), killProcess(value, signal) { if (value === pid && signal === 'SIGTERM') live.value = false; return true; } });
      const second = coordinator(p, vault2, backend2, live);
      const snapshot = second.coordinator.snapshot();
      assert.equal(snapshot.containmentActive, true);
      assert.ok(snapshot.applicationFence);
      assert.equal(backend2.snapshot().ownerTrusted, false);
      assert.equal(backend2.getApiSessionToken(), '');
      assert.equal(backend2.snapshot().credentialCustody, null);
      await assert.rejects(second.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
      await assert.rejects(second.coordinator.restartBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
      await assert.rejects(Promise.resolve().then(() => vault2.prepareCustodyTransaction({ requestId: `fd6-${phase}`, operation: 'persist', ref: 'crash/recovery' })), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
      assert.deepEqual(vault2.snapshotAuthorityBoundary(), before);

      const stopped = await backend2.stop({ gracefulMs: 30, forceMs: 30 });
      assert.equal(stopped.stopped, true);
      const recovered = await second.coordinator._recoverContainmentIfOwnerExited({ finalState: 'FAILED_SAFE' });
      assert.equal(recovered.recovered, true);
      assert.equal(second.coordinator.snapshot().containmentActive, false);
      assert.equal(vault2.applicationFenceSnapshot(), null);
    } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });
}

test('Windows directory fsync EPERM after sentinel unlink does not retain active in-memory containment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-containment-win32-dir-fsync-'));
  const p = paths(root); const live = { value: true }; const pid = 46991;
  try {
    const vault1 = createVault(p); const seeded = seedLiveOwner(p, vault1, pid, live);
    const first = coordinator(p, vault1, seeded.host, live, {
      containmentCrashInjector(event) {
        if (event.phase === 'after-sentinel-before-lifecycle-journal') {
          const error = new Error('simulated crash after sentinel persistence');
          error.simulatedCrash = true;
          throw error;
        }
      }
    });
    const rejection = Object.assign(new Error('runtime projection rejected'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
    assert.throws(() => first.coordinator._establishRejectedOwnerEnforcement(rejection), error => error.simulatedCrash === true);
    assert.equal(fs.existsSync(p.sentinel), true);

    const vault2 = createVault(p);
    const backend2 = new BackendProcessHost({
      ownerRecordPath: p.owner,
      isProcessAlive: value => value === pid && live.value,
      captureProcessIdentity: value => identity(value),
      killProcess(value, signal) { if (value === pid && signal === 'SIGTERM') live.value = false; return true; }
    });
    const injectedFs = windowsDirectoryFsyncErrorFs(p.sentinel, 'EPERM');
    const second = coordinator(p, vault2, backend2, live, { fs: injectedFs.api, platform: 'win32' });
    assert.equal(second.coordinator.snapshot().containmentActive, true);

    const stopped = await backend2.stop({ gracefulMs: 30, forceMs: 30 });
    assert.equal(stopped.stopped, true);
    const recovered = await second.coordinator._recoverContainmentIfOwnerExited({ finalState: 'FAILED_SAFE' });
    assert.equal(recovered.recovered, true);
    assert.equal(injectedFs.injected(), 1);
    assert.equal(second.coordinator.snapshot().containmentActive, false);
    assert.equal(second.coordinator.snapshot().containmentSentinel, null);
    assert.equal(vault2.applicationFenceSnapshot(), null);
    assert.equal(fs.existsSync(p.sentinel), false);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('Windows non-EPERM directory fsync failure remains fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-containment-win32-dir-fsync-eio-'));
  const p = paths(root); const live = { value: false };
  try {
    const vault = createVault(p);
    const backend = new BackendProcessHost({ ownerRecordPath: p.owner, isProcessAlive: () => false, captureProcessIdentity: () => null });
    const injectedFs = windowsDirectoryFsyncErrorFs(p.sentinel, 'EIO');
    const x = coordinator(p, vault, backend, live, { fs: injectedFs.api, platform: 'win32' });
    fs.writeFileSync(p.sentinel, '{"schemaVersion":1,"active":true}\n', 'utf8');
    x.coordinator.containmentSentinel = { schemaVersion: 1, active: true };

    assert.throws(() => x.coordinator._clearContainmentSentinel(), error => error.code === 'EIO');
    assert.equal(injectedFs.injected(), 1);
    assert.equal(x.coordinator.snapshot().containmentActive, true);
    assert.equal(x.coordinator.snapshot().containmentSentinel.active, true);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('corrupt lifecycle journal plus live owner registry fails closed and reinstalls the real fence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-corrupt-journal-owner-')); const p = paths(root); const live = { value: true }; const pid = 46301;
  try {
    const vault = createVault(p); seedLiveOwner(p, vault, pid, live, false);
    fs.writeFileSync(p.journal, '{"schemaVersion":3,"lifecycle":');
    const backend = new BackendProcessHost({ ownerRecordPath: p.owner, isProcessAlive: value => value === pid, captureProcessIdentity: value => identity(value) });
    const x = coordinator(p, createVault(p), backend, live);
    assert.equal(x.coordinator.snapshot().state, 'FATAL_OWNER_CONTAINMENT');
    assert.ok(x.coordinator.snapshot().applicationFence);
    assert.equal(backend.snapshot().ownerTrusted, false);
    await assert.rejects(x.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE || error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_UNAVAILABLE');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('corrupt or truncated containment sentinel never falls back to FAILED_SAFE or IDLE', () => {
  for (const value of ['{', '{"schemaVersion":1,"active":']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-corrupt-sentinel-')); const p = paths(root); const live = { value: true }; const pid = 46302;
    try {
      const vault = createVault(p); seedLiveOwner(p, vault, pid, live);
      fs.writeFileSync(p.sentinel, value);
      const backend = new BackendProcessHost({ ownerRecordPath: p.owner, isProcessAlive: value2 => value2 === pid, captureProcessIdentity: value2 => identity(value2) });
      const x = coordinator(p, createVault(p), backend, live);
      const snapshot = x.coordinator.snapshot();
      assert.equal(snapshot.state, 'FATAL_OWNER_CONTAINMENT');
      assert.equal(snapshot.failStopRequired, true);
      assert.ok(snapshot.applicationFence);
      assert.notEqual(snapshot.state, 'FAILED_SAFE');
      assert.notEqual(snapshot.state, 'IDLE');
    } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }
});
