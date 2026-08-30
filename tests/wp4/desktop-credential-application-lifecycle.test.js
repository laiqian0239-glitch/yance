'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const {
  APPLICATION_BUSY,
  DesktopCredentialApplicationCoordinator
} = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}

function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function createHarness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-desktop-app-life-'));
  const vault = new CredentialVault(path.join(root, 'credentials.safe.json'), { safeStorage: safeStorage() });
  const events = [];
  const vaultHost = new CredentialVaultHost({
    vault,
    crashInjector: typeof options.vaultCrashInjector === 'function' ? options.vaultCrashInjector : (() => {}),
    beforeTransactionCommit: detail => { events.push(`commit:${detail.requestId}`); }
  });
  let pid = 5100;
  let backend = {
    state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
    startupPending: false, shutdownPending: false, credentialCustody: null
  };
  let failStop = false;
  let failNextStart = false;
  let stopBarrier = null;
  let coordinator = null;

  const desktopHost = {
    credentialVaultHost: vaultHost,
    setCredentialApplicationCoordinator(value) { coordinator = value; },
    snapshot() { return { backend, credentialVault: vaultHost.snapshotMetadata() }; },
    waitForBackendOwnerExitRecovery() { return Promise.resolve({ recovered: true }); }
  };

  async function startBackend(options = {}) {
    events.push('start');
    if (failNextStart) {
      failNextStart = false;
      const error = new Error('injected start failure');
      error.reasonCode = 'INJECTED_BACKEND_START_FAILURE';
      throw error;
    }
    pid += 1;
    const startupNonce = crypto.randomUUID();
    const backendSessionId = crypto.randomUUID();
    const fd6PipeInstanceId = crypto.randomUUID();
    const prepared = await vaultHost.createHydrationFrame({
      applicationLeaseToken: options.applicationLeaseToken,
      startupNonce,
      oneTimeToken: 'x'.repeat(43),
      backendPid: pid,
      manifestSha256: sha('manifest'),
      backendSessionId,
      fd6PipeInstanceId
    });
    vaultHost.establishCustodyOwner(prepared.ownerSession);
    const frame = prepared.frame;
    const accepted = await vaultHost.markHydrationAccepted({
      startupNonce,
      authorityEventId: frame.authorityEventId,
      vaultEpoch: frame.vaultEpoch,
      generation: frame.generation,
      vaultReferenceCount: frame.vaultReferenceCount,
      decryptedEntryCount: frame.decryptedEntryCount,
      frameEntryCount: frame.frameEntryCount,
      restoredReferenceCount: frame.frameEntryCount,
      payloadBytes: frame.payloadBytes
    });
    assert.equal(accepted, true);
    backend = {
      state: 'RUNNING',
      running: true,
      backendPid: pid,
      ownershipPresent: true,
      startupPending: false,
      shutdownPending: false,
      credentialHydrated: true,
      credentialVaultEpoch: frame.vaultEpoch,
      credentialGeneration: frame.generation,
      credentialAuthorityEventId: frame.authorityEventId,
      credentialAuthorityHeadDigest: frame.authorityHeadDigest,
      credentialVaultReferenceCount: frame.vaultReferenceCount,
      credentialDecryptedEntryCount: frame.decryptedEntryCount,
      credentialFrameEntryCount: frame.frameEntryCount,
      startupNonce,
      backendSessionId,
      fd6PipeInstanceId,
      ownerContext: prepared.ownerSession,
      readyCredentialMetadata: {
        vaultEpoch: frame.vaultEpoch,
        generation: frame.generation,
        authorityEventId: frame.authorityEventId,
        authorityHeadDigest: frame.authorityHeadDigest,
        vaultReferenceCount: frame.vaultReferenceCount,
        decryptedEntryCount: frame.decryptedEntryCount,
        frameEntryCount: frame.frameEntryCount,
        entryCount: frame.frameEntryCount,
        restoredReferenceCount: frame.frameEntryCount
      },
      credentialCustody: { dedicatedPipeActive: true, ownerContext: prepared.ownerSession }
    };
    return { ok: true, pid, source: 'fake-ready' };
  }

  async function stopBackend() {
    events.push('stop');
    if (stopBarrier) await stopBarrier;
    if (failStop) return { stopped: false, exitConfirmed: false, reasonCode: 'INJECTED_STOP_FAILURE', backendPid: backend.backendPid };
    const old = backend;
    if (old.ownerContext) await vaultHost.handleBackendOwnerExit(old.ownerContext);
    backend = {
      state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
      startupPending: false, shutdownPending: false, credentialCustody: null
    };
    return { stopped: true, exitConfirmed: true, backendPid: old.backendPid, forced: false };
  }

  const defaultRuntimeProjection = async () => {
    const authority = vaultHost.snapshotMetadata();
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
  };

  coordinator = new DesktopCredentialApplicationCoordinator({
    desktopHost,
    vaultHost,
    startBackend,
    stopBackend,
    backendSnapshot: () => backend,
    validateRuntimeProjection: typeof options.validateRuntimeProjection === 'function' ? options.validateRuntimeProjection : defaultRuntimeProjection,
    journalPath: path.join(root, 'desktop-credential-application-lifecycle.json')
  });

  if (options.preloadLifecycle) {
    fs.writeFileSync(path.join(root, 'desktop-credential-application-lifecycle.json'), JSON.stringify({
      schemaVersion: 3,
      lifecycle: options.preloadLifecycle
    }, null, 2), 'utf8');
  }

  return {
    root, vault, vaultHost, events, coordinator,
    backend: () => backend,
    setFailStop(value) { failStop = value; },
    setFailNextStart(value) { failNextStart = value; },
    setStopBarrier(value) { stopBarrier = value; },
    async simulateUnexpectedBackendExit() {
      const exited = backend;
      if (exited.ownerContext) await vaultHost.handleBackendOwnerExit(exited.ownerContext);
      backend = {
        state: 'STOPPED', running: false, backendPid: 0, ownershipPresent: false,
        startupPending: false, shutdownPending: false, credentialCustody: null
      };
      return { child: { pid: exited.backendPid }, exited };
    },
    close() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  };
}

