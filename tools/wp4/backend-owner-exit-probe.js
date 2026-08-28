#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isolatedBackendEnvironment } = require('./isolated-backend-environment');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialVault } = require('../../electron/credentialVault');
const { STATES: TX_STATES } = require('../../shared/credentialTransactionStateMachine');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');
const { createInstalledResources } = require('../../tests/wp2/helpers');
const { lifecycleSafeStorage } = require('./credential-authority-lifecycle-fixture');
const { request } = require('./production-credential-runtime');

const ROOT = path.resolve(__dirname, '../..');
function onceExit(child) { return new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal: signal || '' }))); }
function optionsFor(root, release, vaultHost) {
  return {
    entry: path.join(ROOT, 'backend', 'desktopHostedEntry.js'), cwd: ROOT, execPath: process.execPath,
    env: isolatedBackendEnvironment({ YANCE_DATA_DIR: root, YANCE_PORT: '0', YANCE_HOST: '127.0.0.1', YANCE_MODEL_TIMEOUT_MS: '5000', YANCE_APP_ROOT: ROOT, YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1', YANCE_WP4_CREDENTIAL_CUSTODY_PROBE: '1' }),
    releaseStartupConfig: { resourcesPath: release.resourcesPath, expectedBuildId: release.manifest.buildId, manifestSha256: release.manifestSha256 },
    credentialHandshakeRequired: true, credentialVaultHost: vaultHost, credentialTimeoutMs: 15000, readyTimeoutMs: 45000,
    readyHealthCheckPath: '/api/health', readyHealthCheckTimeoutMs: 5000, readyHealthCheckRetries: 40, readyHealthCheckRetryDelayMs: 150,
    createCredentialSnapshot: context => vaultHost.createHydrationFrame(context),
    handleBackendOwnerExit: owner => vaultHost.handleBackendOwnerExit(owner)
  };
}


function ownerRequest(vaultHost, id, ref = `owner/${id}`) {
  const snapshot = vaultHost.snapshotMetadata();
  const owner = snapshot.activeOwnerSession;
  if (!owner) throw new Error('active owner session is required');
  return makeCustodyRequest({
    action: 'PREPARE', requestId: id, operation: 'persist', ref, value: { token: 'redacted' },
    backendPid: owner.backendPid, startupNonce: owner.startupNonce, backendSessionId: owner.backendSessionId,
    fd6PipeInstanceId: owner.fd6PipeInstanceId, hydrationGeneration: owner.hydrationGeneration,
    manifestSha256: owner.manifestSha256, vaultEpoch: owner.vaultEpoch, generation: snapshot.generation
  });
}
async function abruptExit(processHost, child, releaseGate) {
  const exit = onceExit(child);
  child.kill('SIGKILL');
  const result = await exit;
  releaseGate?.();
  const recovery = await processHost.waitForOwnerExitRecovery(child);
  return { ...result, recovery };
}
async function runCase(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-owner-${mode.toLowerCase()}-`));
  const release = createInstalledResources({ gitCommit: '8'.repeat(40), sourceTree: '9'.repeat(40) });
  const vault = new CredentialVault(path.join(root, 'secure', 'credentials.safe.json'), { safeStorage: lifecycleSafeStorage({ keySeed: `owner-${mode}` }) });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'secure', 'vault-meta.json') });
  const processHost = new BackendProcessHost();
  const startOptions = optionsFor(root, release, vaultHost);
  let first;
  try {
    first = await processHost.start(startOptions);
    const oldOwner = vaultHost.snapshotMetadata().activeOwnerSession;
    const requestFrame = ownerRequest(vaultHost, `owner-${mode.toLowerCase()}`);
    let requestPromise = null;
    let releaseGate = null;
    let expectedTerminal = '';
    let transactionRequestId = requestFrame.requestId;
    let preRestartRejected = false;

    if (mode === 'PREPARING') {
      vaultHost.crashInjector = name => { if (name === 'AFTER_PREPARING_JOURNAL') { const error = new Error('simulated owner exit preparation window'); error.reasonCode = 'TEST_PREPARING_WINDOW'; throw error; } };
      await vaultHost.prepareCustodyTransaction(requestFrame).catch(() => {});
      vaultHost.crashInjector = () => {};
      expectedTerminal = 'ROLLED_BACK';
    } else if (mode === 'PREPARED' || mode === 'PID_REUSE' || mode === 'OLD_OWNER_FD5_RACE' || mode === 'ELECTRON_BACKEND_EXIT_RACE') {
      await vaultHost.prepareCustodyTransaction(requestFrame);
      expectedTerminal = 'ROLLED_BACK';
    } else if (mode === 'COMMITTING') {
      let enteredResolve;
      const entered = new Promise(resolve => { enteredResolve = resolve; });
      const gate = new Promise(resolve => { releaseGate = resolve; });
      vaultHost.beforeTransactionCommit = async () => { enteredResolve(); await gate; };
      requestPromise = request(first.readiness.port, first.apiSessionToken, '/api/wp4/credential-persist-probe', { method: 'POST', body: { ref: requestFrame.payload.ref, value: { token: 'redacted' } } }).catch(() => null);
      await entered;
      transactionRequestId = vaultHost.activeTransactionId || transactionRequestId;
      expectedTerminal = 'COMMITTED';
    } else if (mode === 'ABORTING') {
      await vaultHost.prepareCustodyTransaction(requestFrame);
      const tx = vaultHost.transactions[requestFrame.requestId];
      vaultHost._transition(tx, TX_STATES.ABORTING, 'TEST_OWNER_EXIT');
      vaultHost._persistJournalOrUnavailable('WP4_CREDENTIAL_TERMINAL_JOURNAL_MISMATCH');
      expectedTerminal = 'ROLLED_BACK';
    } else if (mode === 'AUTO_RESTART') {
      expectedTerminal = '';
    }

    if (mode === 'PID_REUSE') {
      try { vaultHost.establishCustodyOwner({ ...oldOwner, startupNonce: `${oldOwner.startupNonce}-reused`, backendSessionId: `${oldOwner.backendSessionId}-reused`, fd6PipeInstanceId: `${oldOwner.fd6PipeInstanceId}-reused` }); }
      catch (error) { preRestartRejected = error.reasonCode === 'WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH'; }
    }
    if (mode === 'OLD_OWNER_FD5_RACE') {
      try { await vaultHost.createHydrationFrame({ backendPid: oldOwner.backendPid, startupNonce: 'new-owner-too-early', backendSessionId: 'new-session-too-early', fd6PipeInstanceId: 'new-pipe-too-early', oneTimeToken: 'q'.repeat(43), manifestSha256: oldOwner.manifestSha256 }); }
      catch (error) { preRestartRejected = ['WP4_CREDENTIAL_BACKEND_OWNER_SESSION_ACTIVE','CREDENTIAL_TRANSACTION_BUSY_RETRY'].includes(error.reasonCode); }
    }

    let exitResult;
    if (mode === 'ELECTRON_BACKEND_EXIT_RACE') {
      const exit = onceExit(first.child);
      const manualRecovery = vaultHost.handleBackendOwnerExit(oldOwner).catch(error => ({ error: error.reasonCode || error.code }));
      first.child.kill('SIGKILL');
      const exited = await exit;
      const automaticRecovery = await processHost.waitForOwnerExitRecovery(first.child);
      await manualRecovery;
      exitResult = { ...exited, recovery: automaticRecovery };
    } else exitResult = await abruptExit(processHost, first.child, releaseGate);
    await requestPromise;
    vaultHost.beforeTransactionCommit = null;

    const afterExit = vaultHost.snapshotMetadata();
    const tx = vaultHost.transactions[transactionRequestId] || null;
    const oldTransactionEnded = !tx || ['COMMITTED','ROLLED_BACK','FAILED'].includes(tx.state);
    const ownerCleared = afterExit.activeTransactionId === '' && afterExit.activeOwnerSession === null && afterExit.pendingOwnerSession === null;
    const authorityRecovered = afterExit.lifecycle.state === 'ACTIVE' && afterExit.available === true;

    const restarted = await processHost.start(startOptions);
    const afterRestart = vaultHost.snapshotMetadata();
    const next = await request(restarted.readiness.port, restarted.apiSessionToken, '/api/wp4/credential-persist-probe', {
      method: 'POST',
      timeoutMs: 45000,
      retryTransientCount: 6,
      retryTransientDelayMs: 250,
      body: { ref: `next/${mode.toLowerCase()}`, value: { token: 'redacted-next' } }
    });
    const nextSucceeded = next.statusCode === 200 && next.body?.persisted === true;
    const checks = {
      realChildExit: Boolean(exitResult.signal) || exitResult.code !== 0,
      oldOwnerTransactionEnded: oldTransactionEnded,
      expectedTerminalState: !expectedTerminal || tx?.state === expectedTerminal,
      activeTransactionCleared: ownerCleared,
      authorityReturnedActive: authorityRecovered,
      ownerRecoveryCompletedBeforeRestart: exitResult.recovery?.recovered === true,
      newBackendCompletedFd5: restarted.hydration?.generation === afterRestart.generation && processHost.snapshot().state === 'RUNNING',
      nextFd6Succeeded: nextSucceeded,
      pidReuseOrEarlyFd5Rejected: !['PID_REUSE','OLD_OWNER_FD5_RACE'].includes(mode) || preRestartRejected
    };
    const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
    return {
      id: `OWNER_EXIT_${mode}`, mode, status: failed.length ? 'FAIL' : 'PASS', checks, failed,
      oldOwner: { backendPid: oldOwner.backendPid, startupNoncePresent: Boolean(oldOwner.startupNonce), backendSessionIdPresent: Boolean(oldOwner.backendSessionId), fd6PipeInstanceIdPresent: Boolean(oldOwner.fd6PipeInstanceId) },
      initialTransactionState: mode, finalTransactionState: tx?.state || 'NONE', activeTransactionId: afterExit.activeTransactionId,
      authorityStateAfterRecovery: afterExit.lifecycle.state, metadataGeneration: afterRestart.generation,
      vaultReferenceCount: afterRestart.referenceCount, decryptedEntryCount: afterRestart.decryptedEntryCount,
      frameEntryCount: restarted.hydration?.entryCount ?? 0, restoredReferenceCount: restarted.hydration?.restoredReferenceCount ?? restarted.hydration?.entryCount ?? 0,
      backendFinalState: processHost.snapshot().state, nextLegalRequestSucceeded: nextSucceeded, nextFd5HydrationSucceeded: Boolean(restarted.hydration),
      exitCode: exitResult.code, terminationSignal: exitResult.signal, secretValueRecorded: false, secretHashRecorded: false
    };
  } finally {
    await processHost.stop({ gracefulMs: 5000, forceMs: 5000 }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(release.resourcesPath, { recursive: true, force: true });
  }
}
async function runBackendOwnerExitMatrix() {
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || '');
  const targetedModes = {
    M14_BACKEND_EXIT_SKIPS_AUTHORITY_RECOVERY: ['PREPARED'],
    M15_RESTART_IGNORES_ACTIVE_OWNER_TRANSACTION: ['OLD_OWNER_FD5_RACE'],
    M16_OWNER_SESSION_BINDS_PID_ONLY: ['PID_REUSE'],
    M17_F16_SYNTHETIC_BACKEND_EXIT_PASS: ['PREPARED']
  };
  const modes = targetedModes[mutationTarget] || ['PREPARING','PREPARED','COMMITTING','ABORTING','AUTO_RESTART','ELECTRON_BACKEND_EXIT_RACE','PID_REUSE','OLD_OWNER_FD5_RACE'];
  const cases = [];
  for (const mode of modes) cases.push(await runCase(mode));
  const failedCaseIds = cases.filter(row => row.status !== 'PASS').map(row => row.id);
  const value = { schemaVersion: 1, matrix: 'BACKEND_OWNER_SESSION_LIFECYCLE', mutationTarget: mutationTarget || '', status: failedCaseIds.length ? 'FAIL' : 'PASS', caseCount: cases.length, passCount: cases.length - failedCaseIds.length, failedCaseIds, cases, f16Synthetic: false, realBackendProcessHostExitEvents: cases.length, secretValueRecorded: false, secretHashRecorded: false };
  if (failedCaseIds.length) { const error = new Error(`Backend owner-exit matrix failed: ${failedCaseIds.join(', ')}`); error.reasonCode = 'WP4_CREDENTIAL_BACKEND_OWNER_EXIT_MATRIX_FAILED'; error.matrix = value; throw error; }
  return value;
}
module.exports = { runBackendOwnerExitMatrix };
if (require.main === module) runBackendOwnerExitMatrix().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_CREDENTIAL_BACKEND_OWNER_EXIT_MATRIX_FAILED'} ${error.stack || error.message}\n`); if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`); process.exit(1); });
