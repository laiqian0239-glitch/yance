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
const {
  APPLICATION_CONTAINMENT_ACTIVE,
  DesktopCredentialApplicationCoordinator,
  JOURNAL_SCHEMA_VERSION
} = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}

function hostFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-rejected-owner-'));
  const vault = new CredentialVault(path.join(root, 'credentials.safe.json'), { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'vault-meta.json') });
  return { root, vaultHost, close: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) };
}

function fatalJournal(pid) {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    lifecycle: {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      state: 'FATAL_OWNER_CONTAINMENT',
      reasonCode: 'INJECTED_REJECTED_OWNER_STOP_FAILURE',
      operationId: 'op-contained',
      operationType: 'DESKTOP_MUTATION',
      requestId: 'request-contained',
      mutationCommitted: true,
      updatedAtUtc: new Date().toISOString(),
      stateHistory: []
    },
    containment: {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      containmentId: 'containment-test',
      active: true,
      state: 'FATAL_OWNER_CONTAINMENT',
      rejectionReasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH',
      cleanupReasonCode: 'INJECTED_REJECTED_OWNER_STOP_FAILURE',
      backendPid: pid,
      childStillLive: true,
      engagedAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString()
    }
  };
}

function coordinatorFixture(fixture, options = {}) {
  let backend = options.backend || {
    state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
    startupPending: false, shutdownPending: false, credentialCustody: null,
    ownerTrusted: true, rejectedOwner: null
  };
  const desktopHost = {
    credentialVaultHost: fixture.vaultHost,
    setCredentialApplicationCoordinator(value) { this.coordinator = value; fixture.vaultHost.requireApplicationCoordinator(Boolean(value)); },
    snapshot() { return { backend, credentialVault: fixture.vaultHost.snapshotMetadata() }; },
    containRejectedBackendOwner(context) {
      backend = {
        ...backend,
        ownerTrusted: false,
        rejectedOwner: {
          backendPid: Number(context.backendPid || backend.backendPid || 0),
          childStillLive: options.isProcessAlive?.(Number(context.backendPid || backend.backendPid || 0)) !== false,
          reasonCode: context.reasonCode
        },
        credentialCustody: null
      };
      return backend.rejectedOwner;
    },
    clearRejectedBackendOwner() { backend = { ...backend, ownerTrusted: true, rejectedOwner: null }; return true; },
    isRejectedBackendOwnerLive() {
      const pid = Number(backend.rejectedOwner?.backendPid || 0);
      return Boolean(backend.rejectedOwner?.childStillLive && options.isProcessAlive?.(pid) !== false);
    },
    waitForBackendOwnerExitRecovery: async () => ({ recovered: true })
  };
  const coordinator = new DesktopCredentialApplicationCoordinator({
    desktopHost,
    vaultHost: fixture.vaultHost,
    startBackend: async () => ({ ok: true }),
    stopBackend: options.stopBackend || (async () => ({ stopped: false, exitConfirmed: false, reasonCode: 'INJECTED_STOP_FAILURE' })),
    backendSnapshot: () => backend,
    getOwnedBackendChild: () => options.child || null,
    waitForOwnerExitRecovery: async () => ({ recovered: true }),
    validateRuntimeProjection: async () => ({}),
    isProcessAlive: options.isProcessAlive || (() => false),
    journalPath: options.journalPath || path.join(fixture.root, 'desktop-credential-application-lifecycle.json'),
    automaticStartupContainmentRecovery: options.automaticStartupContainmentRecovery === true
  });
  return { coordinator, desktopHost, backend: () => backend, setBackend: value => { backend = value; } };
}