test('fresh no-backend legacy credential migration initializes authority before owner-free recovery assertion', async () => {
  const harness = createHarness();
  try {
    assert.equal(harness.vaultHost.snapshotMetadata().available, false);
    let workCalls = 0;
    const result = await harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async applicationLeaseToken => {
      workCalls += 1;
      const authority = harness.vaultHost.snapshotMetadata();
      assert.equal(authority.lifecycle?.state, 'ACTIVE');
      assert.equal(authority.available, true);
      assert.ok(applicationLeaseToken);
      return { migrated: true };
    });
    assert.equal(result.migrated, true);
    assert.equal(workCalls, 1);
    assert.equal(harness.coordinator.snapshot().state, 'IDLE');
    assert.equal(harness.vaultHost.snapshotMetadata().applicationLease, null);
  } finally { harness.close(); }
});

test('no-backend legacy credential migration recovers a stale active owner before strict owner-free assertion', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    const staleOwner = harness.vaultHost.snapshotMetadata().activeOwnerSession;
    assert.ok(staleOwner, 'first backend launch must leave an active owner session to recover');

    Object.assign(harness.backend(), {
      state: 'STOPPED',
      running: false,
      backendPid: 0,
      ownershipPresent: false,
      startupPending: false,
      shutdownPending: false,
      credentialCustody: null
    });
    const before = harness.vaultHost.snapshotMetadata();
    assert.deepEqual(before.activeOwnerSession, staleOwner);
    assert.equal(harness.backend().state, 'STOPPED');
    assert.equal(harness.backend().ownershipPresent, false);
    assert.equal(harness.backend().backendPid, 0);

    harness.events.length = 0;
    let workCalls = 0;
    const result = await harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async applicationLeaseToken => {
      workCalls += 1;
      const authority = harness.vaultHost.snapshotMetadata();
      assert.equal(authority.activeOwnerSession, null);
      assert.equal(authority.pendingOwnerSession, null);
      assert.equal(authority.lifecycle?.state, 'ACTIVE');
      assert.equal(authority.available, true);
      assert.ok(applicationLeaseToken);
      return { migrated: true };
    });

    assert.equal(result.migrated, true);
    assert.equal(workCalls, 1);
    assert.deepEqual(harness.events, [], 'already-stopped backend must not be respawned or stopped to recover its stale owner');
    assert.equal(harness.coordinator.snapshot().state, 'IDLE');
    assert.equal(harness.vaultHost.snapshotMetadata().applicationLease, null);
  } finally { harness.close(); }
});

