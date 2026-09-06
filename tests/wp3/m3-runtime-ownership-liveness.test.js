'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeOwnership } = require('../../backend/runtime/RuntimeOwnership');
const {
  acquireAuthorityWriteHost
} = require('../../backend/services/authorityWriteHost');

const FAR_FUTURE = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
const SOON = new Date(Date.now() + 60000).toISOString();

function buildOwnership(options = {}) {
  const lease = {
    leaseName: 'app-runtime',
    ownerInstanceId: 'owner-1',
    ownerPid: 1234,
    fencingToken: 1,
    leaseExpiresAtUtc: options.leaseExpiresAtUtc || SOON
  };
  const store = {
    _releaseCalls: 0,
    acquireLease: () => lease,
    heartbeat: options.heartbeat || (() => ({ heartbeatAtUtc: new Date().toISOString(), leaseExpiresAtUtc: lease.leaseExpiresAtUtc })),
    releaseLease: () => { store._releaseCalls += 1; },
    close: () => {},
    getCredentialHydrationState: () => ({})
  };
  const mutex = {
    _releaseCalls: 0,
    acquire: async () => ({}),
    release: async () => { mutex._releaseCalls += 1; },
    held: true,
    snapshot: () => ({ held: true })
  };
  const lost = [];
  const owner = new RuntimeOwnership({
    dataRoot: '/tmp/r32-m3-test',
    buildId: 'test-build',
    ownerInstanceId: 'owner-1',
    bootAttemptId: 'boot-1',
    runtimePaths: {
      dataRoot: '/tmp/r32-m3-test',
      dbPath: '/tmp/r32-m3-test/runtime.sqlite',
      mutexIdentity: 'test-mutex',
      dataRootIdentity: 'test-data',
      dbPathIdentity: 'test-db'
    },
    mutex,
    storeFactory: () => store,
    onLeaseLost: (reason, detail) => lost.push({ reason, detail }),
    clock: options.clock || (() => Date.now()),
    leaseDurationMs: 15000,
    heartbeatIntervalMs: 5,
    leaseLostThreshold: options.leaseLostThreshold || 3
  });
  return { owner, store, mutex, lost, lease };
}

async function acquireAndRun(owner, runMs) {
  await owner.acquire();
  owner.startHeartbeat();
  await new Promise(resolve => setTimeout(resolve, runMs));
}

test('branded AuthorityWriteHost capability replaces the duplicate process mutex while runtime lease remains active', async () => {
  const previousRole =
    process.env.YANCE_PROCESS_ROLE;

  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'yance-runtime-authority-delegation-'
      )
    );

  const dbPath =
    path.join(
      root,
      'store',
      'runtime.sqlite'
    );

  fs.mkdirSync(
    path.dirname(dbPath),
    { recursive: true }
  );

  process.env.YANCE_PROCESS_ROLE =
    'desktop-host';

  let host = null;
  let owner = null;

  const lease = {
    leaseName: 'app-runtime',
    ownerInstanceId:
      'authority-delegated-owner',
    ownerPid: process.pid,
    fencingToken: 41,
    leaseExpiresAtUtc:
      new Date(
        Date.now() + 60000
      ).toISOString()
  };

  const store = {
    acquireLease: () => lease,
    heartbeat: () => ({
      heartbeatAtUtc:
        new Date().toISOString(),
      leaseExpiresAtUtc:
        lease.leaseExpiresAtUtc
    }),
    releaseLease: () => {},
    close: () => {},
    getCredentialHydrationState:
      () => ({})
  };

  try {
    host =
      acquireAuthorityWriteHost({
        dbPath,
        instanceId:
          'runtime-delegation-host',
        startupNonce:
          'runtime-delegation-startup'
      });

    owner =
      new RuntimeOwnership({
        dataRoot: root,
        dbPath,
        buildId:
          'runtime-delegation-test',
        ownerInstanceId:
          lease.ownerInstanceId,
        bootAttemptId:
          'runtime-delegation-boot',
        runtimePaths: {
          dataRoot: root,
          dbPath,
          mutexIdentity:
            'delegated-authority',
          mutexIdentityKind:
            'authority-write-host',
          dataRootIdentity:
            'delegated-data',
          dbPathIdentity:
            'delegated-db'
        },
        authorityWriteHostCapability:
          host.capability,
        storeFactory:
          () => store,
        exitOnLeaseLost: false
      });

    assert.strictEqual(
      owner.mutex,
      null,
      'a real AuthorityWriteHost capability must prevent construction of a second process mutex'
    );

    await owner.acquire();

    assert.strictEqual(
      owner.lease,
      lease,
      'runtime lease remains the subordinate runtime-state fencing authority'
    );

    const snapshot =
      owner.snapshot();

    assert.strictEqual(
      snapshot.mutexProvider,
      'AUTHORITY_WRITE_HOST'
    );

    assert.strictEqual(
      snapshot.mutex.provider,
      'AUTHORITY_WRITE_HOST'
    );

    assert.strictEqual(
      snapshot.mutex.held,
      true
    );
  } finally {
    if (owner) {
      await owner
        .release()
        .catch(() => {});
    }

    try {
      host?.close();
    } catch (_) {}

    if (previousRole === undefined) {
      delete process.env.YANCE_PROCESS_ROLE;
    } else {
      process.env.YANCE_PROCESS_ROLE =
        previousRole;
    }

    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50
      }
    );
  }
});