test('persistent application fence survives short lease release and denies FD6 plus desktop mutation', async () => {
  const fixture = hostFixture();
  try {
    fixture.vaultHost.setApplicationFence({ containmentId: 'fence-1', backendPid: 9231, fatal: true });
    const lease = await fixture.vaultHost.acquireApplicationLease({ operationId: 'contained', operationType: 'APPLICATION_SHUTDOWN' });
    await fixture.vaultHost.releaseApplicationLease(lease);
    assert.ok(fixture.vaultHost.applicationFenceSnapshot());
    const contained = error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE && error.fatal === true;
    await assert.rejects(Promise.resolve().then(() => fixture.vaultHost.executeDesktopMutation('persist', 'contained/ui', { token: 'never' }, { requestId: 'contained-ui' })), contained);
    await assert.rejects(Promise.resolve().then(() => fixture.vaultHost.prepareCustodyTransaction({ requestId: 'contained-fd6', operation: 'persist', ref: 'contained/fd6' })), contained);
    assert.equal(fixture.vaultHost.refs().length, 0);
  } finally { fixture.close(); }
});

test('persisted FATAL_OWNER_CONTAINMENT restores application fence and blocks start', async () => {
  const fixture = hostFixture();
  try {
    const journalPath = path.join(fixture.root, 'desktop-credential-application-lifecycle.json');
    fs.writeFileSync(journalPath, `${JSON.stringify(fatalJournal(9123), null, 2)}\n`);
    const x = coordinatorFixture(fixture, { journalPath, isProcessAlive: pid => pid === 9123 });
    const snapshot = x.coordinator.snapshot();
    assert.equal(snapshot.state, 'FATAL_OWNER_CONTAINMENT');
    assert.equal(snapshot.containmentActive, true);
    assert.equal(snapshot.applicationFence.backendPid, 9123);
    await assert.rejects(x.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
    assert.equal(x.coordinator.snapshot().state, 'FATAL_OWNER_CONTAINMENT');
  } finally { fixture.close(); }
});

test('FAILED_SAFE cannot reset to IDLE while backend ownership or FD6 remains', async () => {
  const fixture = hostFixture();
  try {
    const backend = {
      state: 'STOPPING', running: false, backendPid: 8123, ownershipPresent: true,
      startupPending: false, shutdownPending: true, ownerTrusted: true, rejectedOwner: null,
      credentialCustody: { dedicatedPipeActive: true }
    };
    const x = coordinatorFixture(fixture, { backend, isProcessAlive: pid => pid === 8123 });
    x.coordinator.lifecycle.state = 'FAILED_SAFE';
    x.coordinator.lifecycle.reasonCode = 'INJECTED_STOP_FAILURE';
    x.coordinator._persist();
    await assert.rejects(x.coordinator.startBackend(), error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED');
    assert.equal(x.coordinator.snapshot().state, 'FAILED_SAFE');
    assert.equal(x.coordinator.snapshot().failedSafeResetBoundary.safe, false);
  } finally { fixture.close(); }
});

test('persisted rejected PID remains fenced across coordinator restart until liveness is false', async () => {
  const fixture = hostFixture();
  try {
    let live = true;
    const journalPath = path.join(fixture.root, 'desktop-credential-application-lifecycle.json');
    fs.writeFileSync(journalPath, `${JSON.stringify(fatalJournal(7123), null, 2)}\n`);
    const first = coordinatorFixture(fixture, { journalPath, isProcessAlive: pid => pid === 7123 && live });
    await assert.rejects(first.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
    assert.ok(fixture.vaultHost.applicationFenceSnapshot());
    live = false;
    first.setBackend({ state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false, startupPending: false, shutdownPending: false, credentialCustody: null, ownerTrusted: false, rejectedOwner: { backendPid: 7123, childStillLive: false } });
    const recovery = await first.coordinator._recoverContainmentIfOwnerExited({ finalState: 'FAILED_SAFE' });
    assert.equal(recovery.recovered, true);
    assert.equal(first.coordinator.snapshot().containmentActive, false);
    assert.equal(fixture.vaultHost.applicationFenceSnapshot(), null);
  } finally { fixture.close(); }
});

test('bootstrap containment recovery clears a dead persisted owner before credential migration begins', async () => {
  const fixture = hostFixture();
  try {
    const journalPath = path.join(fixture.root, 'desktop-credential-application-lifecycle.json');
    fs.writeFileSync(journalPath, `${JSON.stringify(fatalJournal(7124), null, 2)}\n`);
    const x = coordinatorFixture(fixture, {
      journalPath,
      automaticStartupContainmentRecovery: true,
      isProcessAlive: () => false
    });
    x.setBackend({
      state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
      startupPending: false, shutdownPending: false, credentialCustody: null,
      ownerTrusted: false, rejectedOwner: { backendPid: 7124, childStillLive: false, pidIdentityMatch: true }
    });

    const recovery = await x.coordinator.recoverStartupContainment({ reason: 'test-bootstrap-recovery' });
    assert.equal(recovery.ok, true);
    assert.equal(recovery.recovered, true);
    assert.equal(x.coordinator.snapshot().containmentActive, false);
    assert.equal(fixture.vaultHost.applicationFenceSnapshot(), null);

    const migration = await x.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true }));
    assert.equal(migration.migrated, true);
    assert.equal(x.coordinator.snapshot().state, 'IDLE');
  } finally { fixture.close(); }
});

