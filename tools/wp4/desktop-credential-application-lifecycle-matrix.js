#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { DesktopHost } = require('../../electron/desktopHost/DesktopHost');
const { DesktopCredentialApplicationCoordinator } = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');
const { ReleaseManifestHost } = require('../../electron/desktopHost/ReleaseManifestHost');
const { createInstalledResources } = require('../../tests/wp2/helpers');
const { request } = require('./production-credential-runtime');
const { isolatedBackendEnvironment } = require('./isolated-backend-environment');

const ROOT = path.resolve(__dirname, '../..');

function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-desktop-application-matrix-key').digest();
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

function sameBoundary(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}


function containmentRecord(live) {
  const containment = live.coordinator?.containment || {};
  const cleanup = live.failed?.rejectedOwnerCleanup || {};
  const applicationFence = live.coordinator?.applicationFence || live.authority?.applicationFence || null;
  const recoveredAfterConcurrentExit = cleanup.recoveredAfterConcurrentExit === true && cleanup.ownerReleased === true;
  return {
    rejectionReasonCode: String(live.failed?.reasonCode || containment.rejectionReasonCode || ''),
    cleanupReasonCode: String(live.failed?.cleanupReasonCode || containment.cleanupReasonCode || cleanup.cleanupReasonCode || ''),
    cleanupStopResult: cleanup.result || containment.stopResult || null,
    childStillLive: containment.childStillLive === true || live.backend?.rejectedOwner?.childStillLive === true || live.backend?.ownershipPresent === true,
    ownerReleased: cleanup.ownerReleased === true,
    recoveredAfterConcurrentExit,
    applicationFenceActive: Boolean(applicationFence),
    applicationFence,
    fd6PipeActive: live.backend?.credentialCustody?.dedicatedPipeActive === true,
    fd6Closed: live.backend?.credentialCustody?.dedicatedPipeActive !== true,
    activeOwnerSession: live.authority?.activeOwnerSession || containment.ownerSession || null,
    pendingOwnerSession: live.authority?.pendingOwnerSession || null,
    ownerTrusted: live.backend?.ownerTrusted !== false,
    coordinatorFinalState: String(live.coordinator?.state || ''),
    containmentActive: live.coordinator?.containmentActive === true
  };
}

function safeRejectedOwnerOutcome(row) {
  if (!row) return false;
  const liveContained = row.childStillLive === true && row.applicationFenceActive === true && row.fd6Closed === true && row.coordinatorFinalState === 'FATAL_OWNER_CONTAINMENT';
  const exitedRecovered = row.recoveredAfterConcurrentExit === true && row.ownerReleased === true && row.childStillLive !== true && row.applicationFenceActive !== true && row.containmentActive !== true && ['FAILED_SAFE', 'STOPPED', 'IDLE'].includes(row.coordinatorFinalState);
  return liveContained || exitedRecovered;
}

function groupedProbeStatus(rows) {
  const present = rows.filter(Boolean);
  if (!present.length) return 'NOT_RUN';
  if (present.some(row => row.status !== 'PASS')) return 'FAIL';
  return present.length === rows.length ? 'PASS' : 'PARTIAL';
}

