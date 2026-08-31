'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SqliteTransactionCoordinator
} = require('../store/sqliteTransactionCoordinator');

const {
  SqliteDocumentStore
} = require('../lib/sqliteDocumentStore');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fixture(namespace = 'false-async-ownership-regression') {
  const sql = [];

  const db = {
    exec(statement) {
      sql.push(String(statement));
    }
  };

  const coordinator = new SqliteTransactionCoordinator(db);
  const values = new Map();

  const key = (ns, name) => `${ns}\u0000${name}`;

  const persistenceCapability = {
    getSetting(ns, name, fallback) {
      const k = key(ns, name);
      return values.has(k) ? clone(values.get(k)) : clone(fallback);
    },

    setSetting(ns, name, value) {
      values.set(key(ns, name), clone(value));
      return clone(value);
    },

    transaction(work) {
      return coordinator.runSync(work);
    },

    transactionAsync(work) {
      return coordinator.runAsync(work);
    }
  };

  const store = new SqliteDocumentStore(
    namespace,
    { revision: 0 },
    { persistenceCapability }
  );

  return { store, coordinator, sql };
}

test('SqliteDocumentStore.updateAsync synchronous mutator does not leak ownership across microtask', async () => {
  const { store, coordinator } = fixture();

  const updatePromise = store.updateAsync(current => {
    current.revision += 1;
    return current;
  });

  const competingSync = Promise.resolve().then(() =>
    coordinator.runSync(() => 'SYNC_OK')
  );

  assert.equal(await competingSync, 'SYNC_OK');
  assert.deepEqual(await updatePromise, { revision: 1 });

  assert.deepEqual(
    {
      depth: coordinator.snapshot().depth,
      pendingAsyncRoots: coordinator.snapshot().pendingAsyncRoots
    },
    {
      depth: 0,
      pendingAsyncRoots: 0
    }
  );
});

test('genuine asynchronous transaction still owns SQLite until async work settles', async () => {
  const { coordinator } = fixture('real-async-ownership');

  let releaseBarrier;
  let markEntered;

  const barrier = new Promise(resolve => {
    releaseBarrier = resolve;
  });

  const entered = new Promise(resolve => {
    markEntered = resolve;
  });

  const asyncRoot = coordinator.runAsync(async () => {
    markEntered();
    await barrier;
    return 'ASYNC_OK';
  });

  await entered;

  assert.throws(
    () => coordinator.runSync(() => 'MUST_NOT_RUN'),
    error => error && error.code === 'SQLITE_TRANSACTION_BUSY_CONTEXT'
  );

  releaseBarrier();

  assert.equal(await asyncRoot, 'ASYNC_OK');

  assert.equal(coordinator.snapshot().depth, 0);
  assert.equal(coordinator.snapshot().pendingAsyncRoots, 0);
});

test('SqliteDocumentStore.updateAsync continues to reject asynchronous mutators', async () => {
  const { store, coordinator } = fixture('async-mutator-rejection');

  await assert.rejects(
    store.updateAsync(async current => {
      current.revision += 1;
      return current;
    }),
    /ASYNC_MUTATOR_NOT_SUPPORTED/
  );

  assert.equal(coordinator.snapshot().depth, 0);
  assert.equal(coordinator.snapshot().pendingAsyncRoots, 0);
});