test('BackendProcessHost keeps restored rejected PID untrusted until process liveness ends', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-owner-rejection-'));
  try {
    let live = true;
    const processIdentity = { platform: 'test', startTicks: '6123', commandDigest: 'owner-command' };
    const host = new BackendProcessHost({
      ownerRecordPath: path.join(root, 'backend-owner.json'),
      isProcessAlive: pid => pid === 6123 && live,
      captureProcessIdentity: pid => pid === 6123 ? processIdentity : null
    });
    const child = new EventEmitter();
    child.pid = 6123;
    child.exitCode = null;
    child.signalCode = null;
    child.stdio = [];
    host.child = child;
    host.session = { backendPid: 6123, apiSessionToken: 'secret', startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f' };
    host.state = 'RUNNING';
    host.ownerRegistry.register({
      state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: 6123,
      startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'f',
      processIdentity, reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED'
    });
    const contained = host.containRejectedOwner({ reasonCode: 'READY_REJECTED' });
    assert.equal(contained.childStillLive, true);
    assert.equal(host.getApiSessionToken(), '');
    assert.equal(host.snapshot().ownerTrusted, false);
    assert.throws(() => host.clearRejectedOwner(), error => error.reasonCode === 'WP4_DESKTOP_REJECTED_OWNER_STILL_LIVE');
    live = false;
    child.exitCode = 1;
    child.__desktopHostExited = true;
    assert.equal(host.clearRejectedOwner(), true);
    // Clearing a rejected marker after process exit should remove containment,
    // but it must not promote a recovered/terminal owner back to trusted.
    assert.equal(host.snapshot().ownerTrusted, false);
    assert.equal(host.snapshot().rejectedOwner, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('termination-pending journal without containment payload restores the last persisted rejected PID', async () => {
  const fixture = hostFixture();
  try {
    const journalPath = path.join(fixture.root, 'desktop-credential-application-lifecycle.json');
    const value = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      lifecycle: {
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        state: 'REJECTED_OWNER_TERMINATION_PENDING',
        reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH',
        operationId: 'op-pending-containment',
        operationType: 'DESKTOP_MUTATION',
        requestId: 'request-pending-containment',
        mutationCommitted: true,
        updatedAtUtc: new Date().toISOString(),
        stateHistory: [{
          state: 'REJECTED_OWNER_TERMINATION_PENDING',
          atUtc: new Date().toISOString(),
          reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH',
          backendPid: 5123
        }]
      }
    };
    fs.writeFileSync(journalPath, `${JSON.stringify(value, null, 2)}\n`);
    const x = coordinatorFixture(fixture, { journalPath, isProcessAlive: pid => pid === 5123 });
    const snapshot = x.coordinator.snapshot();
    assert.equal(snapshot.state, 'REJECTED_OWNER_TERMINATION_PENDING');
    assert.equal(snapshot.containment.backendPid, 5123);
    assert.equal(snapshot.rejectedOwnerLive, true);
    assert.equal(snapshot.applicationFence.backendPid, 5123);
    await assert.rejects(x.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
  } finally { fixture.close(); }
});

test('fence and rejected marker cannot clear before real child exit and owner recovery', async () => {
  const fixture = hostFixture();
  try {
    const journalPath = path.join(fixture.root, 'desktop-credential-application-lifecycle.json');
    fs.writeFileSync(journalPath, `${JSON.stringify(fatalJournal(4123), null, 2)}\n`);
    const x = coordinatorFixture(fixture, { journalPath, isProcessAlive: pid => pid === 4123 });
    assert.ok(fixture.vaultHost.applicationFenceSnapshot());
    await assert.rejects(x.coordinator._resolveRejectedOwnerContainment(null, { finalState: 'FAILED_SAFE' }), error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RELEASE_BLOCKED');
    assert.ok(fixture.vaultHost.applicationFenceSnapshot());
    assert.equal(x.coordinator.snapshot().containmentActive, true);
    assert.equal(x.backend().ownerTrusted, false);
    assert.ok(x.backend().rejectedOwner);
  } finally { fixture.close(); }
});

test('production enforcement objects activate containment even when lifecycle state is not a containment state', async () => {
  const fixture = hostFixture();
  try {
    const backend = {
      state: 'STOPPING', running: false, backendPid: 7441, ownershipPresent: true,
      startupPending: false, shutdownPending: false, credentialCustody: null,
      ownerTrusted: false, rejectedOwner: { backendPid: 7441, childStillLive: true, reasonCode: 'READY_REJECTED' }
    };
    const x = coordinatorFixture(fixture, { backend, isProcessAlive: pid => pid === 7441 });
    fixture.vaultHost.setApplicationFence({ containmentId: 'facts-not-state', backendPid: 7441, fatal: true });
    x.coordinator.lifecycle.state = 'IDLE';
    x.coordinator.lifecycle.reasonCode = '';
    x.coordinator.containment = null;
    x.coordinator.containmentSentinel = null;
    x.coordinator.failStopRequired = false;

    assert.equal(x.coordinator.isRejectedOwnerContainmentActive(), true);
    await assert.rejects(x.coordinator.startBackend(), error => error.reasonCode === APPLICATION_CONTAINMENT_ACTIVE);
    assert.ok(fixture.vaultHost.applicationFenceSnapshot());
    assert.equal(x.backend().ownerTrusted, false);
  } finally { fixture.close(); }
});

test('Windows FD6-close race resolves containment when rejected owner exits after stop reports failure', async () => {
  const fixture = hostFixture();
  try {
    const child = new EventEmitter();
    child.pid = 8129;
    child.exitCode = 0;
    child.signalCode = 'SIGTERM';
    child.__desktopHostExited = true;

    const runningBackend = {
      state: 'RUNNING', running: true, backendPid: 8129, ownershipPresent: true,
      startupPending: false, shutdownPending: false,
      credentialCustody: { dedicatedPipeActive: true },
      ownerTrusted: true, rejectedOwner: null,
      startupNonce: 'race-startup', backendSessionId: 'race-session', fd6PipeInstanceId: 'race-fd6'
    };
    const x = coordinatorFixture(fixture, {
      backend: runningBackend,
      child,
      isProcessAlive: () => false
    });

    const cause = Object.assign(new Error('new owner projection rejected'), {
      reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_READY_MISMATCH',
      mutationCommitted: true
    });
    x.coordinator._establishRejectedOwnerEnforcement(cause);
    x.setBackend({
      state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
      startupPending: false, shutdownPending: false, credentialCustody: null,
      ownerTrusted: false, rejectedOwner: { backendPid: 8129, childStillLive: false, pidIdentityMatch: true }
    });

    const resolved = await x.coordinator._resolveRejectedOwnerAfterConcurrentExit(
      child,
      cause,
      { stopped: false, exitConfirmed: false, reasonCode: 'INJECTED_STOP_FAILURE' },
      { concurrentExitGraceMs: 0 }
    );

    assert.equal(resolved.recoveredAfterConcurrentExit, true);
    assert.equal(resolved.ownerReleased, true);
    assert.equal(resolved.applicationFenceActive, false);
    assert.equal(x.coordinator.snapshot().containmentActive, false);
    assert.equal(fixture.vaultHost.applicationFenceSnapshot(), null);
  } finally { fixture.close(); }
});