function buildRejectedOwnerContainmentProbes(cases, options = {}) {
  const byId = new Map(cases.map(row => [row.id, row]));
  const required = options.requireComplete === true;
  const get = id => byId.get(id) || null;
  const readyGeneration = get('A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED');
  const readyDigest = get('A13_READY_DIGEST_MISMATCH_SIGKILL_FAILURE_CONTAINED');
  const runtimeProjection = get('A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED');
  const fd6Missing = get('A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED');
  const fd6Prepare = get('A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED');
  const fd6Commit = get('A17_LIVE_REJECTED_OWNER_FD6_COMMIT_DENIED');
  const containedStart = get('A18_LIVE_REJECTED_OWNER_START_ALREADY_READY_DENIED');
  const alreadyReadyProjection = get('A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION');
  const eventualExit = get('A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER');
  const probes = {};
  if (readyGeneration || readyDigest) probes.rejectedReadyOwnerStopFailure = {
    status: groupedProbeStatus([readyGeneration, readyDigest]),
    generationMismatchStatus: readyGeneration ? readyGeneration.status : 'NOT_RUN',
    digestMismatchStatus: readyDigest ? readyDigest.status : 'NOT_RUN',
    generationMismatch: readyGeneration || null,
    digestMismatch: readyDigest || null
  };
  if (runtimeProjection) probes.rejectedRuntimeProjectionOwnerStopFailure = {
    status: runtimeProjection.status,
    runtimeProjectionMismatchStatus: runtimeProjection.status,
    runtimeProjectionMismatch: runtimeProjection
  };
  if (fd6Missing || fd6Prepare || fd6Commit) probes.rejectedOwnerFd6Containment = {
    status: groupedProbeStatus([fd6Missing, fd6Prepare, fd6Commit]),
    missingPipeRejectionStatus: fd6Missing ? fd6Missing.status : 'NOT_RUN',
    prepareStatus: fd6Prepare ? fd6Prepare.status : 'NOT_RUN',
    commitStatus: fd6Commit ? fd6Commit.status : 'NOT_RUN',
    missingPipeRejection: fd6Missing || null,
    prepareResult: fd6Prepare?.fd6RequestResult || null,
    commitResult: fd6Commit?.fd6RequestResult || null,
    activeOwnerSession: fd6Prepare?.activeOwnerSession || fd6Commit?.activeOwnerSession || null,
    applicationFence: fd6Prepare?.applicationFence || fd6Commit?.applicationFence || null,
    coordinatorFinalState: fd6Prepare?.coordinatorFinalState || fd6Commit?.coordinatorFinalState || ''
  };
  if (containedStart || alreadyReadyProjection) probes.rejectedOwnerAlreadyReadyBypass = {
    status: groupedProbeStatus([containedStart, alreadyReadyProjection]),
    containedOwnerAlreadyReadyStatus: containedStart ? containedStart.status : 'NOT_RUN',
    normalAlreadyReadyProjectionStatus: alreadyReadyProjection ? alreadyReadyProjection.status : 'NOT_RUN',
    containedOwnerAlreadyReadyResult: containedStart?.alreadyReadyResult || null,
    normalAlreadyReadyProjectionResult: alreadyReadyProjection?.alreadyReadyResult || null,
    coordinatorFinalState: containedStart?.coordinatorFinalState || '',
    applicationFence: containedStart?.applicationFence || null,
    activeOwnerSession: containedStart?.activeOwnerSession || null
  };
  if (eventualExit) probes.rejectedOwnerEventualExitRecovery = {
    status: eventualExit.status,
    eventualExitRecoveryStatus: eventualExit.status,
    beforeExit: eventualExit.beforeExit || null,
    eventualExitRecoveryResult: eventualExit.eventualExitRecoveryResult || null,
    afterExit: eventualExit.afterExit || null,
    newOwnerStartResult: eventualExit.newOwnerStartResult || null,
    finalState: eventualExit.finalState || null
  };
  const requiredNames = [
    'rejectedReadyOwnerStopFailure',
    'rejectedRuntimeProjectionOwnerStopFailure',
    'rejectedOwnerFd6Containment',
    'rejectedOwnerAlreadyReadyBypass',
    'rejectedOwnerEventualExitRecovery'
  ];
  const failures = [];
  if (required) {
    for (const name of requiredNames) if (!probes[name]) failures.push(`${name}-missing`);
    const ready = probes.rejectedReadyOwnerStopFailure?.generationMismatch;
    if (ready && !safeRejectedOwnerOutcome(ready)) failures.push('rejected-ready-owner-not-contained');
    const runtime = probes.rejectedRuntimeProjectionOwnerStopFailure?.runtimeProjectionMismatch;
    if (runtime && !safeRejectedOwnerOutcome(runtime)) failures.push('rejected-runtime-owner-not-contained');
    const fd6 = probes.rejectedOwnerFd6Containment;
    if (fd6 && (fd6.prepareResult?.accepted !== false || fd6.commitResult?.accepted !== false || !fd6.applicationFence || fd6.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT')) failures.push('rejected-owner-fd6-not-contained');
    const bypass = probes.rejectedOwnerAlreadyReadyBypass;
    if (bypass && (bypass.containedOwnerAlreadyReadyResult?.accepted !== false || bypass.normalAlreadyReadyProjectionResult?.accepted !== false || bypass.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT')) failures.push('rejected-owner-already-ready-bypass');
    const recovery = probes.rejectedOwnerEventualExitRecovery;
    if (recovery) {
      const beforeSafe = recovery.beforeExit?.applicationFenceActive === true || recovery.beforeExit?.recoveredAfterConcurrentExit === true;
      if (!beforeSafe || recovery.afterExit?.applicationFenceActive !== false || recovery.newOwnerStartResult?.accepted !== true || recovery.finalState?.coordinatorState !== 'IDLE') failures.push('rejected-owner-eventual-exit-recovery-failed');
    }
  }
  const probeStatuses = Object.values(probes).map(probe => probe.status);
  const status = failures.length || probeStatuses.includes('FAIL')
    ? 'FAIL'
    : required
      ? 'PASS'
      : (probeStatuses.includes('PARTIAL') || Object.keys(probes).length < requiredNames.length ? 'PARTIAL' : 'PASS');
  return {
    schemaVersion: 2,
    status,
    complete: status === 'PASS' && Object.keys(probes).length === requiredNames.length,
    requiredComplete: required,
    failures,
    probes
  };
}

function applicationMatrixTempPrefix(caseId) {
  const value = String(caseId || 'case').trim();
  const label = (/^([a-z]\d+)/i.exec(value)?.[1] || 'case').toLowerCase();
  const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `y4-${label}-${digest}-`;
}

function createApplicationMatrixTempRoot(caseId, options = {}) {
  const fsApi = options.fs || fs;
  const osApi = options.os || os;
  const pathApi = options.path || path;
  return fsApi.mkdtempSync(pathApi.join(osApi.tmpdir(), applicationMatrixTempPrefix(caseId)));
}

async function createRuntime(name) {
  // The full matrix case id is evidence metadata, not a filesystem identity.
  // On Windows the four longest case ids pushed the temporary SQLite path into
  // a host-specific CANTOPEN failure while shorter cases using the same code
  // path succeeded. Use a short, collision-resistant directory prefix and keep
  // the complete case id only in the matrix result/log.
  const root = createApplicationMatrixTempRoot(name);
  const release = createInstalledResources({ gitCommit: '6'.repeat(40), sourceTree: '7'.repeat(40) });
  const vault = new CredentialVault(path.join(root, 'secure', 'credentials.safe.json'), { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'secure', 'vault-meta.json') });
  const releaseManifestHost = new ReleaseManifestHost({ resourcesPath: release.resourcesPath });
  const desktopHost = new DesktopHost({ releaseManifestHost, credentialVaultHost: vaultHost });
  let connection = null;
  let failNextStart = false;
  let failNextStop = false;
  let failNextStopReason = 'INJECTED_APPLICATION_STOP_FAILURE';
  let failCleanupStopReason = '';
  let corruptReadyOnce = '';
  let corruptAfterNextStart = '';
  let runtimeMismatchOnce = '';
  let runtimeBarrier = null;
  let runtimeEntered = null;
  let shutdownPending = false;
  let stopBarrier = null;
  let stopEntered = null;
  const events = [];
  const startOptions = {
    entry: path.join(ROOT, 'backend', 'desktopHostedEntry.js'),
    cwd: ROOT,
    execPath: process.execPath,
    env: isolatedBackendEnvironment({
      YANCE_DATA_DIR: root,
      YANCE_PORT: '0',
      YANCE_HOST: '127.0.0.1',
      YANCE_MODEL_TIMEOUT_MS: '5000',
      YANCE_APP_ROOT: ROOT,
      YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1',
      YANCE_WP4_CREDENTIAL_CUSTODY_PROBE: '1'
    }),
    credentialTimeoutMs: 15000,
    readyTimeoutMs: 45000
  };

  async function startBackend(options = {}) {
    events.push('start');
    if (failNextStart) {
      failNextStart = false;
      const error = new Error('injected application-level backend start failure');
      error.reasonCode = 'INJECTED_APPLICATION_START_FAILURE';
      throw error;
    }
    const started = await desktopHost.startBackend({ ...startOptions, ...options });
    connection = { port: started.readiness.port, token: started.apiSessionToken, pid: started.child.pid };
    if (corruptAfterNextStart) {
      corruptReadyOnce = corruptAfterNextStart;
      corruptAfterNextStart = '';
    }
    return { ok: true, source: 'real-production-backend', pid: started.child.pid, port: started.readiness.port };
  }

  async function stopBackend(options = {}) {
    events.push('stop');
    if (typeof stopEntered === 'function') stopEntered();
    if (stopBarrier) await stopBarrier;
    if (String(options.reason || '') === 'new-owner-readiness-rejected' && failCleanupStopReason) {
      const reasonCode = failCleanupStopReason;
      failCleanupStopReason = '';
      return { stopped: false, exitConfirmed: false, reasonCode, backendPid: desktopHost.backendProcessHost.snapshot().backendPid };
    }
    if (failNextStop) {
      failNextStop = false;
      const reasonCode = failNextStopReason;
      failNextStopReason = 'INJECTED_APPLICATION_STOP_FAILURE';
      return { stopped: false, exitConfirmed: false, reasonCode, backendPid: desktopHost.backendProcessHost.snapshot().backendPid };
    }
    const result = await desktopHost.stopBackend({ ...options, gracefulMs: 8000, forceMs: 8000 });
    connection = null;
    return result;
  }

  function backendSnapshot() {
    const actual = desktopHost.backendProcessHost.snapshot();
    if (!corruptReadyOnce) return actual;
    const mode = corruptReadyOnce;
    corruptReadyOnce = '';
    if (mode === 'generation') return { ...actual, credentialGeneration: Number(actual.credentialGeneration || 0) + 9 };
    if (mode === 'digest') return { ...actual, credentialAuthorityHeadDigest: '0'.repeat(64) };
    if (mode === 'fd6') return { ...actual, credentialCustody: { ...(actual.credentialCustody || {}), dedicatedPipeActive: false } };
    return actual;
  }

  async function validateRuntimeProjection() {
    if (!connection) throw Object.assign(new Error('runtime connection unavailable'), { reasonCode: 'APPLICATION_RUNTIME_CONNECTION_UNAVAILABLE' });
    const response = await request(connection.port, connection.token, '/api/desktop/credential-authority-state');
    if (response.statusCode !== 200 || !response.body?.ok) throw Object.assign(new Error('runtime projection endpoint failed'), { reasonCode: 'APPLICATION_RUNTIME_PROJECTION_UNAVAILABLE', response });
    if (typeof runtimeEntered === 'function') runtimeEntered();
    if (runtimeBarrier) await runtimeBarrier;
    if (!runtimeMismatchOnce) return response.body;
    const mode = runtimeMismatchOnce;
    runtimeMismatchOnce = '';
    if (mode === 'sqlite-generation') return { ...response.body, sqliteCredentialMetadata: { ...response.body.sqliteCredentialMetadata, generation: Number(response.body.sqliteCredentialMetadata.generation || 0) + 1 } };
    if (mode === 'secure-bridge-count') return { ...response.body, secureBridge: { ...response.body.secureBridge, credentialRefs: Number(response.body.secureBridge.credentialRefs || 0) + 1 } };
    return response.body;
  }

  function makeCoordinator() {
    return new DesktopCredentialApplicationCoordinator({
      desktopHost,
      vaultHost,
      startBackend,
      stopBackend,
      backendSnapshot,
      waitForOwnerExitRecovery: child => desktopHost.waitForBackendOwnerExitRecovery(child),
      getOwnedBackendChild: () => desktopHost.backendProcessHost.getOwnedChild(),
      validateRuntimeProjection,
      isShutdownPending: () => shutdownPending,
      journalPath: path.join(root, 'secure', 'desktop-credential-application-lifecycle.json')
    });
  }

  let coordinator = makeCoordinator();
  return {
    root, release, vault, vaultHost, desktopHost, events,
    get coordinator() { return coordinator; },
    replaceCoordinator() { coordinator = makeCoordinator(); return coordinator; },
    connection: () => connection,
    failStart() { failNextStart = true; },
    failStop(reasonCode = 'INJECTED_APPLICATION_STOP_FAILURE') { failNextStop = true; failNextStopReason = reasonCode; },
    failCleanupStop(reasonCode = 'INJECTED_REJECTED_OWNER_STOP_FAILURE') { failCleanupStopReason = reasonCode; },
    corruptReady(mode) { corruptAfterNextStart = mode; },
    mismatchRuntime(mode) { runtimeMismatchOnce = mode; },
    setRuntimeBarrier(value, entered) { runtimeBarrier = value; runtimeEntered = entered || null; },
    setShutdown(value) { shutdownPending = value; },
    setStopBarrier(value, entered) { stopBarrier = value; stopEntered = entered || null; },
    fd6Request(action = 'PREPARE', requestId = `contained-${Date.now()}`) {
      const authority = vaultHost.snapshotMetadata();
      return {
        protocolVersion: 1,
        action,
        requestId,
        operation: 'persist',
        backendPid: desktopHost.backendProcessHost.snapshot().backendPid || 1,
        startupNonce: 'contained-startup',
        backendSessionId: 'contained-session',
        fd6PipeInstanceId: 'contained-fd6',
        manifestSha256: '6'.repeat(64),
        vaultEpoch: authority.vaultEpoch,
        generation: authority.generation,
        payload: { ref: `matrix/${requestId}`, value: { redacted: true }, mutationSha256: '7'.repeat(64) }
      };
    },
    async forceRejectedOwnerExit() {
      const child = desktopHost.backendProcessHost.getOwnedChild();
      if (!child) {
        if (coordinator.isRejectedOwnerContainmentActive()) {
          return coordinator.recoverStartupContainment({ reason: 'matrix-owner-exited-before-explicit-kill' });
        }
        return { recovered: true, notRequired: true };
      }
      const exitObserved = child.exitCode != null || child.__desktopHostExited
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Object.assign(new Error('rejected owner did not exit'), { reasonCode: 'REJECTED_OWNER_EXIT_TIMEOUT' })), 15000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      child.kill('SIGKILL');
      await exitObserved;
      await desktopHost.waitForBackendOwnerExitRecovery(child);
      connection = null;
      return coordinator.recoverAfterBackendExit(child, { unexpected: false });
    },
    async cleanup() {
      stopBarrier = null;
      runtimeBarrier = null;
      let child = desktopHost.backendProcessHost.getOwnedChild();
      await Promise.race([
        desktopHost.stopBackend({ gracefulMs: 1500, forceMs: 1500 }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 4000))
      ]);
      child = child || desktopHost.backendProcessHost.getOwnedChild();
      if (child && child.exitCode == null && child.__desktopHostExited !== true) {
        const exited = new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(true); });
        });
        try { child.kill('SIGKILL'); } catch (_) {}
        const exitConfirmed = await exited;
        if (!exitConfirmed && child.exitCode == null && child.__desktopHostExited !== true) {
          const error = new Error(`Application matrix cleanup could not terminate backend PID ${Number(child.pid || 0)}`);
          error.reasonCode = 'WP4_APPLICATION_MATRIX_CLEANUP_CHILD_STILL_LIVE';
          throw error;
        }
      }
      connection = null;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(release.resourcesPath, { recursive: true, force: true });
    }
  };
}

