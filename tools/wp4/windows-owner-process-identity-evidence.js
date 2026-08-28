#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  BackendOwnerRegistry,
  windowsProcessIdentity
} = require('../../electron/desktopHost/BackendOwnerRegistry');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function identity(pid) { return windowsProcessIdentity(pid); }
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}
function validOwner(file, pid, processIdentity) {
  const registry = new BackendOwnerRegistry({ file });
  return registry.register({
    state: 'RUNNING', ownershipActive: true, trusted: true,
    backendPid: pid, startupNonce: 'windows-evidence-startup',
    backendSessionId: 'windows-evidence-session',
    fd6PipeInstanceId: 'windows-evidence-fd6',
    processIdentity,
    ownerSession: { backendPid: pid },
    reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED'
  });
}
function startBlockReason(host) {
  return host.start({}).then(
    () => 'UNEXPECTED_START_SUCCESS',
    error => String(error?.reasonCode || error?.code || 'UNKNOWN')
  );
}

async function runLiveEvidence(root) {
  const child = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true, stdio: 'ignore'
  });
  const file = path.join(root, 'live-owner.json');
  try {
    const captured = await identity(child.pid);
    assert.ok(captured, 'Windows CIM identity must be readable for the evidence child');
    validOwner(file, child.pid, captured);

    const restored = new BackendProcessHost({ ownerRecordPath: file });
    const restoredSnapshot = restored.snapshot();
    assert.equal(restoredSnapshot.ownerTrusted, false);
    assert.equal(restoredSnapshot.rejectedOwner?.restoredFromOwnerRegistry, true);
    const restoredStartReason = await startBlockReason(restored);
    assert.match(restoredStartReason, /REJECTED_OWNER/);
    assert.equal(restored.snapshot().rejectedOwner?.pidIdentityMatch, true);

    const mismatchFile = path.join(root, 'pid-reuse-simulation.json');
    const altered = { ...captured, creationTimeUtc: `${captured.creationTimeUtc}-mismatch` };
    validOwner(mismatchFile, child.pid, altered);
    const signals = [];
    const mismatch = new BackendProcessHost({
      ownerRecordPath: mismatchFile,
      killProcess(pid, signal) { signals.push({ pid, signal }); process.kill(pid, signal); },
      isProcessAlive: isAlive,
      captureProcessIdentity: identity
    });
    const mismatchStop = await mismatch.stop();
    assert.equal(mismatchStop.stopped, false);
    assert.equal(mismatch.snapshot().ownerRegistryFailure?.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED');
    assert.equal(signals.length, 0, 'PID reuse containment must not signal the unrelated live process');
    await assert.rejects(() => mismatch.clearRejectedOwner(), error => error?.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED');
    assert.equal(await mismatch.clearRejectedOwner({ force: true }), true);
    assert.equal(mismatch.snapshot().ownerRegistry?.state, 'RECOVERED');

    const unreadableFile = path.join(root, 'identity-unreadable.json');
    validOwner(unreadableFile, child.pid, captured);
    const unreadable = new BackendProcessHost({
      ownerRecordPath: unreadableFile,
      isProcessAlive: isAlive,
      captureProcessIdentity: () => null
    });
    assert.equal(unreadable.snapshot().ownerRegistryFailure?.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED');
    const unreadableStartReason = await startBlockReason(unreadable);
    assert.equal(unreadableStartReason, 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED');

    return {
      status: 'PASS',
      platform: process.platform,
      capturedIdentity: { ...captured, executablePathDigest: captured.executablePathDigest, commandDigest: captured.commandDigest },
      checks: {
        liveOrphanDiscovered: true,
        replacementStartBlocked: true,
        pidReuseIdentityMismatchDetected: true,
        pidReuseProcessNotSignalled: signals.length === 0,
        unreadableIdentityFailClosed: true,
        nonForceRecoveryBlocked: true,
        explicitForceRecoveryPersisted: true
      },
      rebootContinuation: 'RUN_PREPARE_REBOOT_THEN_VERIFY_REBOOT_FOR_REBOOT_BOUNDARY_EVIDENCE'
    };
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}

async function prepareReboot(root) {
  const file = path.join(root, 'reboot-owner.json');
  const captured = await identity(process.pid);
  assert.ok(captured, 'Current Windows process identity must be readable');
  validOwner(file, process.pid, captured);
  return {
    status: 'PREPARED_REBOOT_REQUIRED',
    platform: process.platform,
    ownerRecord: file,
    preparedPid: process.pid,
    instruction: 'Reboot Windows, then run this tool with --verify-reboot using the same evidence directory.'
  };
}

async function verifyReboot(root) {
  const file = path.join(root, 'reboot-owner.json');
  assert.equal(fs.existsSync(file), true, 'Prepared reboot owner record is missing');
  const host = new BackendProcessHost({ ownerRecordPath: file });
  const snapshot = host.snapshot();
  assert.equal(snapshot.ownerTrusted, false);
  assert.ok(snapshot.rejectedOwner || snapshot.ownerRegistryFailure, 'Durable pre-reboot owner must be discovered after reboot');
  const reason = await startBlockReason(host);
  assert.notEqual(reason, 'UNEXPECTED_START_SUCCESS');
  return {
    status: 'PASS',
    platform: process.platform,
    checks: {
      durableOwnerDiscoveredAfterReboot: true,
      ownerNotTrustedAfterReboot: true,
      replacementStartBlockedBeforeExplicitRecovery: true,
      observedStartReason: reason,
      ownerRegistryFailure: snapshot.ownerRegistryFailure || null,
      rejectedOwner: snapshot.rejectedOwner || null
    }
  };
}

async function main() {
  const mode = process.argv[2] || '--live';
  const root = path.resolve(process.argv[3] || path.join(process.cwd(), 'wp4-windows-owner-evidence'));
  const output = path.resolve(process.argv[4] || path.join(root, `${mode.replace(/^--/, '')}.json`));
  if (process.platform !== 'win32') {
    const value = {
      status: 'NOT_EXECUTED_WINDOWS_REQUIRED',
      platform: process.platform,
      reasonCode: 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_EVIDENCE_REQUIRES_WINDOWS',
      requestedMode: mode
    };
    writeJson(output, value);
    process.stderr.write(`${JSON.stringify(value)}\n`);
    process.exit(2);
  }
  fs.mkdirSync(root, { recursive: true });
  const value = mode === '--prepare-reboot' ? await prepareReboot(root)
    : mode === '--verify-reboot' ? await verifyReboot(root)
      : await runLiveEvidence(root);
  value.generatedAtUtc = new Date().toISOString();
  value.secretValueRecorded = false;
  value.secretHashRecorded = false;
  writeJson(output, value);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch(error => {
  const value = {
    status: 'FAIL',
    platform: process.platform,
    reasonCode: error?.reasonCode || error?.code || 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_EVIDENCE_FAILED',
    message: error?.message || String(error),
    stack: error?.stack || '',
    generatedAtUtc: new Date().toISOString(),
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  try {
    const root = path.resolve(process.argv[3] || path.join(process.cwd(), 'wp4-windows-owner-evidence'));
    writeJson(path.join(root, 'failure.json'), value);
  } catch (_) {}
  process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit(1);
});
