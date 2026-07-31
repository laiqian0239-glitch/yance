#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CredentialVault } = require('../../electron/credentialVault');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { DesktopCredentialApplicationCoordinator } = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');
const { DesktopHost } = require('../../electron/desktopHost/DesktopHost');
const { ReleaseManifestHost } = require('../../electron/desktopHost/ReleaseManifestHost');
const { createInstalledResources } = require('../../tests/wp2/helpers');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(ROOT, 'tests', 'wp4', 'fixtures', 'hydration-ack-stubborn-probe.js');

function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-start-handshake-containment-matrix').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}


function processAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value < 1) return false;
  try { process.kill(value, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

async function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.__desktopHostExited === true) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stubborn child did not exit during matrix cleanup')), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function projectionFor(ready) {
  const authority = ready.authority;
  return {
    credentialMetadata: {
      vaultEpoch: authority.vaultEpoch,
      generation: authority.generation,
      authorityEventId: authority.authorityEventId,
      authorityHeadDigest: authority.authorityHeadDigest,
      restoredReferenceCount: authority.referenceCount
    },
    sqliteCredentialMetadata: {
      hydrated: true,
      vaultEpoch: authority.vaultEpoch,
      generation: authority.generation,
      authorityEventId: authority.authorityEventId,
      authorityHeadDigest: authority.authorityHeadDigest,
      referenceCount: authority.referenceCount
    },
    security: { secureStorageAvailable: true, credentialRefs: authority.referenceCount },
    secureBridge: { available: true, credentialRefs: authority.referenceCount, pendingCandidates: 0 }
  };
}