async function runCase(id, work) {
  const startedAt = Date.now();
  let runtime;
  let result;
  try {
    runtime = await createRuntime(id.toLowerCase());
    const caseTimeoutMs = 60000;
    let timer = null;
    try {
      const detail = await Promise.race([
        work(runtime),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Application lifecycle matrix case exceeded ${caseTimeoutMs}ms`);
            error.reasonCode = 'WP4_APPLICATION_MATRIX_CASE_TIMEOUT';
            reject(error);
          }, caseTimeoutMs);
          timer.unref?.();
        })
      ]);
      result = { id, status: 'PASS', productionChainExecuted: true, elapsedMs: Date.now() - startedAt, ...detail };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    result = {
      id,
      status: 'FAIL',
      productionChainExecuted: true,
      elapsedMs: Date.now() - startedAt,
      reasonCode: error.reasonCode || error.code || 'APPLICATION_MATRIX_CASE_FAILED',
      message: error.message,
      phase: String(error.phase || error.details?.phase || ''),
      stackHash: String(error.stackHash || error.details?.stackHash || ''),
      causeCodeHash: String(error.causeCodeHash || error.details?.causeCodeHash || ''),
      runtimeSubphase: String(error.runtimeSubphase || error.details?.runtimeSubphase || ''),
      backendStartDiagnostics: error.backendStartDiagnostics || null,
      detail: error.detail || null
    };
  }
  if (runtime) {
    try { await runtime.cleanup(); }
    catch (cleanupError) {
      result = {
        ...result,
        status: 'FAIL',
        reasonCode: cleanupError.reasonCode || cleanupError.code || 'WP4_APPLICATION_MATRIX_CLEANUP_FAILED',
        message: cleanupError.message,
        cleanupFailure: true
      };
    }
  }
  return result;
}

async function runDesktopCredentialApplicationLifecycleMatrix(options = {}) {
  const cases = [];
  const selectedCaseIds = new Set(Array.isArray(options.caseIds) ? options.caseIds : []);
  const shouldRun = id => selectedCaseIds.size === 0 || selectedCaseIds.has(id);
  const addCase = async (id, work) => {
    if (!shouldRun(id)) return;
    process.stderr.write(`[wp4-application-matrix] ${id}:start\n`);
    const row = await runCase(id, work);
    process.stderr.write(`[wp4-application-matrix] ${id}:${row.status.toLowerCase()} ${row.elapsedMs}ms${row.reasonCode ? ` ${row.reasonCode}` : ''}\n`);
    cases.push(row);
  };

  async function createLiveRejectedOwner(x, options = {}) {
    await x.coordinator.startBackend();
    const rejection = String(options.rejection || 'generation');
    const cleanupReasonCode = String(options.cleanupReasonCode || 'INJECTED_REJECTED_OWNER_STOP_FAILURE');
    x.failCleanupStop(cleanupReasonCode);
    if (rejection === 'runtime') x.mismatchRuntime(options.runtimeMode || 'sqlite-generation');
    else x.corruptReady(rejection);
    let failed = null;
    try {
      await x.coordinator.applyVaultMutationWithRestart('persist', options.ref || `matrix/rejected-${rejection}`, { token: 'not-recorded' }, { requestId: options.requestId || `application-matrix-rejected-${rejection}` });
    } catch (error) { failed = error; }
    const coordinator = x.coordinator.snapshot();
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const authority = x.vaultHost.snapshotMetadata();
    const cleanup = failed?.rejectedOwnerCleanup || {};
    const liveContained = cleanup.applicationFenceActive === true &&
      coordinator.state === 'FATAL_OWNER_CONTAINMENT' &&
      coordinator.containmentActive === true &&
      coordinator.leaseHeld === false &&
      Boolean(coordinator.applicationFence) &&
      backend.ownerTrusted === false &&
      backend.ownershipPresent === true &&
      backend.credentialCustody?.dedicatedPipeActive !== true &&
      Boolean(authority.applicationFence);
    const concurrentlyExitedAndRecovered = cleanup.recoveredAfterConcurrentExit === true &&
      cleanup.ownerReleased === true &&
      cleanup.applicationFenceActive === false &&
      coordinator.containmentActive === false &&
      coordinator.leaseHeld === false &&
      !coordinator.applicationFence &&
      backend.ownershipPresent === false &&
      backend.credentialCustody?.dedicatedPipeActive !== true &&
      !authority.applicationFence &&
      !authority.activeOwnerSession &&
      !authority.pendingOwnerSession;
    const pass = failed?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' &&
      failed.mutationCommitted === true &&
      (liveContained || concurrentlyExitedAndRecovered);
    if (!pass) {
      throw Object.assign(new Error('rejected live owner did not enter durable fatal containment'), {
        detail: {
          failed: failed && { reasonCode: failed.reasonCode, cleanupReasonCode: failed.cleanupReasonCode, cleanup: failed.rejectedOwnerCleanup, failures: failed.failures },
          coordinator,
          backend,
          authority
        }
      });
    }
    return { failed, coordinator, backend, authority, cleanupReasonCode };
  }

  await addCase('A01_REAL_SAVE_STOP_EXIT_COMMIT_FD5_READY', async x => {
    await x.coordinator.startBackend();
    const before = x.vaultHost.snapshotAuthorityBoundary();
    x.events.length = 0;
    const result = await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/save', { token: 'not-recorded' }, { requestId: 'application-matrix-save' });
    const after = x.vaultHost.snapshotAuthorityBoundary();
    const runtime = await request(x.connection().port, x.connection().token, '/api/desktop/credential-authority-state');
    const pass = result.ok === true && result.appliedBy === 'DESKTOP_CREDENTIAL_APPLICATION_COORDINATOR' && x.events.join(',') === 'stop,start' && after.generation === before.generation + 2 && after.journalTransactionCount === before.journalTransactionCount + 1 && runtime.body?.credentialMetadata?.generation === after.generation && runtime.body?.sqliteCredentialMetadata?.generation === after.generation && runtime.body?.secureBridge?.credentialRefs === 1;
    if (!pass) throw Object.assign(new Error('real save lifecycle did not converge'), { detail: { before, after, events: x.events, result, runtime: runtime.body } });
    return { expectedDisposition: 'REAL_EXIT_THEN_ONE_COMMIT_THEN_FD5_READY', beforeGeneration: before.generation, afterGeneration: after.generation, transactionDelta: 1 };
  });

  await addCase('A02_FD6_RETRYABLE_DURING_APPLICATION_LEASE', async x => {
    await x.coordinator.startBackend();
    const oldConnection = x.connection();
    let release;
    let enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    x.setStopBarrier(barrier, enteredResolve);
    const mutation = x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/lease', { token: 'not-recorded' }, { requestId: 'application-matrix-lease' });
    await entered;
    const response = await request(oldConnection.port, oldConnection.token, '/api/wp4/credential-persist-probe', { method: 'POST', body: { ref: 'matrix/fd6-blocked', value: { token: 'not-recorded' } } });
    release();
    await mutation;
    const blocked = response.statusCode >= 400 && response.body?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_BUSY_RETRY' && response.body?.retryable === true;
    if (!blocked || x.vaultHost.refs().includes('matrix/fd6-blocked')) throw Object.assign(new Error('FD6 was not retryably fenced by the application lease'), { detail: response });
    return { expectedDisposition: 'FD6_RETRYABLE_REJECTION_UNTIL_NEW_OWNER_READY', httpStatus: response.statusCode, reasonCode: response.body.reasonCode };
  });

  await addCase('A03_STOP_FAILURE_AUTHORITY_UNCHANGED', async x => {
    await x.coordinator.startBackend();
    const before = x.vaultHost.snapshotAuthorityBoundary();
    x.failStop();
    let reasonCode = '';
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/blocked', { token: 'not-recorded' }, { requestId: 'application-matrix-stop-fail' }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const after = x.vaultHost.snapshotAuthorityBoundary();
    const pass = reasonCode === 'INJECTED_APPLICATION_STOP_FAILURE' && sameBoundary(before, after) && x.desktopHost.backendProcessHost.snapshot().running === true && !x.vaultHost.refs().includes('matrix/blocked');
    if (!pass) throw Object.assign(new Error('stop failure changed authority or reported success'), { detail: { reasonCode, before, after, backend: x.desktopHost.backendProcessHost.snapshot() } });
    return { expectedDisposition: 'NO_MUTATION_AND_OLD_OWNER_REMAINS', reasonCode, authorityUnchanged: true };
  });

  await addCase('A04_COMMIT_THEN_START_FAILURE_IDEMPOTENT_RESUME', async x => {
    await x.coordinator.startBackend();
    x.failStart();
    let failed = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/resume', { token: 'not-recorded' }, { requestId: 'application-matrix-resume' }); }
    catch (error) { failed = error; }
    const committed = x.vaultHost.snapshotAuthorityBoundary();
    if (!failed || failed.mutationCommitted !== true || x.desktopHost.backendProcessHost.snapshot().running) throw Object.assign(new Error('post-commit start failure was not fail-safe'), { detail: { failed: failed?.reasonCode, committed } });
    const resumed = await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/resume', { token: 'not-recorded' }, { requestId: 'application-matrix-resume' });
    const final = x.vaultHost.snapshotAuthorityBoundary();
    const pass = resumed.durableReplay === true && final.journalTransactionCount === committed.journalTransactionCount && final.generation === committed.generation + 1 && x.desktopHost.backendProcessHost.snapshot().running === true;
    if (!pass) throw Object.assign(new Error('same requestId did not resume idempotently'), { detail: { committed, final, resumed } });
    return { expectedDisposition: 'COMMIT_ONCE_FAIL_SAFE_THEN_DURABLE_REPLAY', failureReasonCode: failed.reasonCode, durableReplay: true };
  });

  await addCase('A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER', async x => {
    await x.coordinator.startBackend();
    x.corruptReady('generation');
    let failed = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/ready-mismatch', { token: 'not-recorded' }, { requestId: 'application-matrix-ready-mismatch' }); }
    catch (error) { failed = error; }
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const pass = failed?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' && failed.mutationCommitted === true && backend.running === false && backend.ownershipPresent === false && failed.rejectedOwnerCleanup?.ownerReleased === true;
    if (!pass) throw Object.assign(new Error('READY mismatch left a pseudo-running owner'), { detail: { failed: failed && { reasonCode: failed.reasonCode, cleanup: failed.rejectedOwnerCleanup, failures: failed.failures }, backend } });
    return { expectedDisposition: 'REJECT_AND_TERMINATE_NEW_OWNER', mismatch: 'generation', ownerReleased: true };
  });

  await addCase('A06_RUNTIME_PROJECTION_MISMATCH_STOPS_REJECTED_OWNER', async x => {
    await x.coordinator.startBackend();
    x.mismatchRuntime('sqlite-generation');
    let failed = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/runtime-mismatch', { token: 'not-recorded' }, { requestId: 'application-matrix-runtime-mismatch' }); }
    catch (error) { failed = error; }
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const pass = failed?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' && failed.mutationCommitted === true && backend.running === false && backend.ownershipPresent === false;
    if (!pass) throw Object.assign(new Error('runtime authority split left a live owner'), { detail: { failed: failed && { reasonCode: failed.reasonCode, cleanup: failed.rejectedOwnerCleanup, failures: failed.failures }, backend } });
    return { expectedDisposition: 'RUNTIME_AUTHORITY_SPLIT_FAILS_CLOSED', mismatch: 'sqlite-generation', ownerReleased: true };
  });

  await addCase('A07_SHUTDOWN_AFTER_EXIT_BLOCKS_MUTATION', async x => {
    await x.coordinator.startBackend();
    const before = x.vaultHost.snapshotAuthorityBoundary();
    const originalStop = x.desktopHost.stopBackend.bind(x.desktopHost);
    let armed = true;
    x.coordinator.stopBackendCallback = async options => {
      const result = await originalStop({ ...options, gracefulMs: 8000, forceMs: 8000 });
      if (armed) { armed = false; x.setShutdown(true); }
      return result;
    };
    let reasonCode = '';
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/shutdown', { token: 'not-recorded' }, { requestId: 'application-matrix-shutdown' }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const after = x.vaultHost.snapshotAuthorityBoundary();
    const pass = reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_SHUTDOWN_PENDING' && sameBoundary(before, after) && !x.vaultHost.refs().includes('matrix/shutdown');
    if (!pass) throw Object.assign(new Error('application shutdown did not cancel before commit'), { detail: { reasonCode, before, after } });
    return { expectedDisposition: 'EXIT_RECOVERED_NO_COMMIT_DURING_SHUTDOWN', authorityUnchanged: true };
  });

  await addCase('A08_APPLICATION_RESTART_RECOVERS_COMMITTED_OPERATION', async x => {
    await x.coordinator.startBackend();
    x.failStart();
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/app-restart', { token: 'not-recorded' }, { requestId: 'application-matrix-app-restart' }); } catch (_) {}
    const committed = x.vaultHost.snapshotAuthorityBoundary();
    const restartedCoordinator = x.replaceCoordinator();
    const recoveredSnapshot = restartedCoordinator.snapshot();
    const resumed = await restartedCoordinator.applyVaultMutationWithRestart('persist', 'matrix/app-restart', { token: 'not-recorded' }, { requestId: 'application-matrix-app-restart' });
    const final = x.vaultHost.snapshotAuthorityBoundary();
    const pass = recoveredSnapshot.state === 'FAILED_SAFE' && recoveredSnapshot.interruptedOperation?.mutationCommitted === true && resumed.durableReplay === true && final.journalTransactionCount === committed.journalTransactionCount && final.generation === committed.generation + 1;
    if (!pass) throw Object.assign(new Error('application lifecycle journal did not recover committed operation'), { detail: { recoveredSnapshot, resumed, committed, final } });
    return { expectedDisposition: 'INTERRUPTED_COMMITTED_OPERATION_DURABLE_REPLAY', interruptedStateDetected: true, durableReplay: true };
  });


  await addCase('A09_READY_DIGEST_MISMATCH_STOPS_REJECTED_OWNER', async x => {
    await x.coordinator.startBackend();
    x.corruptReady('digest');
    let failed = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/digest-mismatch', { token: 'not-recorded' }, { requestId: 'application-matrix-digest-mismatch' }); }
    catch (error) { failed = error; }
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const pass = failed?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' && failed.mutationCommitted === true && backend.running === false && backend.ownershipPresent === false;
    if (!pass) throw Object.assign(new Error('authority digest mismatch did not fail closed'), { detail: { failed: failed && { reasonCode: failed.reasonCode, failures: failed.failures }, backend } });
    return { expectedDisposition: 'AUTHORITY_DIGEST_MISMATCH_FAILS_CLOSED', ownerReleased: true };
  });

  await addCase('A10_FD6_MISSING_STOPS_REJECTED_OWNER', async x => {
    await x.coordinator.startBackend();
    x.corruptReady('fd6');
    let failed = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/fd6-missing', { token: 'not-recorded' }, { requestId: 'application-matrix-fd6-missing' }); }
    catch (error) { failed = error; }
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const pass = failed?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' && failed.mutationCommitted === true && backend.running === false && backend.ownershipPresent === false;
    if (!pass) throw Object.assign(new Error('missing FD6 did not reject the new owner'), { detail: { failed: failed && { reasonCode: failed.reasonCode, failures: failed.failures }, backend } });
    return { expectedDisposition: 'FD6_REQUIRED_BEFORE_UI_SUCCESS', ownerReleased: true };
  });

  await addCase('A11_UI_SUCCESS_WAITS_FOR_RUNTIME_PROJECTION', async x => {
    await x.coordinator.startBackend();
    let release;
    let enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    x.setRuntimeBarrier(barrier, enteredResolve);
    let settled = false;
    const mutation = x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/ui-wait', { token: 'not-recorded' }, { requestId: 'application-matrix-ui-wait' }).finally(() => { settled = true; });
    await entered;
    const blockedState = x.coordinator.snapshot().state;
    if (blockedState !== 'NEW_OWNER_HYDRATING') {
      release();
      await mutation.catch(() => {});
      throw Object.assign(new Error('UI lifecycle crossed READY before runtime projection validation completed'), { detail: { blockedState } });
    }
    const earlyOutcome = await Promise.race([
      mutation.then(() => 'resolved', () => 'rejected'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 2000))
    ]);
    if (earlyOutcome !== 'pending' || settled) {
      release();
      await mutation.catch(() => {});
      throw new Error('UI mutation resolved before runtime projection validation completed');
    }
    release();
    const result = await mutation;
    if (!result.ok || !settled) throw new Error('UI mutation did not resolve after runtime projection validation');
    return { expectedDisposition: 'UI_SUCCESS_AFTER_FD5_READY_AND_RUNTIME_PROJECTION', resolvedBeforeProjection: false };
  });

  await addCase('A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_GRACEFUL_STOP_FAILURE', requestId: 'application-matrix-rejected-generation-stop-fail' });
    return {
      expectedDisposition: 'FATAL_CONTAINMENT_WITH_PERSISTENT_APPLICATION_FENCE',
      ...containmentRecord(live)
    };
  });

  await addCase('A13_READY_DIGEST_MISMATCH_SIGKILL_FAILURE_CONTAINED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'digest', cleanupReasonCode: 'INJECTED_SIGKILL_FAILURE', requestId: 'application-matrix-rejected-digest-sigkill-fail' });
    if (live.failed.cleanupReasonCode !== 'INJECTED_SIGKILL_FAILURE') throw Object.assign(new Error('SIGKILL cleanup failure reason was not retained'), { detail: live.failed.rejectedOwnerCleanup });
    return { expectedDisposition: 'DIGEST_REJECTED_OWNER_REMAINS_FATAL_CONTAINED', ...containmentRecord(live) };
  });

  await addCase('A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'runtime', runtimeMode: 'sqlite-generation', cleanupReasonCode: 'INJECTED_RUNTIME_REJECTED_OWNER_STOP_FAILURE', requestId: 'application-matrix-runtime-cleanup-fail' });
    if (!live.failed.failures?.includes('sqlite-generation')) throw Object.assign(new Error('runtime projection rejection was not the containment trigger'), { detail: live.failed.failures });
    return { expectedDisposition: 'RUNTIME_PROJECTION_REJECTION_RETAINS_FATAL_FENCE', runtimeMismatch: 'sqlite-generation', ...containmentRecord(live) };
  });

  await addCase('A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'fd6', cleanupReasonCode: 'INJECTED_FD6_REJECTED_OWNER_STOP_FAILURE', requestId: 'application-matrix-fd6-cleanup-fail' });
    if (!live.failed.failures?.includes('fd6-not-active')) throw Object.assign(new Error('missing FD6 was not the containment trigger'), { detail: live.failed.failures });
    return { expectedDisposition: 'FD6_MISSING_REJECTION_RETAINS_FATAL_FENCE', ...containmentRecord(live) };
  });

  await addCase('A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_PREPARE_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-prepare-owner' });
    let rejected = null;
    try { await x.vaultHost.prepareCustodyTransaction(x.fd6Request('PREPARE', 'contained-fd6-prepare')); }
    catch (error) { rejected = error; }
    const pass = rejected?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT' && (rejected.retryable === true || rejected.fatal === true) && !x.vaultHost.refs().includes('matrix/contained-fd6-prepare');
    if (!pass) throw Object.assign(new Error('FD6 PREPARE was not denied by rejected-owner containment'), { detail: { rejected, live } });
    return {
      expectedDisposition: 'FD6_PREPARE_FATAL_OR_RETRYABLE_REJECTION',
      ...containmentRecord(live),
      fd6RequestResult: { action: 'PREPARE', accepted: false, reasonCode: rejected.reasonCode, retryable: rejected.retryable === true, fatal: rejected.fatal === true }
    };
  });

  await addCase('A17_LIVE_REJECTED_OWNER_FD6_COMMIT_DENIED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_COMMIT_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-commit-owner' });
    let rejected = null;
    try { await x.vaultHost.commitCustodyTransaction(x.fd6Request('COMMIT', 'contained-fd6-commit')); }
    catch (error) { rejected = error; }
    if (rejected?.reasonCode !== 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT') throw Object.assign(new Error('FD6 COMMIT was not denied by rejected-owner containment'), { detail: rejected });
    return {
      expectedDisposition: 'FD6_COMMIT_FATAL_OR_RETRYABLE_REJECTION',
      ...containmentRecord(live),
      fd6RequestResult: { action: 'COMMIT', accepted: false, reasonCode: rejected.reasonCode, retryable: rejected.retryable === true, fatal: rejected.fatal === true }
    };
  });

  await addCase('A18_LIVE_REJECTED_OWNER_START_ALREADY_READY_DENIED', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_START_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-start-owner' });
    let rejected = null;
    try { await x.coordinator.startBackend(); } catch (error) { rejected = error; }
    const snapshot = x.coordinator.snapshot();
    if (rejected?.reasonCode !== 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT' || snapshot.state !== 'FATAL_OWNER_CONTAINMENT') throw Object.assign(new Error('contained owner passed start/alreadyReady path'), { detail: { rejected, snapshot } });
    return {
      expectedDisposition: 'START_AND_ALREADY_READY_BYPASS_DENIED',
      ...containmentRecord(live),
      alreadyReadyResult: { accepted: false, reasonCode: rejected.reasonCode, retryable: rejected.retryable === true, fatal: rejected.fatal === true },
      coordinatorFinalState: snapshot.state
    };
  });

  await addCase('A19_LIVE_REJECTED_OWNER_RESTART_DENIED', async x => {
    await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_RESTART_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-restart-owner' });
    let rejected = null;
    try { await x.coordinator.restartBackend(); } catch (error) { rejected = error; }
    if (rejected?.reasonCode !== 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT') throw Object.assign(new Error('contained owner allowed restart'), { detail: rejected });
    return { expectedDisposition: 'RESTART_DENIED_UNTIL_REAL_EXIT_RECOVERY', reasonCode: rejected.reasonCode };
  });

  await addCase('A20_LIVE_REJECTED_OWNER_APPLICATION_EXIT_RETAINS_FENCE', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_INITIAL_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-shutdown-owner' });
    const initial = containmentRecord(live);
    if (initial.recoveredAfterConcurrentExit) {
      const stopped = await x.coordinator.stopBackend({ forShutdown: true });
      const snapshot = x.coordinator.snapshot();
      const pass = stopped?.stopped === true && snapshot.containmentActive === false && !snapshot.applicationFence;
      if (!pass) throw Object.assign(new Error('already-exited rejected owner did not remain safely recovered during application exit'), { detail: { stopped, snapshot, initial } });
      return { expectedDisposition: 'OWNER_EXIT_PRECEDED_SHUTDOWN_FENCE_ALREADY_SAFELY_RELEASED', recoveredAfterConcurrentExit: true, applicationFenceActive: false };
    }
    x.failStop('INJECTED_CONTAINMENT_SHUTDOWN_STOP_FAILURE');
    let rejected = null;
    try { await x.coordinator.stopBackend({ forShutdown: true }); } catch (error) { rejected = error; }
    const snapshot = x.coordinator.snapshot();
    const pass = rejected?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT' && snapshot.state === 'FATAL_OWNER_CONTAINMENT' && snapshot.containmentActive === true && snapshot.leaseHeld === false && Boolean(snapshot.applicationFence);
    if (!pass) throw Object.assign(new Error('application exit released live rejected-owner fence'), { detail: { rejected, snapshot } });
    return { expectedDisposition: 'SHUTDOWN_STOP_FAILURE_RETAINS_FATAL_FENCE', cleanupReasonCode: snapshot.containment.cleanupReasonCode, applicationFenceActive: true };
  });

  await addCase('A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER', async x => {
    const live = await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_EVENTUAL_EXIT_STOP_FAILURE', requestId: 'application-matrix-eventual-exit-owner' });
    const beforeExit = containmentRecord(live);
    const recovered = await x.forceRejectedOwnerExit();
    const afterExit = x.coordinator.snapshot();
    const backendAfterExit = x.desktopHost.backendProcessHost.snapshot();
    const authorityAfterExit = x.vaultHost.snapshotMetadata();
    if (afterExit.containmentActive || afterExit.applicationFence || !['FAILED_SAFE', 'STOPPED', 'IDLE'].includes(afterExit.state) || backendAfterExit.ownershipPresent || authorityAfterExit.activeOwnerSession || authorityAfterExit.pendingOwnerSession) {
      throw Object.assign(new Error('real rejected-owner exit did not release containment after owner recovery'), { detail: { recovered, afterExit, backendAfterExit, authorityAfterExit } });
    }
    const started = await x.coordinator.startBackend();
    const final = x.coordinator.snapshot();
    if (!started.ok || final.state !== 'IDLE' || final.containmentActive || !x.desktopHost.backendProcessHost.snapshot().running) throw Object.assign(new Error('new owner did not start after containment recovery'), { detail: { started, final, backend: x.desktopHost.backendProcessHost.snapshot() } });
    return {
      expectedDisposition: 'REAL_EXIT_OWNER_RECOVERY_THEN_NEW_OWNER_ACCEPTED',
      recovered: true,
      newOwnerReady: true,
      beforeExit,
      eventualExitRecoveryResult: recovered,
      afterExit: {
        coordinatorState: afterExit.state,
        containmentActive: afterExit.containmentActive === true,
        applicationFenceActive: Boolean(afterExit.applicationFence),
        ownershipPresent: backendAfterExit.ownershipPresent === true,
        backendPid: Number(backendAfterExit.backendPid || 0),
        activeOwnerSession: authorityAfterExit.activeOwnerSession || null,
        pendingOwnerSession: authorityAfterExit.pendingOwnerSession || null,
        authorityState: authorityAfterExit.lifecycle?.state || '',
        authorityAvailable: authorityAfterExit.available === true
      },
      newOwnerStartResult: { accepted: true, ok: started.ok === true },
      finalState: {
        coordinatorState: final.state,
        containmentActive: final.containmentActive === true,
        applicationFenceActive: Boolean(final.applicationFence),
        backendRunning: x.desktopHost.backendProcessHost.snapshot().running === true
      }
    };
  });

  await addCase('A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION', async x => {
    await x.coordinator.startBackend();
    x.mismatchRuntime('sqlite-generation');
    let rejected = null;
    try { await x.coordinator.startBackend(); } catch (error) { rejected = error; }
    const backend = x.desktopHost.backendProcessHost.snapshot();
    const pass = rejected?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' && rejected.failures?.includes('sqlite-generation') && backend.running === false && backend.ownershipPresent === false;
    if (!pass) throw Object.assign(new Error('alreadyReady skipped full runtime projection validation'), { detail: { rejected, backend } });
    return {
      expectedDisposition: 'ALREADY_READY_REVALIDATED_AND_REJECTED',
      runtimeMismatch: 'sqlite-generation',
      ownerReleased: true,
      alreadyReadyResult: { accepted: false, reasonCode: rejected.reasonCode, failures: rejected.failures || [] },
      coordinatorFinalState: x.coordinator.snapshot().state
    };
  });

  await addCase('A23_FAILED_SAFE_LIVE_OWNER_CANNOT_RESET_IDLE', async x => {
    await x.coordinator.startBackend();
    x.failStop('INJECTED_FAILED_SAFE_LIVE_OWNER_STOP_FAILURE');
    let initial = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/failed-safe-live', { token: 'not-recorded' }, { requestId: 'application-matrix-failed-safe-live' }); }
    catch (error) { initial = error; }
    let rejected = null;
    try { await x.coordinator.startBackend(); } catch (error) { rejected = error; }
    const snapshot = x.coordinator.snapshot();
    const pass = initial?.reasonCode === 'INJECTED_FAILED_SAFE_LIVE_OWNER_STOP_FAILURE' && rejected?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED' && snapshot.state === 'FAILED_SAFE' && snapshot.failedSafeResetBoundary.safe === false;
    if (!pass) throw Object.assign(new Error('FAILED_SAFE reset to IDLE while old owner remained live'), { detail: { initial, rejected, snapshot, backend: x.desktopHost.backendProcessHost.snapshot() } });
    return { expectedDisposition: 'FAILED_SAFE_RESET_BLOCKED_UNTIL_OWNER_FREE_ACTIVE_BOUNDARY', reasonCode: rejected.reasonCode };
  });

  await addCase('A24_LIVE_REJECTED_OWNER_UI_MUTATION_DENIED', async x => {
    await createLiveRejectedOwner(x, { rejection: 'generation', cleanupReasonCode: 'INJECTED_UI_CONTAINMENT_STOP_FAILURE', requestId: 'application-matrix-contained-ui-owner' });
    const before = x.vaultHost.snapshotAuthorityBoundary();
    let rejected = null;
    try { await x.coordinator.applyVaultMutationWithRestart('persist', 'matrix/contained-ui-denied', { token: 'not-recorded' }, { requestId: 'application-matrix-contained-ui-denied' }); }
    catch (error) { rejected = error; }
    const after = x.vaultHost.snapshotAuthorityBoundary();
    const pass = rejected?.reasonCode === 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT' && sameBoundary(before, after) && !x.vaultHost.refs().includes('matrix/contained-ui-denied') && x.coordinator.snapshot().state === 'FATAL_OWNER_CONTAINMENT';
    if (!pass) throw Object.assign(new Error('UI mutation continued while rejected owner was live'), { detail: { rejected, before, after, snapshot: x.coordinator.snapshot() } });
    return { expectedDisposition: 'UI_MUTATION_DENIED_AUTHORITY_UNCHANGED', reasonCode: rejected.reasonCode, authorityUnchanged: true };
  });

  const failed = cases.filter(row => row.status !== 'PASS');
  const containmentProbes = buildRejectedOwnerContainmentProbes(cases, { requireComplete: selectedCaseIds.size === 0 });
  const result = {
    schemaVersion: 3,
    status: failed.length || containmentProbes.status === 'FAIL' ? 'FAIL' : 'PASS',
    evidenceCompleteness: containmentProbes.status,
    matrix: 'DESKTOP_CREDENTIAL_APPLICATION_LIFECYCLE',
    caseCount: cases.length,
    passedCount: cases.length - failed.length,
    failedCount: failed.length,
    cases,
    containmentProbes,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (failed.length || containmentProbes.status === 'FAIL') {
    const labels = [...failed.map(row => row.id), ...containmentProbes.failures];
    const error = new Error(`Desktop credential application lifecycle matrix failed: ${labels.join(', ')}`);
    error.reasonCode = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_MATRIX_FAILED';
    error.result = result;
    throw error;
  }
  return result;
}

module.exports = {
  applicationMatrixTempPrefix,
  createApplicationMatrixTempRoot,
  groupedProbeStatus,
  buildRejectedOwnerContainmentProbes,
  isolatedBackendEnvironment,
  runDesktopCredentialApplicationLifecycleMatrix
};
if (require.main === module) {
  const mutationCases = {
    M09_DESKTOP_BYPASSES_COORDINATOR: ['A01_REAL_SAVE_STOP_EXIT_COMMIT_FD5_READY'],
    M18_APPLICATION_LEASE_OMITTED: ['A01_REAL_SAVE_STOP_EXIT_COMMIT_FD5_READY'],
    M19_STOP_FAILURE_IGNORED: ['A03_STOP_FAILURE_AUTHORITY_UNCHANGED'],
    M20_READY_FAILURES_IGNORED: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
    M21_READY_GENERATION_UNBOUND: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
    M22_READY_AUTHORITY_DIGEST_UNBOUND: ['A09_READY_DIGEST_MISMATCH_STOPS_REJECTED_OWNER'],
    M23_IDEMPOTENT_REQUEST_ID_DISCARDED: ['A04_COMMIT_THEN_START_FAILURE_IDEMPOTENT_RESUME'],
    M24_SHUTDOWN_BEFORE_COMMIT_IGNORED: ['A07_SHUTDOWN_AFTER_EXIT_BLOCKS_MUTATION'],
    M25_REJECTED_NEW_OWNER_NOT_CLEANED: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
    M26_RUNTIME_PROJECTION_NOT_VALIDATED: ['A06_RUNTIME_PROJECTION_MISMATCH_STOPS_REJECTED_OWNER'],
    M27_APPLICATION_INTERRUPTION_JOURNAL_IGNORED: ['A08_APPLICATION_RESTART_RECOVERS_COMMITTED_OPERATION'],
    M28_UI_SUCCESS_BEFORE_RUNTIME_PROJECTION: ['A11_UI_SUCCESS_WAITS_FOR_RUNTIME_PROJECTION'],
    M29_CLEANUP_FAILURE_RELEASES_APPLICATION_FENCE: ['A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'],
    M30_CLEANUP_FAILURE_LEAVES_FD6_OPEN: ['A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED'],
    M31_FAILED_SAFE_LIVE_OWNER_RESETS_IDLE: ['A23_FAILED_SAFE_LIVE_OWNER_CANNOT_RESET_IDLE'],
    M32_ALREADY_READY_SKIPS_RUNTIME_PROJECTION: ['A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION'],
    M33_LIVE_REJECTED_OWNER_ALLOWS_FD6_PREPARE: ['A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED'],
    M34_CLEANUP_FAILURE_ALLOWS_UI_MUTATION: ['A24_LIVE_REJECTED_OWNER_UI_MUTATION_DENIED']
  };
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || '');
  runDesktopCredentialApplicationLifecycleMatrix({ caseIds: mutationCases[mutationTarget] || [] }).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(0));
  }).catch(error => {
    const detail = `${error.reasonCode || error.code || 'WP4_DESKTOP_CREDENTIAL_APPLICATION_MATRIX_FAILED'} ${error.stack || error.message}\n${error.result ? `${JSON.stringify(error.result, null, 2)}\n` : ''}`;
    process.stderr.write(detail, () => process.exit(1));
  });
}
