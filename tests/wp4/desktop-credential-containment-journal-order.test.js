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

function fixture(phase, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-journal-${phase}-`));
  const vault = new CredentialVault(path.join(root, 'credentials.safe.json'), { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'vault-meta.json') });
  const backendPid = 47123;
  const backendHost = new BackendProcessHost({
    ownerRecordPath: path.join(root, 'desktop-backend-owner.json'),
    isProcessAlive: pid => pid === backendPid,
    captureProcessIdentity: pid => ({ platform: 'test', startTicks: `start-${pid}`, commandDigest: `cmd-${pid}` })
  });
  const child = new EventEmitter();
  child.pid = backendPid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdio = [];
  backendHost.child = child;
  backendHost.state = 'RUNNING';
  backendHost.session = Object.freeze({
    backendPid,
    startupNonce: 'startup-journal-order',
    backendSessionId: 'session-journal-order',
    fd6PipeInstanceId: 'fd6-journal-order',
    apiSessionToken: 'api-token-must-be-revoked',
    ownerContext: {
      backendPid,
      startupNonce: 'startup-journal-order',
      backendSessionId: 'session-journal-order',
      fd6PipeInstanceId: 'fd6-journal-order',
      hydrationGeneration: vaultHost.snapshotMetadata().generation
    }
  });
  backendHost.credentialCustodyHost = {
    closeCalls: 0,
    close() { this.closeCalls += 1; },
    snapshot() { return { dedicatedPipeActive: true, ownerContext: backendHost.session.ownerContext }; }
  };
  backendHost.ownerRegistry.register({
    state: 'RUNNING', ownershipActive: true, trusted: true, backendPid,
    startupNonce: 'startup-journal-order', backendSessionId: 'session-journal-order', fd6PipeInstanceId: 'fd6-journal-order',
    ownerSession: backendHost.session.ownerContext,
    processIdentity: { platform: 'test', startTicks: `start-${backendPid}`, commandDigest: `cmd-${backendPid}` }
  });
  const desktopHost = new DesktopHost({
    backendProcessHost: backendHost,
    credentialVaultHost: vaultHost,
    releaseManifestHost: { snapshot: () => ({}), verify: () => ({}), backendStartupConfig: () => ({}) }
  });
  let ownerRecordPersistenceAt = null;
  const persistRejectedBackendOwner = desktopHost.persistRejectedBackendOwner.bind(desktopHost);
  desktopHost.persistRejectedBackendOwner = context => {
    ownerRecordPersistenceAt = {
      backend: backendHost.snapshot(),
      apiSessionToken: backendHost.getApiSessionToken(),
      applicationFence: vaultHost.applicationFenceSnapshot()
    };
    if (options.ownerRecordPersistenceThrows === true) {
      const error = new Error('injected owner record EIO');
      error.code = 'EIO';
      throw error;
    }
    return persistRejectedBackendOwner(context);
  };
  let armed = false;
  let injected = false;
  let enforcementAtFault = null;
  let stopCalls = 0;
  const coordinator = new DesktopCredentialApplicationCoordinator({
    desktopHost,
    vaultHost,
    startBackend: async () => ({ ok: true }),
    stopBackend: async () => {
      stopCalls += 1;
      if (options.stopSucceeds === true) {
        child.exitCode = 0;
        child.__desktopHostExited = true;
        backendHost.child = null;
        backendHost.session = null;
        backendHost.state = 'STOPPED';
        backendHost.ownerRegistry.markExited({ reasonCode: 'INJECTED_REAL_EXIT_CONFIRMED', exitCode: 0 });
        if (backendHost.rejectedOwner) backendHost.rejectedOwner = Object.freeze({ ...backendHost.rejectedOwner, childStillLive: false, exitedAtUtc: new Date().toISOString() });
        return { stopped: true, exitConfirmed: true, backendPid, exitCode: 0 };
      }
      return { stopped: false, exitConfirmed: false, reasonCode: 'INJECTED_REJECTED_OWNER_STOP_FAILURE' };
    },
    backendSnapshot: () => backendHost.snapshot(),
    getOwnedBackendChild: () => child,
    isProcessAlive: pid => pid === backendPid,
    journalPath: path.join(root, 'desktop-credential-application-lifecycle.json'),
    containmentSentinelPath: path.join(root, 'desktop-credential-application-containment.json'),
    persistenceFaultInjector(event) {
      if (armed && !injected && event.kind === 'lifecycle-journal' && event.phase === phase) {
        injected = true;
        enforcementAtFault = {
          backend: backendHost.snapshot(),
          apiSessionToken: backendHost.getApiSessionToken(),
          applicationFence: vaultHost.applicationFenceSnapshot()
        };
        options.onFault?.({ vaultHost, backendHost, child, enforcementAtFault });
        const error = new Error(`injected ${phase} EIO`);
        error.code = 'EIO';
        throw error;
      }
    }
  });
  return {
    root, vaultHost, backendHost, desktopHost, coordinator, child,
    arm() { armed = true; },
    stopCalls: () => stopCalls,
    injected: () => injected,
    enforcementAtFault: () => enforcementAtFault,
    ownerRecordPersistenceAt: () => ownerRecordPersistenceAt,
    close() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  };
}

for (const phase of ['mkdir', 'open', 'write', 'fsync', 'close', 'rename', 'directory-fsync']) {
  test(`rejected owner enforcement precedes containment lifecycle journal ${phase} failure`, async () => {
    const x = fixture(phase);
    try {
      const before = x.vaultHost.snapshotAuthorityBoundary();
      const lease = await x.vaultHost.acquireApplicationLease({ operationId: `journal-${phase}`, operationType: 'DESKTOP_MUTATION' });
      x.coordinator.activeLeaseToken = lease;
      x.coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
      x.coordinator.currentOperation = { operationId: `journal-${phase}`, operationType: 'DESKTOP_MUTATION', requestId: `request-${phase}`, mutationCommitted: false };
      x.arm();
      const rejection = Object.assign(new Error('READY generation mismatch'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
      await x.coordinator._cleanupRejectedNewOwner(lease, rejection);

      assert.equal(x.injected(), true);
      const atFault = x.enforcementAtFault();
      assert.equal(atFault.backend.ownerTrusted, false);
      assert.equal(atFault.backend.apiSessionEstablished, false);
      assert.equal(atFault.apiSessionToken, '');
      assert.equal(atFault.backend.credentialCustody, null);
      assert.ok(atFault.applicationFence);
      assert.equal(x.stopCalls(), 1);
      const backend = x.backendHost.snapshot();
      const snapshot = x.coordinator.snapshot();
      assert.equal(backend.ownerTrusted, false);
      assert.equal(backend.apiSessionEstablished, false);
      assert.equal(x.backendHost.getApiSessionToken(), '');
      assert.equal(backend.credentialCustody, null);
      assert.ok(x.vaultHost.applicationFenceSnapshot());
      assert.equal(snapshot.containment.enforcementEstablished, true);
      assert.equal(snapshot.containment.enforcementFacts.backendOwnerRevoked, true);
      assert.equal(snapshot.containment.enforcementFacts.apiAuthorityRevoked, true);
      assert.equal(snapshot.containment.enforcementFacts.fd6Closed, true);
      assert.equal(snapshot.containment.enforcementFacts.applicationFenceInstalled, true);
      assert.equal(snapshot.state, 'FATAL_OWNER_CONTAINMENT');
      assert.equal(snapshot.failStopRequired, true);

      await x.coordinator._releaseLease(lease);
      assert.equal(x.vaultHost.applicationLeaseSnapshot(), null);
      assert.ok(x.vaultHost.applicationFenceSnapshot());
      await assert.rejects(
        Promise.resolve().then(() => x.vaultHost.prepareCustodyTransaction({ requestId: `fd6-${phase}`, operation: 'persist', ref: `journal/${phase}` })),
        error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE
      );
      await assert.rejects(
        Promise.resolve().then(() => x.vaultHost.executeDesktopMutation('persist', `journal/${phase}`, { token: 'never' }, { requestId: `ui-${phase}` })),
        error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE
      );
      assert.deepEqual(x.vaultHost.snapshotAuthorityBoundary(), before);
    } finally { x.close(); }
  });
}


test('journal durability failure remains fatal even when rejected child exits during cleanup', async () => {
  const x = fixture('rename', { stopSucceeds: true });
  try {
    const lease = await x.vaultHost.acquireApplicationLease({ operationId: 'journal-successful-stop', operationType: 'DESKTOP_MUTATION' });
    x.coordinator.activeLeaseToken = lease;
    x.coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
    x.coordinator.currentOperation = { operationId: 'journal-successful-stop', operationType: 'DESKTOP_MUTATION', requestId: 'journal-successful-stop', mutationCommitted: true };
    x.arm();
    const rejection = Object.assign(new Error('READY generation mismatch'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
    await x.coordinator._cleanupRejectedNewOwner(lease, rejection);
    const snapshot = x.coordinator.snapshot();
    assert.equal(x.injected(), true);
    assert.equal(x.stopCalls(), 1);
    assert.equal(snapshot.state, 'FATAL_OWNER_CONTAINMENT');
    assert.equal(snapshot.failStopRequired, true);
    assert.equal(snapshot.containmentActive, true);
    assert.ok(snapshot.applicationFence);
    assert.equal(snapshot.containment.enforcementFacts.containmentJournalDurable, false);
    await x.coordinator._releaseLease(lease);
    assert.ok(x.vaultHost.applicationFenceSnapshot());
  } finally { x.close(); }
});


test('journal rename failure concurrently denies FD6 PREPARE, FD6 COMMIT and API authority', async () => {
  const concurrent = {};
  const x = fixture('rename', {
    onFault({ vaultHost, backendHost }) {
      concurrent.prepare = vaultHost.prepareCustodyTransaction({
        requestId: 'concurrent-prepare',
        operation: 'persist',
        payload: { ref: 'journal/concurrent-prepare', mutationSha256: 'a'.repeat(64) }
      });
      // The containment cleanup now observes a bounded concurrent-exit grace
      // period. Attach rejection observers immediately so a correctly fenced
      // FD6 denial cannot be reported by Node as an unhandled rejection before
      // the assertions below inspect the original promises.
      concurrent.prepare.catch(() => {});
      concurrent.commit = vaultHost.commitCustodyTransaction({
        requestId: 'concurrent-commit',
        operation: 'persist',
        payload: { ref: 'journal/concurrent-commit', mutationSha256: 'b'.repeat(64) }
      });
      concurrent.commit.catch(() => {});
      concurrent.apiSessionToken = backendHost.getApiSessionToken();
      concurrent.backendAtRequest = backendHost.snapshot();
      concurrent.fenceAtRequest = vaultHost.applicationFenceSnapshot();
    }
  });
  try {
    const before = x.vaultHost.snapshotAuthorityBoundary();
    const lease = await x.vaultHost.acquireApplicationLease({ operationId: 'journal-concurrent-fd6', operationType: 'DESKTOP_MUTATION' });
    x.coordinator.activeLeaseToken = lease;
    x.coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
    x.coordinator.currentOperation = { operationId: 'journal-concurrent-fd6', operationType: 'DESKTOP_MUTATION', requestId: 'journal-concurrent-fd6', mutationCommitted: false };
    x.arm();
    const rejection = Object.assign(new Error('runtime projection mismatch'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_RUNTIME_PROJECTION_MISMATCH' });
    await x.coordinator._cleanupRejectedNewOwner(lease, rejection);

    assert.equal(concurrent.apiSessionToken, '');
    assert.equal(concurrent.backendAtRequest.ownerTrusted, false);
    assert.equal(concurrent.backendAtRequest.apiSessionEstablished, false);
    assert.equal(concurrent.backendAtRequest.credentialCustody, null);
    assert.ok(concurrent.fenceAtRequest);
    await assert.rejects(concurrent.prepare, error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
    await assert.rejects(concurrent.commit, error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
    await x.coordinator._releaseLease(lease);
    assert.ok(x.vaultHost.applicationFenceSnapshot());
    assert.deepEqual(x.vaultHost.snapshotAuthorityBoundary(), before);
  } finally { x.close(); }
});

test('journal rename failure concurrent application shutdown cannot reopen credential authority', async () => {
  const x = fixture('rename');
  try {
    const before = x.vaultHost.snapshotAuthorityBoundary();
    const lease = await x.vaultHost.acquireApplicationLease({ operationId: 'journal-concurrent-shutdown', operationType: 'DESKTOP_MUTATION' });
    x.coordinator.activeLeaseToken = lease;
    x.coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
    x.coordinator.currentOperation = { operationId: 'journal-concurrent-shutdown', operationType: 'DESKTOP_MUTATION', requestId: 'journal-concurrent-shutdown', mutationCommitted: false };
    x.arm();
    const rejection = Object.assign(new Error('READY digest mismatch'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
    await x.coordinator._cleanupRejectedNewOwner(lease, rejection);

    const shutdown = await x.coordinator.stopBackend({ forShutdown: true }).catch(error => ({ error }));
    assert.ok(shutdown.error || shutdown.containmentActive === true || shutdown.stopped === false);
    assert.equal(x.coordinator.snapshot().containmentActive, true);
    assert.equal(x.coordinator.snapshot().failStopRequired, true);
    assert.ok(x.vaultHost.applicationFenceSnapshot());
    assert.equal(x.backendHost.snapshot().ownerTrusted, false);
    assert.equal(x.backendHost.getApiSessionToken(), '');
    await x.coordinator._releaseLease(lease);
    assert.ok(x.vaultHost.applicationFenceSnapshot());
    await assert.rejects(
      Promise.resolve().then(() => x.vaultHost.executeDesktopMutation('persist', 'journal/shutdown', { token: 'never' }, { requestId: 'journal-shutdown-ui' })),
      error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE
    );
    assert.deepEqual(x.vaultHost.snapshotAuthorityBoundary(), before);
  } finally { x.close(); }
});


test('fallible owner registry persistence starts only after API revocation, FD6 closure and application fence installation', async () => {
  const x = fixture('unused', { ownerRecordPersistenceThrows: true });
  try {
    const before = x.vaultHost.snapshotAuthorityBoundary();
    const lease = await x.vaultHost.acquireApplicationLease({ operationId: 'owner-record-order', operationType: 'DESKTOP_MUTATION' });
    x.coordinator.activeLeaseToken = lease;
    x.coordinator.lifecycle.state = 'NEW_OWNER_HYDRATING';
    x.coordinator.currentOperation = { operationId: 'owner-record-order', operationType: 'DESKTOP_MUTATION', requestId: 'owner-record-order', mutationCommitted: false };
    const rejection = Object.assign(new Error('READY rejected before owner record write'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH' });
    await x.coordinator._cleanupRejectedNewOwner(lease, rejection);

    const atPersist = x.ownerRecordPersistenceAt();
    assert.ok(atPersist);
    assert.equal(atPersist.backend.ownerTrusted, false);
    assert.equal(atPersist.backend.apiSessionEstablished, false);
    assert.equal(atPersist.apiSessionToken, '');
    assert.equal(atPersist.backend.credentialCustody, null);
    assert.ok(atPersist.applicationFence);
    assert.equal(x.coordinator.snapshot().state, 'FATAL_OWNER_CONTAINMENT');
    assert.ok(x.vaultHost.applicationFenceSnapshot());
    await x.coordinator._releaseLease(lease);
    assert.ok(x.vaultHost.applicationFenceSnapshot());
    assert.deepEqual(x.vaultHost.snapshotAuthorityBoundary(), before);
  } finally { x.close(); }
});
