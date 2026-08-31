'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreManager } = require('../store/StoreManager');
const { SynchronousSqliteStorePersistenceAdapter } = require('../store/adapters/SynchronousSqliteStorePersistenceAdapter');

test('StoreManager SQLite persistence uses the synchronous broker transaction boundary', () => {
  let syncCalls = 0;
  let asyncCalls = 0;
  const store = {
    db: {},
    transaction(work) {
      syncCalls += 1;
      return work();
    },
    transactionAsync() {
      asyncCalls += 1;
      throw new Error('transactionAsync must not be used for StoreManager persistence');
    }
  };
  const adapter = new SynchronousSqliteStorePersistenceAdapter({ store });
  const result = adapter.transaction(() => 'committed', { transactionId: 'tx-sync-1' });
  assert.equal(result, 'committed');
  assert.equal(syncCalls, 1);
  assert.equal(asyncCalls, 0);
});

test('StoreManager persistence rejects Promise-returning work before it can cross a DatabaseSync transaction boundary', async () => {
  const persistence = {
    transaction(work) {
      return work({ appendStoreEvents() {}, persistStoreMeta() {} });
    }
  };
  const manager = new StoreManager({ persistence });
  manager.registerCommand('ASYNC_PERSIST_REGRESSION', ({ cloneState }) => ({
    nextState: cloneState(),
    changedDomains: ['system'],
    persist: () => Promise.resolve('not-allowed')
  }), { allowBeforeHydration: true });

  await assert.rejects(
    manager.dispatch({ type: 'ASYNC_PERSIST_REGRESSION' }),
    error => error?.code === 'STORE_PERSISTENCE_ASYNC_TRANSACTION_UNSUPPORTED'
  );
  assert.equal(manager.stateVersion, 0, 'failed persistence must not publish the candidate state');
});

test('StoreManager synchronous persistence commits before another synchronous durable write enters', async () => {
  const sequence = [];
  const persistence = {
    transaction(work) {
      sequence.push('store-begin');
      const result = work({
        appendStoreEvents() { sequence.push('events'); },
        persistStoreMeta() { sequence.push('meta'); }
      });
      sequence.push('store-commit');
      return result;
    }
  };
  const manager = new StoreManager({ persistence });
  manager.registerCommand('SYNC_PERSIST_REGRESSION', ({ cloneState }) => ({
    nextState: cloneState(),
    changedDomains: ['system'],
    persist: () => { sequence.push('plan'); }
  }), { allowBeforeHydration: true });

  await manager.dispatch({ type: 'SYNC_PERSIST_REGRESSION' });
  sequence.push('durable-claim-begin');
  sequence.push('durable-claim-commit');

  assert.deepEqual(sequence, [
    'store-begin', 'plan', 'events', 'meta', 'store-commit',
    'durable-claim-begin', 'durable-claim-commit'
  ]);
  assert.equal(manager.stateVersion, 1);
});
