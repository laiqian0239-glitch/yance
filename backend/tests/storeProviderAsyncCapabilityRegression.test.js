'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  acquireAuthorityWriteHost
} = require('../services/authorityWriteHost');

const {
  SqliteConnectionBroker,
  configureSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const {
  getDocumentPersistenceCapability
} = require('../repositories/storeProvider');

test('primary store capability preserves transactionAsync Promise completion and model registry queueing', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yance-store-provider-async-capability-')
  );

  const dbPath = path.join(root, 'yance-r32.db');

  let host = null;
  let broker = null;

  try {
    resetSqliteConnectionBrokerForTests();

    const identity =
      `store-provider-test:${process.pid}:${crypto.randomUUID()}`;

    host = acquireAuthorityWriteHost({
      dbPath,
      instanceId: `store-provider-host-${crypto.randomUUID()}`,
      startupNonce: crypto.randomUUID(),
      ownershipPid: process.pid,
      ownershipProcessIdentity: identity,
      ownershipPidAlive: pid => Number(pid) === Number(process.pid),
      ownershipCapturePidIdentity: () => identity,
      ownershipStaleMs: 60000
    });

    broker = new SqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: host.capability,
      storeOptions: {
        authorityHeartbeatMs: 60000
      }
    });

    configureSqliteConnectionBroker(broker);

    const store = broker.open();
    const persistence = getDocumentPersistenceCapability();

    let releaseOwner;
    let ownerEntered;

    const release = new Promise(resolve => {
      releaseOwner = resolve;
    });

    const entered = new Promise(resolve => {
      ownerEntered = resolve;
    });

    let capabilitySettled = false;

    const capabilityResult = persistence.transactionAsync(async () => {
      ownerEntered();
      await release;
      return { status: 'COMPLETED' };
    });

    assert.equal(
      typeof capabilityResult?.then,
      'function',
      'transactionAsync capability must return a Promise'
    );

    capabilityResult.finally(() => {
      capabilitySettled = true;
    });

    await entered;

    // Deterministic microtask turns only; no sleep-based race test.
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      capabilitySettled,
      false,
      'capability Promise must not settle before underlying SQLite transaction'
    );

    releaseOwner();

    const resolved = await capabilityResult;

    assert.deepEqual(resolved, { status: 'COMPLETED' });
    assert.equal(Object.isFrozen(resolved), true);

    /*
     * Now prove the actual consumer path.
     */
    const modelRegistryPath = require.resolve('../services/modelRegistry');
    delete require.cache[modelRegistryPath];

    const modelRegistry = require('../services/modelRegistry');

    let releaseSecondOwner;
    let secondOwnerEntered;

    const secondRelease = new Promise(resolve => {
      releaseSecondOwner = resolve;
    });

    const secondEntered = new Promise(resolve => {
      secondOwnerEntered = resolve;
    });

    const genuineOwner = store.transactionAsync(async () => {
      store.setMeta('model-registry-owner', { active: true });
      secondOwnerEntered();
      await secondRelease;
      store.setMeta('model-registry-owner', { active: false });
    });

    await secondEntered;

    let mergeSettled = false;

    const merge = modelRegistry.mergeDiscovered({
      online: true,
      scannedAt: '2026-08-31T05:00:00.000Z',
      endpoint: 'http://127.0.0.1:11434',
      version: 'fast-landing-promise-regression',
      models: [{
        id: 'ollama:promise-regression',
        name: 'promise-regression:latest',
        provider: 'ollama',
        available: true
      }]
    }).finally(() => {
      mergeSettled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      mergeSettled,
      false,
      'model registry update must remain pending behind genuine async SQLite owner'
    );

    releaseSecondOwner();

    await genuineOwner;

    const registry = await merge;

    assert.equal(
      registry.models.some(
        model => model.id === 'ollama:promise-regression'
      ),
      true
    );

    const snapshot = store.transactions.snapshot();

    assert.equal(snapshot.depth, 0);
    assert.equal(snapshot.pendingAsyncRoots, 0);
    assert.equal(snapshot.queued, false);

    console.log(JSON.stringify({
      capabilityReturnedPromise: true,
      capabilityWaitedForPhysicalTransaction: true,
      modelRegistryQueuedBehindAsyncOwner: true,
      sqliteTransactionBusyContextCount: 0,
      finalCoordinatorSnapshot: snapshot
    }, null, 2));

  } finally {
    try { broker?.close(); } catch (_) {}
    try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
    try { host?.close(); } catch (_) {}

    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50
      });
    } catch (_) {}
  }
});