test('desktop save is stop -> real owner recovery -> one commit -> FD5/READY before UI success', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    const generationBefore = harness.vaultHost.snapshotMetadata().generation;
    harness.events.length = 0;
    const result = await harness.coordinator.applyVaultMutationWithRestart('persist', 'model:test', { token: 'redacted-value' }, { requestId: 'desktop-request-1' });
    assert.equal(result.ok, true);
    assert.equal(result.appliedBy, 'DESKTOP_CREDENTIAL_APPLICATION_COORDINATOR');
    assert.deepEqual(harness.events, ['stop', 'commit:desktop-request-1', 'start']);
    assert.equal(harness.vaultHost.get('model:test').token, 'redacted-value');
    assert.equal(harness.vaultHost.snapshotMetadata().generation, generationBefore + 2);
    assert.equal(harness.backend().credentialGeneration, harness.vaultHost.snapshotMetadata().generation);
    assert.equal(harness.coordinator.snapshot().state, 'IDLE');
    assert.equal(harness.vaultHost.snapshotMetadata().applicationLease, null);
    assert.doesNotMatch(fs.readFileSync(path.join(harness.root, 'desktop-credential-application-lifecycle.json'), 'utf8'), /redacted-value/);
  } finally { harness.close(); }
});

test('stop failure leaves vault bytes, authority digest, generation and transaction count unchanged', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    const before = harness.vaultHost.snapshotAuthorityBoundary();
    harness.events.length = 0;
    harness.setFailStop(true);
    await assert.rejects(
      harness.coordinator.applyVaultMutationWithRestart('persist', 'model:blocked', { token: 'never-written' }, { requestId: 'desktop-stop-failure' }),
      error => error.reasonCode === 'INJECTED_STOP_FAILURE'
    );
    assert.deepEqual(harness.vaultHost.snapshotAuthorityBoundary(), before);
    assert.equal(harness.vaultHost.refs().includes('model:blocked'), false);
    assert.deepEqual(harness.events, ['stop']);
    assert.equal(harness.coordinator.snapshot().state, 'FAILED_SAFE');
  } finally { harness.close(); }
});

test('restart failure after COMMITTED mutation is fail-safe and same requestId resumes without a second commit', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    harness.events.length = 0;
    harness.setFailNextStart(true);
    await assert.rejects(
      harness.coordinator.applyVaultMutationWithRestart('persist', 'model:resume', { token: 'durable' }, { requestId: 'desktop-resume-1' }),
      error => error.reasonCode === 'INJECTED_BACKEND_START_FAILURE' && error.mutationCommitted === true
    );
    const committedBoundary = harness.vaultHost.snapshotAuthorityBoundary();
    assert.equal(harness.vaultHost.get('model:resume').token, 'durable');
    assert.deepEqual(harness.events, ['stop', 'commit:desktop-resume-1', 'start']);
    assert.equal(harness.backend().running, false);

    harness.events.length = 0;
    const resumed = await harness.coordinator.applyVaultMutationWithRestart('persist', 'model:resume', { token: 'durable' }, { requestId: 'desktop-resume-1' });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.durableReplay, true);
    assert.deepEqual(harness.events, ['start']);
    assert.equal(harness.vaultHost.snapshotAuthorityBoundary().generation, committedBoundary.generation + 1);
  } finally { harness.close(); }
});

test('FD6 receives a retryable application-busy rejection throughout the owner replacement lease', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    const backend = harness.backend();
    let releaseStop;
    const barrier = new Promise(resolve => { releaseStop = resolve; });
    harness.setStopBarrier(barrier);
    const mutationPromise = harness.coordinator.applyVaultMutationWithRestart('persist', 'desktop:lease', { token: 'desktop' }, { requestId: 'desktop-lease-1' });
    const leaseDeadline = Date.now() + 2000;
    while (!harness.vaultHost.snapshotMetadata().applicationLease && Date.now() < leaseDeadline) await new Promise(resolve => setTimeout(resolve, 2));
    const applicationLease = harness.vaultHost.snapshotMetadata().applicationLease;
    if (!applicationLease) {
      releaseStop();
      await mutationPromise.catch(() => {});
    }
    assert.ok(applicationLease, 'application lease must be acquired before old-owner stop can block');
    const request = makeCustodyRequest({
      action: 'PREPARE',
      operation: 'persist',
      ref: 'backend:during-lease',
      value: { token: 'backend' },
      requestId: 'fd6-during-lease',
      backendPid: backend.backendPid,
      startupNonce: backend.startupNonce,
      backendSessionId: backend.backendSessionId,
      fd6PipeInstanceId: backend.fd6PipeInstanceId,
      hydrationGeneration: backend.credentialGeneration,
      manifestSha256: sha('manifest'),
      vaultEpoch: backend.credentialVaultEpoch,
      generation: backend.credentialGeneration
    });
    await assert.rejects(harness.vaultHost.prepareCustodyTransaction(request), error => error.reasonCode === APPLICATION_BUSY && error.retryable === true);
    releaseStop();
    await mutationPromise;
  } finally { harness.close(); }
});


