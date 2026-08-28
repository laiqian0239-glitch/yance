#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { DesktopHost } = require('../../electron/desktopHost/DesktopHost');
const { canonicalEvidenceProcessIdentity } = require('./evidence-process-identity');
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
function deniedResult(error) {
  return { accepted: false, reasonCode: error?.reasonCode || error?.code || 'UNKNOWN', retryable: error?.retryable === true, fatal: error?.fatal === true };
}
async function runContainmentJournalOrderProbe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-containment-journal-probe-'));
  const paths = {
    vault: path.join(root, 'credentials.safe.json'),
    metadata: path.join(root, 'vault-meta.json'),
    owner: path.join(root, 'desktop-backend-owner.json'),
    journal: path.join(root, 'desktop-credential-application-lifecycle.json'),
    sentinel: path.join(root, 'desktop-credential-application-containment.json')
  };
  const backendPid = 48721;
  const live = { value: true };
  const identity = pid => canonicalEvidenceProcessIdentity(pid, 'containment-journal-order');
  try {
    const vault = new CredentialVault(paths.vault, { safeStorage: safeStorage() });
    const vaultHost = new CredentialVaultHost({ vault, metadataPath: paths.metadata });
    await vaultHost.initialize();
    const backendHost = new BackendProcessHost({
      ownerRecordPath: paths.owner,
      isProcessAlive: pid => pid === backendPid && live.value,
      captureProcessIdentity: identity
    });
    const child = new EventEmitter();
    child.pid = backendPid; child.exitCode = null; child.signalCode = null; child.stdio = [];
    backendHost.child = child;
    backendHost.state = 'RUNNING';
    backendHost.session = Object.freeze({
      backendPid,
      startupNonce: 'journal-probe-startup',
      backendSessionId: 'journal-probe-session',
      fd6PipeInstanceId: 'journal-probe-fd6',
      apiSessionToken: 'journal-probe-api-token',
      ownerContext: { backendPid, startupNonce: 'journal-probe-startup', backendSessionId: 'journal-probe-session', fd6PipeInstanceId: 'journal-probe-fd6', hydrationGeneration: vaultHost.snapshotMetadata().generation }
    });
    backendHost.credentialCustodyHost = { close() {}, snapshot: () => ({ dedicatedPipeActive: true, ownerContext: backendHost.session.ownerContext }) };
    backendHost.ownerRegistry.register({
      state: 'RUNNING', ownershipActive: true, trusted: true, backendPid,
      startupNonce: 'journal-probe-startup', backendSessionId: 'journal-probe-session', fd6PipeInstanceId: 'journal-probe-fd6',
      ownerSession: backendHost.session.ownerContext, processIdentity: identity(backendPid)
    });
    const desktopHost = new DesktopHost({ backendProcessHost: backendHost, credentialVaultHost: vaultHost, releaseManifestHost: { snapshot: () => ({}), verify: () => ({}), backendStartupConfig: () => ({}) } });
    let injected = false;
    let armed = false;
    let enforcementAtFault = null;
    let cleanupStopResult = null;
    const coordinator = new DesktopCredentialApplicationCoordinator({
      desktopHost,
      vaultHost,
      startBackend: async () => ({ ok: true }),
      stopBackend: async () => (cleanupStopResult = { stopped: false, exitConfirmed: false, reasonCode: 'INJECTED_REJECTED_OWNER_STOP_FAILURE' }),
      backendSnapshot: () => backendHost.snapshot(),
      getOwnedBackendChild: () => child,
      isProcessAlive: pid => pid === backendPid && live.value,
      journalPath: paths.journal,
      containmentSentinelPath: paths.sentinel,
      persistenceFaultInjector(event) {
        if (armed && !injected && event.kind === 'lifecycle-journal' && event.phase === 'rename') {
          injected = true;
          enforcementAtFault = {
            ownerTrusted: backendHost.snapshot().ownerTrusted,
            apiSessionEstablished: backendHost.snapshot().apiSessionEstablished,
            apiSessionTokenAvailable: Boolean(backendHost.getApiSessionToken()),
            fd6DedicatedPipeActive: backendHost.snapshot().credentialCustody?.dedicatedPipeActive === true,
            applicationFence: vaultHost.applicationFenceSnapshot()
          };
          const error = new Error('injected containment lifecycle rename EIO');
          error.code = 'EIO';
          throw error;
        }
      },
      failStopApplication: () => {}
    });
    const authorityBefore = vaultHost.snapshotAuthorityBoundary();
    const lease = await vaultHost.acquireApplicationLease({ operationId: 'journal-probe', operationType: 'DESKTOP_MUTATION' });
    coordinator.activeLeaseToken = lease;
    coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
    coordinator.currentOperation = { operationId: 'journal-probe', operationType: 'DESKTOP_MUTATION', requestId: 'journal-probe', mutationCommitted: false };
    armed = true;
    const rejection = Object.assign(new Error('READY generation mismatch'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
    await coordinator._cleanupRejectedNewOwner(lease, rejection);
    await coordinator._releaseLease(lease);

    const fd6Prepare = await vaultHost.prepareCustodyTransaction({ requestId: 'probe-prepare', operation: 'persist', payload: { ref: 'probe/ref', mutationSha256: 'a'.repeat(64) } }).then(value => ({ accepted: true, value }), deniedResult);
    const fd6Commit = await vaultHost.commitCustodyTransaction({ requestId: 'probe-commit', operation: 'persist', payload: { ref: 'probe/ref', mutationSha256: 'b'.repeat(64) } }).then(value => ({ accepted: true, value }), deniedResult);
    const alreadyReady = await coordinator.startBackend().then(value => ({ accepted: true, value }), deniedResult);
    const contained = coordinator.snapshot();
    const backendContained = backendHost.snapshot();
    const authorityContained = vaultHost.snapshotMetadata();

    // Simulate the OS-confirmed eventual exit. Recovery is performed by a fresh
    // application process using only durable owner/sentinel discovery.
    live.value = false;
    child.exitCode = 0; child.__desktopHostExited = true;
    backendHost.ownerRegistry.markExited({ reasonCode: 'PROBE_EVENTUAL_EXIT', exitCode: 0 });

    const vault2 = new CredentialVault(paths.vault, { safeStorage: safeStorage() });
    const vaultHost2 = new CredentialVaultHost({ vault: vault2, metadataPath: paths.metadata });
    const backend2 = new BackendProcessHost({ ownerRecordPath: paths.owner, isProcessAlive: () => false, captureProcessIdentity: identity });
    const desktop2 = new DesktopHost({ backendProcessHost: backend2, credentialVaultHost: vaultHost2, releaseManifestHost: { snapshot: () => ({}), verify: () => ({}), backendStartupConfig: () => ({}) } });
    const coordinator2 = new DesktopCredentialApplicationCoordinator({
      desktopHost: desktop2,
      vaultHost: vaultHost2,
      startBackend: async () => ({ ok: true }),
      stopBackend: request => backend2.stop(request),
      backendSnapshot: () => backend2.snapshot(),
      getOwnedBackendChild: () => backend2.getOwnedChild(),
      isProcessAlive: () => false,
      journalPath: paths.journal,
      containmentSentinelPath: paths.sentinel,
      failStopApplication: () => {}
    });
    const beforeRecovery = coordinator2.snapshot();
    const eventualStop = await backend2.stop({ gracefulMs: 25, forceMs: 25 });
    const recovery = await coordinator2._recoverContainmentIfOwnerExited({ finalState: 'FAILED_SAFE' });
    const afterRecovery = coordinator2.snapshot();

    const failures = [];
    if (!injected) failures.push('rename-fault-not-injected');
    if (enforcementAtFault?.ownerTrusted !== false) failures.push('owner-still-trusted-at-journal-fault');
    if (enforcementAtFault?.apiSessionTokenAvailable !== false) failures.push('api-authority-still-available-at-journal-fault');
    if (enforcementAtFault?.fd6DedicatedPipeActive !== false) failures.push('fd6-still-active-at-journal-fault');
    if (!enforcementAtFault?.applicationFence) failures.push('application-fence-missing-at-journal-fault');
    if (fd6Prepare.accepted !== false || fd6Prepare.reasonCode !== APPLICATION_CONTAINMENT_ACTIVE) failures.push('fd6-prepare-not-contained');
    if (fd6Commit.accepted !== false || fd6Commit.reasonCode !== APPLICATION_CONTAINMENT_ACTIVE) failures.push('fd6-commit-not-contained');
    if (alreadyReady.accepted !== false) failures.push('already-ready-bypass-accepted');
    if (contained.state !== 'FATAL_OWNER_CONTAINMENT' || contained.failStopRequired !== true) failures.push('fatal-containment-not-entered');
    if (!contained.applicationFence) failures.push('fence-released-after-lease');
    if (backendContained.ownerTrusted !== false || backendContained.apiSessionEstablished !== false) failures.push('backend-authority-not-revoked');
    if (recovery?.recovered !== true || afterRecovery.containmentActive !== false || afterRecovery.applicationFence) failures.push('eventual-exit-recovery-failed');
    if (JSON.stringify(vaultHost2.snapshotAuthorityBoundary()) !== JSON.stringify(authorityBefore)) failures.push('authority-boundary-changed');

    const value = {
      schemaVersion: 1,
      probe: 'WP4_CONTAINMENT_JOURNAL_ENFORCEMENT_BEFORE_BOOKKEEPING',
      status: failures.length ? 'FAIL' : 'PASS',
      failures,
      rejectionReason: rejection.reasonCode,
      cleanupStopResult,
      journalFault: { phase: 'rename', code: 'EIO', injected },
      enforcementAtFault,
      childStillLive: contained.containment?.childStillLive === true,
      applicationFenceState: contained.applicationFence,
      fd6PrepareResult: fd6Prepare,
      fd6CommitResult: fd6Commit,
      apiAuthorityAvailable: backendContained.apiSessionEstablished === true,
      activeOwnerSession: authorityContained.activeOwnerSession || null,
      coordinatorFinalState: contained.state,
      failStopRequired: contained.failStopRequired === true,
      alreadyReadyResult: alreadyReady,
      relaunchBeforeRecovery: { state: beforeRecovery.state, containmentActive: beforeRecovery.containmentActive, applicationFence: beforeRecovery.applicationFence },
      eventualExitRecovery: { stopResult: eventualStop, result: recovery, state: afterRecovery.state, containmentActive: afterRecovery.containmentActive, applicationFence: afterRecovery.applicationFence },
      authorityBoundaryUnchanged: JSON.stringify(vaultHost2.snapshotAuthorityBoundary()) === JSON.stringify(authorityBefore),
      secretValueRecorded: false,
      secretHashRecorded: false
    };
    if (failures.length) {
      const error = new Error(`Containment journal order probe failed: ${failures.join(', ')}`);
      error.reasonCode = 'WP4_CONTAINMENT_JOURNAL_ORDER_PROBE_FAILED';
      error.probe = value;
      throw error;
    }
    return value;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { runContainmentJournalOrderProbe };
if (require.main === module) runContainmentJournalOrderProbe().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_CONTAINMENT_JOURNAL_ORDER_PROBE_FAILED'} ${error.stack || error.message}\n`); if (error.probe) process.stderr.write(`${JSON.stringify(error.probe, null, 2)}\n`); process.exit(1); });
