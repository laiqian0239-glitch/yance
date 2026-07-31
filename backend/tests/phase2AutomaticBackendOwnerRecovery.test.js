'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { BackendOwnerRegistry } = require('../../electron/desktopHost/BackendOwnerRegistry');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-phase2-owner-recovery-')); }
function identity(pid, suffix = 'owner') { return { platform: 'test', startTicks: `${pid}-${suffix}`, commandDigest: `cmd-${pid}-${suffix}` }; }
function writeOwner(file, pid, processIdentity = identity(pid)) {
  const registry = new BackendOwnerRegistry({
    file,
    isProcessAlive: () => true,
    captureIdentity: () => processIdentity,
    processIdentityPlatform: 'test'
  });
  registry.register({
    state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: pid,
    startupNonce: 'nonce', backendSessionId: 'session', fd6PipeInstanceId: 'pipe',
    processIdentity, reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED'
  });
}

test('automatic recovery terminates only the identity-matched previous Yance backend owner', async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'owner.json');
    const pid = 45101;
    writeOwner(file, pid);
    let live = true;
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      autoRecoverRejectedOwner: true,
      isProcessAlive: value => value === pid && live,
      captureProcessIdentity: value => identity(value),
      killProcess(value, signal) {
        signals.push([value, signal]);
        if (value === pid && signal === 'SIGTERM') live = false;
        return true;
      }
    });

    const result = await host.recoverRejectedOwnerForStart({ ownerRecoveryGracefulMs: 30, ownerRecoveryForceMs: 30 });
    assert.equal(result.recovered, true);
    assert.equal(result.backendPid, pid);
    assert.deepEqual(signals, [[pid, 'SIGTERM']]);
    assert.equal(host.snapshot().rejectedOwner, null);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
    assert.equal(host.snapshot().ownershipPresent, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('automatic recovery never terminates a PID-reused unrelated process', async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'owner.json');
    const pid = 45102;
    writeOwner(file, pid, identity(pid, 'old'));
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      autoRecoverRejectedOwner: true,
      isProcessAlive: value => value === pid,
      captureProcessIdentity: value => identity(value, 'new'),
      killProcess(value, signal) { signals.push([value, signal]); return true; }
    });

    const result = await host.recoverRejectedOwnerForStart();
    assert.equal(result.recovered, true);
    assert.equal(result.pidReused, true);
    assert.deepEqual(signals, []);
    assert.equal(host.snapshot().ownerRegistry.state, 'RECOVERED');
    assert.equal(host.snapshot().rejectedOwner, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('automatic recovery remains fail-closed when a live owner identity cannot be verified', async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'owner.json');
    const pid = 45103;
    writeOwner(file, pid);
    const signals = [];
    const host = new BackendProcessHost({
      ownerRecordPath: file,
      autoRecoverRejectedOwner: true,
      isProcessAlive: value => value === pid,
      captureProcessIdentity: () => null,
      killProcess(value, signal) { signals.push([value, signal]); return true; }
    });

    await assert.rejects(host.recoverRejectedOwnerForStart(), error => {
      assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED');
      assert.equal(error.automaticRecoveryAttempted, true);
      return true;
    });
    assert.deepEqual(signals, []);
    assert.ok(host.snapshot().rejectedOwner);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('production desktop startup opts into safe owner and containment recovery', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
  const desktopHost = fs.readFileSync(path.join(__dirname, '../../electron/desktopHost/DesktopHost.js'), 'utf8');
  const coordinator = fs.readFileSync(path.join(__dirname, '../../electron/desktopHost/DesktopCredentialApplicationCoordinator.js'), 'utf8');
  assert.match(main, /autoRecoverRejectedOwner:\s*true/);
  assert.match(main, /automaticStartupContainmentRecovery:\s*true/);
  assert.match(desktopHost, /recoverRejectedBackendOwnerForStart/);
  assert.match(coordinator, /_recoverContainmentForStartup/);
  assert.match(coordinator, /automatic-startup-rejected-owner-recovery/);
  assert.match(coordinator, /recoverStartupContainment/);
  assert.match(main, /recoverStartupContainment\([\s\S]*desktop-bootstrap-before-credential-migration/);
  assert.ok(main.indexOf('recoverStartupContainment') < main.indexOf("runExclusive('LEGACY_CREDENTIAL_MIGRATION'"));
});