test('UI mutation success cannot resolve before runtime projection convergence', async () => {
  let validationCount = 0;
  let releaseProjection;
  let enteredProjection;
  const projectionBarrier = new Promise(resolve => { releaseProjection = resolve; });
  const projectionEntered = new Promise(resolve => { enteredProjection = resolve; });
  const harness = createHarness({
    async validateRuntimeProjection({ ready }) {
      validationCount += 1;
      if (validationCount === 2) {
        enteredProjection();
        await projectionBarrier;
      }
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
  });
  try {
    await harness.coordinator.startBackend();
    let settled = false;
    const mutation = harness.coordinator.applyVaultMutationWithRestart('persist', 'desktop:runtime-gate', { token: 'secret' }, { requestId: 'desktop-runtime-gate' })
      .finally(() => { settled = true; });
    await projectionEntered;
    const early = await Promise.race([
      mutation.then(() => 'resolved', () => 'rejected'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 500))
    ]);
    assert.equal(early, 'pending');
    assert.equal(settled, false);
    releaseProjection();
    const result = await mutation;
    assert.equal(result.ok, true);
    assert.equal(settled, true);
  } finally {
    releaseProjection?.();
    harness.close();
  }
});


test('unexpected backend exit records EXIT_CONFIRMED before OWNER_RECOVERING', async () => {
  const harness = createHarness();
  try {
    await harness.coordinator.startBackend();
    const { child } = await harness.simulateUnexpectedBackendExit();
    const result = await harness.coordinator.recoverAfterBackendExit(child, { unexpected: true });
    assert.equal(result.recovered, true);
    assert.equal(result.unexpected, true);
    const history = harness.coordinator.snapshot().stateHistory;
    const confirmedIndex = history.findIndex(row => row.state === 'OWNER_EXIT_CONFIRMED' && row.reasonCode === 'backend-exit-confirmed');
    const recoveringIndex = history.findIndex(row => row.state === 'OWNER_RECOVERING' && row.reasonCode === 'backend-exit-observed');
    assert.ok(confirmedIndex >= 0, 'unexpected exit must record OWNER_EXIT_CONFIRMED');
    assert.ok(recoveringIndex > confirmedIndex, 'OWNER_RECOVERING must follow OWNER_EXIT_CONFIRMED');
    assert.equal(history[confirmedIndex].backendPid, child.pid);
    assert.equal(history[confirmedIndex].unexpected, true);
    assert.equal(history[recoveringIndex].unexpected, true);
    assert.equal(harness.coordinator.snapshot().state, 'IDLE');
  } finally { harness.close(); }
});

// ---------------------------------------------------------------------------
// Regression: FAILED_SAFE reset boundary vs authority initialization ordering
// (root cause WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED after 3024e4b3
//  deferred CredentialVaultHost authority init to async initialize()).
// ---------------------------------------------------------------------------

function persistedFailedSafeLifecycle() {
  return {
    state: 'FAILED_SAFE',
    reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_INTERRUPTED',
    operationId: 'd87191fa-8a89-4292-976d-73efefb40eda',
    operationType: 'START_BACKEND',
    mutationCommitted: false
  };
}

test('FAILED_SAFE with uninitialized authority is reset-blocked (exact UAT regression)', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    // Authority has NOT been initialized yet (old buggy ordering).
    const before = harness.vaultHost.snapshotMetadata();
    assert.equal(before.available, false);
    assert.equal(before.lifecycle?.state, 'UNINITIALIZED');

    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => {
        assert.equal(error.reasonCode, 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED');
        assert.equal(error.boundary.authorityAvailable, false);
        assert.equal(error.boundary.authorityState, 'UNINITIALIZED');
        assert.equal(error.boundary.backendOwned, false);
        assert.equal(error.boundary.backendPid, 0);
        assert.equal(error.boundary.rejectedOwnerLive, false);
        assert.equal(error.boundary.ownerTrusted, true);
        assert.equal(error.boundary.fd6Active, false);
        return true;
      }
    );
  } finally { harness.close(); }
});

test('FAILED_SAFE with initialized authority recovers to IDLE (production ordering contract)', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    // Production wiring contract: initialize authority BEFORE any application operation.
    await harness.vaultHost.initialize();
    const ready = harness.vaultHost.snapshotMetadata();
    assert.equal(ready.available, true);
    assert.equal(ready.lifecycle?.state, 'ACTIVE');

    const result = await harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true }));
    assert.equal(result.migrated, true);
    assert.equal(harness.coordinator.snapshot().state, 'IDLE');
  } finally { harness.close(); }
});