function makeFailingOwnerFs(ownerPath) {
  return new Proxy(fs, {
    get(target, property) {
      if (property === 'renameSync') {
        return (source, destination) => {
          if (path.resolve(String(destination)) === path.resolve(ownerPath)) {
            const error = new Error('injected owner registry atomic rename failure');
            error.code = 'EIO';
            throw error;
          }
          return target.renameSync(source, destination);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

async function createRuntime(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-start-handshake-${name}-`));
  const release = createInstalledResources({ gitCommit: '8'.repeat(40), sourceTree: '9'.repeat(40) });
  const ownerPath = path.join(root, 'secure', 'backend-owner.json');
  const children = [];
  const realKills = new WeakMap();
  let killFailure = options.killFailure !== false;
  let mode = options.mode || 'fd5-mismatch';

  const backendHost = new BackendProcessHost({
    ownerRecordPath: ownerPath,
    fs: options.ownerPersistFailure ? makeFailingOwnerFs(ownerPath) : undefined,
    captureProcessIdentity: options.processIdentityFailure ? (() => null) : undefined,
    fork(entry, args, forkOptions) {
      const child = childProcess.fork(entry, args, forkOptions);
      children.push(child);
      const realKill = child.kill.bind(child);
      realKills.set(child, realKill);
      child.kill = signal => {
        if (killFailure && (signal === 'SIGTERM' || signal === 'SIGKILL')) return false;
        return realKill(signal);
      };
      if (options.startupPipeFailure) child.stdio[4] = null;
      return child;
    }
  });
  const vault = new CredentialVault(path.join(root, 'secure', 'credentials.safe.json'), { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'secure', 'vault-meta.json') });
  const desktopHost = new DesktopHost({
    releaseManifestHost: new ReleaseManifestHost({ resourcesPath: release.resourcesPath }),
    credentialVaultHost: vaultHost,
    backendProcessHost: backendHost
  });
  const startOptions = () => ({
    entry: FIXTURE,
    cwd: ROOT,
    execPath: process.execPath,
    env: {
      ...process.env,
      WP4_STUBBORN_HANDSHAKE_MODE: mode,
      ...(options.fd6SetupFailure ? { WP4_STUBBORN_CUSTODY_MODE: 'skip' } : {})
    },
    credentialTimeoutMs: 3000,
    credentialCustodyConnectTimeoutMs: options.fd6SetupFailure ? 250 : 3000,
    readyTimeoutMs: 3000,
    forceExitTimeoutMs: 50
  });
  const coordinatorOptions = () => ({
    desktopHost,
    vaultHost,
    startBackend: supplied => desktopHost.startBackend({ ...startOptions(), ...supplied }),
    stopBackend: supplied => desktopHost.stopBackend({ ...supplied, gracefulMs: 25, forceMs: 25 }),
    backendSnapshot: () => backendHost.snapshot(),
    waitForOwnerExitRecovery: child => desktopHost.waitForBackendOwnerExitRecovery(child),
    getOwnedBackendChild: () => backendHost.getOwnedChild(),
    validateRuntimeProjection: async ({ ready }) => projectionFor(ready),
    journalPath: path.join(root, 'secure', 'desktop-credential-application-lifecycle.json')
  });
  let coordinator = new DesktopCredentialApplicationCoordinator(coordinatorOptions());
  desktopHost.setCredentialApplicationCoordinator(coordinator);

  return {
    root, release, ownerPath, backendHost, vaultHost, desktopHost, children,
    get coordinator() { return coordinator; },
    child() { return children.at(-1) || null; },
    setKillFailure(value) { killFailure = Boolean(value); },
    setMode(value) { mode = value; },
    relaunchCoordinator() {
      coordinator = new DesktopCredentialApplicationCoordinator(coordinatorOptions());
      desktopHost.setCredentialApplicationCoordinator(coordinator);
      return coordinator;
    },
    async forceExit(child = children.at(-1)) {
      if (!child || !processAlive(child.pid)) return;
      killFailure = false;
      child.kill = realKills.get(child);
      child.kill('SIGKILL');
      await waitForExit(child);
    },
    async cleanup() {
      killFailure = false;
      for (const child of children) {
        if (child && processAlive(child.pid)) {
          try { (realKills.get(child) || child.kill.bind(child))('SIGKILL'); } catch (_) { try { process.kill(child.pid, 'SIGKILL'); } catch (_) {} }
          await waitForExit(child).catch(() => {});
          if (processAlive(child.pid)) { try { process.kill(child.pid, 'SIGKILL'); } catch (_) {} }
        }
      }
      await desktopHost.stopBackend({ gracefulMs: 100, forceMs: 100 }).catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(release.resourcesPath, { recursive: true, force: true });
    }
  };
}

function row(id, title, detail = {}) { return { id, title, status: 'PASS', ...detail }; }

async function assertFatalContainment(runtime, expectedReasonCode) {
  let rejection = null;
  try { await runtime.coordinator.startBackend(); }
  catch (error) { rejection = error; }
  assert.ok(rejection, 'startup must reject');
  const actualReasonCode = rejection.reasonCode || rejection.code || '';
  if (expectedReasonCode) assert.equal(actualReasonCode, expectedReasonCode);
  assert.equal(rejection.rejectedOwnerContainment?.apiAuthorityRevoked, true, 'BackendProcessHost must revoke API authority before fallible termination');
  assert.equal(rejection.rejectedOwnerContainment?.fd6Closed, true, 'BackendProcessHost must close FD6 before fallible termination');
  assert.equal(rejection.rejectedOwnerContainment?.childStillLive, true, 'BackendProcessHost must classify the failed live child as a rejected owner');
  const child = runtime.child();
  const pending = await runtime.backendHost.waitForOwnerExitRecovery(child);
  const backend = runtime.backendHost.snapshot();
  const application = runtime.coordinator.snapshot();
  const authority = runtime.vaultHost.snapshotMetadata();
  assert.equal(pending.recovered, false);
  assert.equal(pending.pendingExitEvent, true);
  assert.equal(backend.ownershipPresent, true);
  assert.equal(backend.ownerTrusted, false);
  assert.ok(backend.rejectedOwner || backend.ownerRegistryFailure);
  assert.equal(backend.apiSessionEstablished, false);
  assert.notEqual(backend.credentialCustody?.dedicatedPipeActive, true);
  assert.equal(application.state, 'FATAL_OWNER_CONTAINMENT');
  assert.equal(application.containmentActive, true);
  assert.equal(application.failStopRequired, true);
  assert.ok(application.applicationFence);
  assert.ok(runtime.vaultHost.applicationFenceSnapshot());
  return { rejection, child, pending, backend, application, authority };
}


async function assertPreOwnerClaimStartFailure(runtime, expectedReasonCode) {
  let rejection = null;
  try { await runtime.coordinator.startBackend(); }
  catch (error) { rejection = error; }
  assert.ok(rejection, 'startup must reject');
  const actualReasonCode = rejection.reasonCode || rejection.code || '';
  if (expectedReasonCode) assert.equal(actualReasonCode, expectedReasonCode);
  assert.equal(rejection.rejectedOwnerContainment, undefined, 'pre-owner-claim failure must not create rejected-owner containment');
  assert.equal(rejection.rejectedOwnerContainmentSkipped, true, 'pre-owner-claim failure must explicitly record skipped containment');
  assert.equal(rejection.rejectedOwnerContainmentSkippedReason, 'CHILD_FAILED_BEFORE_OWNER_CLAIM');
  const backend = runtime.backendHost.snapshot();
  const application = runtime.coordinator.snapshot();
  assert.equal(backend.apiSessionEstablished, false);
  assert.notEqual(application.state, 'FATAL_OWNER_CONTAINMENT');
  assert.equal(application.containmentActive, false);
  assert.equal(application.failStopRequired, false);
  assert.equal(runtime.vaultHost.applicationFenceSnapshot(), null);
  return { rejection, child: runtime.child(), backend, application };
}

async function runPreOwnerClaimFailureCase(id, title, options, reasonCode) {
  const runtime = await createRuntime(id.toLowerCase(), options);
  try {
    const result = await assertPreOwnerClaimStartFailure(runtime, reasonCode);
    return row(id, title, {
      reasonCode: result.rejection.reasonCode || result.rejection.code || '',
      cleanupReasonCode: result.rejection.cleanupReasonCode || '',
      backendPid: result.child?.pid || 0,
      childLive: result.child ? result.child.exitCode === null : false,
      containmentSkipped: result.rejection.rejectedOwnerContainmentSkipped === true,
      skipReason: result.rejection.rejectedOwnerContainmentSkippedReason || '',
      ownerRegistryFailure: result.backend.ownerRegistryFailure?.reasonCode || null,
      applicationState: result.application.state,
      containmentActive: result.application.containmentActive === true
    });
  } finally { await runtime.cleanup(); }
}

async function runSimpleFailureCase(id, title, options, reasonCode) {
  const runtime = await createRuntime(id.toLowerCase(), options);
  try {
    const result = await assertFatalContainment(runtime, reasonCode);
    return row(id, title, {
      reasonCode: result.rejection.reasonCode || result.rejection.code || '',
      cleanupReasonCode: result.rejection.cleanupReasonCode || '',
      backendPid: result.child.pid,
      childLive: result.child.exitCode === null,
      ownerTrusted: result.backend.ownerTrusted,
      durableOwnerState: result.backend.ownerRegistry?.state || null,
      ownerRegistryFailure: result.backend.ownerRegistryFailure?.reasonCode || null,
      applicationState: result.application.state,
      applicationFenceActive: Boolean(result.application.applicationFence),
      fd6Active: result.backend.credentialCustody?.dedicatedPipeActive === true
    });
  } finally { await runtime.cleanup(); }
}

async function runSharedLifecycleCases() {
  const runtime = await createRuntime('shared-lifecycle', { mode: 'fd5-mismatch', killFailure: true });
  const cases = [];
  try {
    const contained = await assertFatalContainment(runtime, 'DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH');

    let prepareError = null;
    try { await runtime.vaultHost.prepareCustodyTransaction({ requestId: 'matrix-prepare', operation: 'persist', payload: { ref: 'matrix/fd6', mutationSha256: 'a'.repeat(64) } }); }
    catch (error) { prepareError = error; }
    let commitError = null;
    try { await runtime.vaultHost.commitCustodyTransaction({ requestId: 'matrix-commit', transactionId: 'blocked', mutationSha256: 'b'.repeat(64) }); }
    catch (error) { commitError = error; }
    assert.equal(prepareError?.reasonCode, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    assert.equal(commitError?.reasonCode, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    cases.push(row('H06', 'live failed child denies FD6 PREPARE and COMMIT', { prepareReasonCode: prepareError.reasonCode, commitReasonCode: commitError.reasonCode }));

    let mutationError = null;
    try { await runtime.vaultHost.executeDesktopMutation('persist', 'matrix/blocked', { token: 'denied' }, { requestId: 'matrix-blocked' }); }
    catch (error) { mutationError = error; }
    assert.equal(mutationError?.reasonCode, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    cases.push(row('H07', 'live failed child denies desktop credential mutation', { reasonCode: mutationError.reasonCode }));

    const blocked = {};
    for (const [name, operation] of [['start', () => runtime.coordinator.startBackend()], ['restart', () => runtime.coordinator.restartBackend()]]) {
      try { await operation(); }
      catch (error) { blocked[name] = error.reasonCode; }
    }
    assert.equal(blocked.start, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    assert.equal(blocked.restart, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    cases.push(row('H08', 'live failed child denies start restart and alreadyReady bypass', { ...blocked, alreadyReadyBypassDenied: true }));

    let shutdownError = null;
    try { await runtime.coordinator.stopBackend({ forShutdown: true }); }
    catch (error) { shutdownError = error; }
    assert.equal(shutdownError?.reasonCode, 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT');
    const relaunched = runtime.relaunchCoordinator();
    const relaunchSnapshot = relaunched.snapshot();
    assert.equal(relaunchSnapshot.containmentActive, true);
    assert.equal(relaunchSnapshot.failStopRequired, true);
    assert.ok(runtime.vaultHost.applicationFenceSnapshot());
    cases.push(row('H09', 'application shutdown and relaunch retain live-owner containment', {
      shutdownReasonCode: shutdownError.reasonCode,
      relaunchedState: relaunchSnapshot.state,
      containmentActive: relaunchSnapshot.containmentActive,
      applicationFenceActive: Boolean(runtime.vaultHost.applicationFenceSnapshot())
    }));

    await runtime.forceExit(contained.child);
    const ownerRecovery = await runtime.backendHost.waitForOwnerExitRecovery(contained.child);
    assert.equal(ownerRecovery.recovered, true);
    const applicationRecovery = await runtime.coordinator.recoverAfterBackendExit(contained.child, { unexpected: false });
    assert.equal(applicationRecovery.recovered, true);
    assert.equal(runtime.coordinator.snapshot().containmentActive, false);
    assert.equal(runtime.vaultHost.applicationFenceSnapshot(), null);
    assert.equal(runtime.backendHost.snapshot().ownerRegistry.state, 'RECOVERED');
    cases.push(row('H10', 'eventual real exit completes durable owner recovery', {
      recovered: ownerRecovery.recovered,
      ownerRegistryState: runtime.backendHost.snapshot().ownerRegistry.state,
      containmentActive: runtime.coordinator.snapshot().containmentActive
    }));

    runtime.setMode('valid');
    runtime.setKillFailure(false);
    const restarted = await runtime.coordinator.startBackend();
    const backend = runtime.backendHost.snapshot();
    assert.equal(restarted.ok, true);
    assert.equal(backend.running, true);
    assert.equal(backend.ownerTrusted, true);
    assert.equal(backend.credentialHydrated, true);
    assert.equal(runtime.coordinator.snapshot().state, 'IDLE');
    assert.ok(runtime.coordinator.snapshot().stateHistory.some(item => item.state === 'NEW_OWNER_READY'));
    cases.push(row('H11', 'new backend completes FD5 READY and runtime projection after recovery', {
      backendPid: backend.backendPid,
      credentialHydrated: backend.credentialHydrated,
      ownerTrusted: backend.ownerTrusted,
      applicationState: runtime.coordinator.snapshot().state,
      newOwnerReadyObserved: runtime.coordinator.snapshot().stateHistory.some(item => item.state === 'NEW_OWNER_READY'),
      runtimeProjectionValidated: true
    }));
    return cases;
  } finally { await runtime.cleanup(); }
}

async function runDesktopCredentialStartHandshakeContainmentMatrix() {
  const cases = [];
  const execute = async (id, fn) => {
    try { cases.push(await fn()); }
    catch (error) {
      cases.push({ id, status: 'FAIL', reasonCode: error.reasonCode || error.code || 'ASSERTION_FAILED', message: error.message, stack: error.stack });
    }
  };
  await execute('H01', () => runSimpleFailureCase('H01', 'FD5 hydration mismatch plus SIGTERM and SIGKILL failure', { mode: 'fd5-mismatch', killFailure: true }, 'DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH'));
  await execute('H02', () => runSimpleFailureCase('H02', 'READY frame mismatch plus kill failure', { mode: 'ready-mismatch', killFailure: true }, 'DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH'));
  await execute('H03', () => runSimpleFailureCase('H03', 'startup pipe failure plus kill failure', { mode: 'valid', startupPipeFailure: true, killFailure: true }, 'DESKTOP_STARTUP_PIPE_UNAVAILABLE'));
  await execute('H04', () => runPreOwnerClaimFailureCase('H04', 'owner registry persist failure before credential authority must not create fatal containment', { mode: 'valid', ownerPersistFailure: true, killFailure: true }, 'EIO'));
  await execute('H05', () => runPreOwnerClaimFailureCase('H05', 'process identity capture failure before owner claim must not create fatal containment', { mode: 'valid', processIdentityFailure: true, killFailure: true }, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID'));
  await execute('H05B', () => runSimpleFailureCase('H05B', 'FD6 custody setup failure plus kill failure', { mode: 'valid', fd6SetupFailure: true, killFailure: true }, 'DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE'));
  try { cases.push(...await runSharedLifecycleCases()); }
  catch (error) { cases.push({ id: 'H06-H11', status: 'FAIL', reasonCode: error.reasonCode || error.code || 'ASSERTION_FAILED', message: error.message, failures: error.failures || [], backend: error.backend || null, authority: error.authority || null, expectedAuthority: error.expectedAuthority || null, stack: error.stack }); }

  const failedCaseIds = cases.filter(item => item.status !== 'PASS').map(item => item.id);
  const value = {
    schemaVersion: 1,
    matrix: 'DESKTOP_CREDENTIAL_START_HANDSHAKE_REJECTED_OWNER_CONTAINMENT',
    status: failedCaseIds.length ? 'FAIL' : 'PASS',
    caseCount: cases.length,
    failedCaseIds,
    cases,
    productionChain: true,
    realChildLivenessChecked: true,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (failedCaseIds.length) {
    const error = new Error(`WP4 start-handshake containment matrix failed: ${failedCaseIds.join(', ')}`);
    error.reasonCode = 'WP4_START_HANDSHAKE_CONTAINMENT_MATRIX_FAILED';
    error.matrix = value;
    throw error;
  }
  return value;
}

module.exports = { runDesktopCredentialStartHandshakeContainmentMatrix };
if (require.main === module) runDesktopCredentialStartHandshakeContainmentMatrix().then(value => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, () => process.exit(0));
}).catch(error => {
  process.stderr.write(`${error.reasonCode || error.code || 'WP4_START_HANDSHAKE_CONTAINMENT_MATRIX_FAILED'} ${error.stack || error.message}\n`);
  if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`);
  process.exit(1);
});