test('healthy heartbeat never fires onLeaseLost', async () => {
  const { owner, lost } = buildOwnership();
  try {
    await acquireAndRun(owner, 700);
    assert.strictEqual(lost.length, 0, 'healthy heartbeat must not lose lease');
  } finally {
    await owner.release();
  }
});

test('fencing-stale heartbeat fires RUNTIME_LEASE_STALE immediately', async () => {
  const staleError = Object.assign(new Error('rejected'), { code: 'STALE_FENCING_TOKEN' });
  const { owner, lost } = buildOwnership({ heartbeat: () => { throw staleError; } });
  try {
    await acquireAndRun(owner, 700);
    assert.strictEqual(lost.length, 1, 'stale heartbeat must fire exactly once');
    assert.strictEqual(lost[0].reason, 'RUNTIME_LEASE_STALE');
    assert.strictEqual(owner._leaseLost, true);
  } finally {
    await owner.release();
  }
});

test('expired lease fires RUNTIME_LEASE_EXPIRED via clock', async () => {
  const { owner, lost } = buildOwnership({
    clock: () => FAR_FUTURE,
    leaseExpiresAtUtc: new Date(Date.now() + 60000).toISOString()
  });
  try {
    await acquireAndRun(owner, 700);
    assert.strictEqual(lost.length, 1);
    assert.strictEqual(lost[0].reason, 'RUNTIME_LEASE_EXPIRED');
  } finally {
    await owner.release();
  }
});

test('sustained non-stale failures fire only after leaseLostThreshold', async () => {
  const transient = Object.assign(new Error('db unreachable'), { code: 'SQLITE_BUSY' });
  const { owner, lost } = buildOwnership({
    heartbeat: () => { throw transient; },
    leaseLostThreshold: 3
  });
  try {
    await acquireAndRun(owner, 1800);
    assert.strictEqual(lost.length, 1, 'must fire once threshold reached');
    assert.strictEqual(lost[0].reason, 'RUNTIME_LEASE_HEARTBEAT_FAILED');
    assert.strictEqual(lost[0].detail.consecutiveFailures >= 3, true);
  } finally {
    await owner.release();
  }
});

test('onLeaseLost is invoked with ownership identity detail', async () => {
  const staleError = Object.assign(new Error('rejected'), { code: 'STALE_FENCING_TOKEN' });
  const { owner, lost } = buildOwnership({ heartbeat: () => { throw staleError; } });
  try {
    await acquireAndRun(owner, 700);
    assert.ok(lost[0].detail.ownerInstanceId);
    assert.strictEqual(lost[0].detail.fencingToken, 1);
    assert.strictEqual(lost[0].detail.dataRoot, '/tmp/r32-m3-test');
  } finally {
    await owner.release();
  }
});

test('lease-lost fires only once even if heartbeat keeps erroring', async () => {
  const staleError = Object.assign(new Error('rejected'), { code: 'STALE_FENCING_TOKEN' });
  const { owner, lost } = buildOwnership({ heartbeat: () => { throw staleError; } });
  try {
    await acquireAndRun(owner, 1800);
    assert.strictEqual(lost.length, 1, 'onLeaseLost must be idempotent');
  } finally {
    await owner.release();
  }
});

test('process exit guard releases lease + mutex best-effort', async () => {
  const { owner, store, mutex } = buildOwnership();
  await owner.acquire();
  // Simulate process teardown by invoking the installed exit handler directly.
  assert.ok(typeof owner._exitGuardHandler === 'function', 'exit guard must be installed on acquire');
  owner._exitGuardHandler();
  assert.strictEqual(store._releaseCalls, 1, 'lease row cleared on exit');
  assert.strictEqual(mutex._releaseCalls, 1, 'mutex released on exit');
  assert.strictEqual(owner._acquired, false);
  await owner.release().catch(() => {});
});

test('release() resets watchdog flags', async () => {
  const staleError = Object.assign(new Error('rejected'), { code: 'STALE_FENCING_TOKEN' });
  const { owner } = buildOwnership({ heartbeat: () => { throw staleError; } });
  await owner.acquire();
  owner.startHeartbeat();
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.strictEqual(owner._leaseLost, true);
  await owner.release();
  assert.strictEqual(owner._leaseLost, false, 'leaseLost flag reset after release');
  assert.strictEqual(owner._consecutiveHeartbeatFailures, 0, 'failure counter reset after release');
  assert.strictEqual(owner._acquired, false);
});