test('authority unavailable still blocks application operation (fail closed)', async () => {
  const harness = createHarness({
    preloadLifecycle: persistedFailedSafeLifecycle(),
    vaultCrashInjector: (name) => {
      if (name === 'AUTHORITY_LIFECYCLE_BEFORE_DETECTION') {
        const error = new Error('injected authority detection failure');
        error.reasonCode = 'INJECTED_AUTHORITY_UNAVAILABLE';
        throw error;
      }
    }
  });
  try {
    // Simulate a truly broken authority: initialize() throws during detection,
    // leaving recoveryReady=false and lifecycle UNAVAILABLE.
    await assert.rejects(
      harness.vaultHost.initialize(),
      error => error.reasonCode === 'INJECTED_AUTHORITY_UNAVAILABLE'
    );
    const meta = harness.vaultHost.snapshotMetadata();
    assert.equal(meta.available, false);
    assert.equal(meta.lifecycle?.state, 'UNAVAILABLE');

    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED'
    );
  } finally { harness.close(); }
});

test('unresolved owner session still blocks FAILED_SAFE reset', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    // Authority recovered to ACTIVE first (production ordering).
    await harness.vaultHost.initialize();
    assert.equal(harness.vaultHost.snapshotMetadata().lifecycle?.state, 'ACTIVE');

    // Establish a live owner session (FD5/FD6 owner) that must block reset.
    harness.vaultHost.establishCustodyOwner({
      backendPid: 9999,
      startupNonce: 'nonce-1',
      backendSessionId: 'session-1',
      manifestSha256: 'a'.repeat(64),
      vaultEpoch: 'epoch-1',
      fd6PipeInstanceId: 'fd6-1',
      generation: 1
    });
    const boundary = harness.coordinator.snapshot().failedSafeResetBoundary;
    assert.equal(boundary.safe, false);
    assert.ok(boundary.pendingOwnerSession || boundary.activeOwnerSession, 'owner session must be reported unresolved');
    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED'
    );
  } finally { harness.close(); }
});

test('unresolved activeTransactionId still blocks FAILED_SAFE reset', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    await harness.vaultHost.initialize();
    assert.equal(harness.vaultHost.snapshotMetadata().lifecycle?.state, 'ACTIVE');

    harness.vaultHost.activeTransactionId = 'tx:unresolved';
    const boundary = harness.coordinator.snapshot().failedSafeResetBoundary;
    assert.equal(boundary.safe, false);
    assert.equal(boundary.activeTransactionId, 'tx:unresolved');
    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED'
    );
  } finally { harness.close(); }
});

test('pending authority operations still block FAILED_SAFE reset', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    await harness.vaultHost.initialize();
    assert.equal(harness.vaultHost.snapshotMetadata().lifecycle?.state, 'ACTIVE');

    harness.vaultHost.pendingOperations = 1;
    const boundary = harness.coordinator.snapshot().failedSafeResetBoundary;
    assert.equal(boundary.safe, false);
    assert.equal(boundary.pendingOperations, 1);
    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED'
    );
  } finally { harness.close(); }
});

test('active FD6 custody pipe still blocks FAILED_SAFE reset', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    await harness.vaultHost.initialize();
    assert.equal(harness.vaultHost.snapshotMetadata().lifecycle?.state, 'ACTIVE');

    Object.assign(harness.backend(), { credentialCustody: { dedicatedPipeActive: true } });
    const boundary = harness.coordinator.snapshot().failedSafeResetBoundary;
    assert.equal(boundary.safe, false);
    assert.equal(boundary.fd6Active, true);
    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_FAILED_SAFE_RESET_BLOCKED'
    );
  } finally { harness.close(); }
});

test('active rejected-owner containment blocks start with stronger containment failure', async () => {
  const harness = createHarness({ preloadLifecycle: persistedFailedSafeLifecycle() });
  try {
    await harness.vaultHost.initialize();
    assert.equal(harness.vaultHost.snapshotMetadata().lifecycle?.state, 'ACTIVE');

    // ownerTrusted === false (no provisional-ready owner registry) activates containment.
    Object.assign(harness.backend(), { ownerTrusted: false });
    const boundary = harness.coordinator.snapshot().failedSafeResetBoundary;
    assert.equal(boundary.safe, false);
    assert.equal(harness.coordinator.snapshot().containmentActive, true);
    await assert.rejects(
      harness.coordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async () => ({ migrated: true })),
      error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT'
    );
  } finally { harness.close(); }
});
