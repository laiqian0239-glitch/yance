'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');
const lifecycle = require('../services/accountLifecycleCommands');
const accountLifecycle = require('../services/accountLifecycle');
const { AccountContext } = require('../core/accountContext');
const accountManagerModule = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const whatsapp = require('../services/whatsappAdapter');
const telegram = require('../services/telegramAdapter');
const facebook = require('../services/facebookAdapter');
const messageStore = require('../services/messageStore');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const accountLifecycleSaga = require('../services/accountLifecycleSagaService').singleton;

const { getStore } = require('../repositories/storeProvider');

function persistSagaFixture(t, account) {
  const store = getStore();
  store.upsertAccount({
    ...account,
    accountId: account.accountId || account.id,
    adapterAccountId: account.adapterAccountId || account.id,
    lifecycleState: account.lifecycleState || 'active',
    state: account.state || 'offline'
  });
  t.after(() => {
    try { store.db.prepare('DELETE FROM account_lifecycle_saga WHERE account_id=?').run(account.id); } catch (_) {}
    try { store.db.prepare('DELETE FROM r32_accounts WHERE id=?').run(account.id); } catch (_) {}
  });
}

function makeContext(manager) {
  lifecycle.setManager(manager);
  return new AccountContext({
    securityGuard: { execute: async (_action, _ctx, operation) => operation(), credentials: { has: () => false } },
    accountManager: manager,
    accountStore: { list: () => [], read: () => ({ audit: [] }), get: () => null },
    accountMigration: {},
    messageStore: {},
    sendQueue: {},
    platformMessaging: {},
    platformCapabilities: { publicContracts: () => ({}) },
    whatsapp: {},
    facebook: {},
    canonicalIdentity: { resolveCanonicalAccountId: id => id },
    eventBus: {}
  });
}

test('SQLite nested transactions use savepoints and rollback only the nested frame', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  tx.runSync(() => {
    db.prepare('INSERT INTO items(value) VALUES(?)').run('outer-before');
    assert.throws(() => tx.runSync(() => {
      db.prepare('INSERT INTO items(value) VALUES(?)').run('nested-rollback');
      throw new Error('rollback nested');
    }), /rollback nested/);
    db.prepare('INSERT INTO items(value) VALUES(?)').run('outer-after');
  });
  assert.deepEqual(db.prepare('SELECT value FROM items ORDER BY id').all().map(row => row.value), ['outer-before', 'outer-after']);
  assert.equal(tx.snapshot().depth, 0);
  db.close();
});

test('SQLite sync work from another async context is rejected instead of joining and being rolled back with the owner', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE isolated(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  let releaseOwner;
  let ownerStarted;
  const started = new Promise(resolve => { ownerStarted = resolve; });
  const release = new Promise(resolve => { releaseOwner = resolve; });

  const owner = tx.runAsync(async () => {
    db.prepare('INSERT INTO isolated(value) VALUES(?)').run('owner');
    ownerStarted();
    await release;
    throw new Error('owner rollback');
  });

  await started;
  assert.throws(
    () => tx.runSync(() => db.prepare('INSERT INTO isolated(value) VALUES(?)').run('unrelated-sync')),
    error => error?.code === 'SQLITE_TRANSACTION_BUSY_CONTEXT'
  );
  releaseOwner();
  await assert.rejects(owner, /owner rollback/);
  assert.deepEqual(db.prepare('SELECT value FROM isolated ORDER BY id').all(), []);

  tx.runSync(() => db.prepare('INSERT INTO isolated(value) VALUES(?)').run('after-owner'));
  assert.deepEqual(db.prepare('SELECT value FROM isolated ORDER BY id').all().map(row => row.value), ['after-owner']);
  db.close();
});

test('SQLite sync savepoints remain available inside the owning async context', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE mixed(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  await tx.runAsync(async () => {
    db.prepare('INSERT INTO mixed(value) VALUES(?)').run('outer-before');
    assert.throws(() => tx.runSync(() => {
      db.prepare('INSERT INTO mixed(value) VALUES(?)').run('nested-rollback');
      throw new Error('nested sync rollback');
    }), /nested sync rollback/);
    db.prepare('INSERT INTO mixed(value) VALUES(?)').run('outer-after');
  });
  assert.deepEqual(db.prepare('SELECT value FROM mixed ORDER BY id').all().map(row => row.value), ['outer-before', 'outer-after']);
  db.close();
});

test('SQLite async work started from an expired inherited context opens a new root transaction', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE stale(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  let detachedResolve;
  let detachedReject;
  const detached = new Promise((resolve, reject) => { detachedResolve = resolve; detachedReject = reject; });

  await tx.runAsync(async () => {
    db.prepare('INSERT INTO stale(value) VALUES(?)').run('outer');
    setTimeout(() => {
      tx.runAsync(async () => {
        db.prepare('INSERT INTO stale(value) VALUES(?)').run('detached');
      }).then(detachedResolve, detachedReject);
    }, 0);
  });

  await detached;
  assert.deepEqual(db.prepare('SELECT value FROM stale ORDER BY id').all().map(row => row.value), ['outer', 'detached']);
  assert.equal(tx.snapshot().depth, 0);
  db.close();
});

test('SQLite concurrent nested async savepoints are serialized within their owning context', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE nested_order(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  const order = [];

  await tx.runAsync(async () => {
    await Promise.all([
      tx.runAsync(async () => {
        order.push('first-start');
        db.prepare('INSERT INTO nested_order(value) VALUES(?)').run('first');
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push('first-end');
      }),
      tx.runAsync(async () => {
        order.push('second-start');
        db.prepare('INSERT INTO nested_order(value) VALUES(?)').run('second');
        order.push('second-end');
      })
    ]);
  });

  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
  assert.deepEqual(db.prepare('SELECT value FROM nested_order ORDER BY id').all().map(row => row.value), ['first', 'second']);
  db.close();
});

test('SQLite async work is rejected inside a synchronous transaction before a savepoint starts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sync_owner(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  assert.throws(() => tx.runSync(() => {
    db.prepare('INSERT INTO sync_owner(value) VALUES(?)').run('outer');
    tx.runAsync(async () => db.prepare('INSERT INTO sync_owner(value) VALUES(?)').run('unsafe-async'));
  }), error => error?.code === 'SQLITE_ASYNC_NESTED_IN_SYNC_TRANSACTION');
  assert.deepEqual(db.prepare('SELECT value FROM sync_owner').all(), []);
  assert.equal(tx.snapshot().depth, 0);
  db.close();
});

test('SQLite async writes are serialized and nested async work does not issue a second BEGIN', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE seq(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const tx = new SqliteTransactionCoordinator(db);
  const order = [];
  await Promise.all([
    tx.runAsync(async () => {
      order.push('a-start');
      db.prepare('INSERT INTO seq(value) VALUES(?)').run('a');
      await tx.runAsync(async () => db.prepare('INSERT INTO seq(value) VALUES(?)').run('a-nested'));
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push('a-end');
    }),
    tx.runAsync(async () => {
      order.push('b-start');
      db.prepare('INSERT INTO seq(value) VALUES(?)').run('b');
      order.push('b-end');
    })
  ]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
  assert.deepEqual(db.prepare('SELECT value FROM seq ORDER BY id').all().map(row => row.value), ['a', 'a-nested', 'b']);
  db.close();
});

test('connect/reconnect/pause/resume/logout expose one stable account layer', async () => {
  const calls = [];
  const manager = {
    connect: async id => ({ id, state: 'connected', stateLabel: '已连接' }),
    reconnect: async id => ({ id, state: 'connected', stateLabel: '已连接' }),
    disconnect: async (id, options) => ({ stopped: true, logout: options.logout, account: { id, state: options.logout ? 'logged-out' : 'paused', stateLabel: options.logout ? '已退出' : '已暂停' } }),
    list: () => ({ accounts: [{ id: 'wa-1', platform: 'whatsapp', state: 'unconfigured' }] }),
    create: async input => ({ ...input, id: input.id }),
    getLifecycleState: async id => ({ id, state: 'connected' })
  };
  for (const method of ['connect', 'reconnect', 'disconnect']) {
    const original = manager[method];
    manager[method] = async (...args) => { calls.push([method, ...args]); return original(...args); };
  }
  const context = makeContext(manager);
  for (const [command, expectedAction] of [
    ['account.connect', 'connect'],
    ['account.reconnect', 'reconnect'],
    ['account.pause', 'pause'],
    ['account.resume', 'resume'],
    ['account.logout', 'logout']
  ]) {
    const result = await context.execute(command, { id: 'wa-1' }, {});
    assert.equal(result.account.id, 'wa-1');
    assert.equal(result.account.account, undefined);
    assert.equal(result.lifecycle.action, expectedAction);
  }
  assert.equal(calls.filter(row => row[0] === 'disconnect').length, 2);
});

test('account.create followed by connect remains schema-stable for 100 consecutive accounts', async () => {
  const records = new Map();
  const manager = {
    create: async input => { const row = { ...input, state: 'unconfigured' }; records.set(row.id, row); return row; },
    connect: async id => { const row = { ...records.get(id), state: 'connected', stateLabel: '已连接' }; records.set(id, row); return row; },
    reconnect: async id => records.get(id),
    disconnect: async id => ({ account: records.get(id) }),
    list: () => ({ accounts: [...records.values()] }),
    getLifecycleState: async id => records.get(id)
  };
  const context = makeContext(manager);
  for (let i = 0; i < 100; i += 1) {
    const id = `wa-${i}`;
    const created = await context.execute('account.create', { id, platform: 'whatsapp' }, {});
    assert.equal(created.account.id, id);
    const connected = await context.execute('account.connect', { id }, {});
    assert.equal(connected.account.id, id);
    assert.equal(connected.account.state, 'connected');
    assert.equal(connected.account.account, undefined);
  }
  assert.equal(records.size, 100);
});

test('real AccountManager disconnect/logout no longer depends on a missing lifecycle method', async t => {
  const { AccountManager } = accountManagerModule;
  const account = { id: 'wa-real', platform: 'whatsapp', adapterAccountId: 'wa-real', displayName: 'WA', identityLabel: 'WA', metadata: {}, paused: false, notificationsEnabled: true };
  persistSagaFixture(t, account);
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'getRaw', () => account);
  patch(accountStore, 'list', () => [account]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [account], defaults: {}, bindings: {}, audit: [] }));
  patch(accountStore, 'record', async () => ({}));
  patch(accountStore, 'update', async (_id, patchValue) => Object.assign(account, patchValue));
  patch(whatsapp, 'stop', async (_account, logout) => ({ stopped: true, logout }));
  patch(whatsapp, 'status', () => []);
  patch(whatsapp, 'credentialState', () => ({ usable: false, accountKey: 'wa-real', registered: false }));
  patch(whatsapp, 'resolveAccountKey', () => 'wa-real');
  patch(messageStore, 'listConversations', () => []);
  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  const result = await manager.disconnect('wa-real', { logout: true });
  assert.equal(result.account.id, 'wa-real');
  assert.equal(result.account.state, 'logged-out');
  assert.equal(result.logout, true);
  assert.equal(manager.getLifecycleState('wa-real').id, 'wa-real');
});

test('Telegram and Facebook logout clear persisted account credentials even when no adapter session is active', async t => {
  const { AccountManager } = accountManagerModule;
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });

  const accounts = new Map([
    ['tg-logout', { id: 'tg-logout', platform: 'telegram', credentialRef: 'credential:tg-logout', displayName: 'TG', identityLabel: 'TG', metadata: {}, paused: false, notificationsEnabled: true }],
    ['fb-logout', { id: 'fb-logout', platform: 'facebook', credentialRef: 'credential:fb-logout', displayName: 'FB', identityLabel: 'FB', metadata: {}, paused: false, notificationsEnabled: true }]
  ]);
  for (const account of accounts.values()) persistSagaFixture(t, account);
  const removed = [];
  patch(accountStore, 'get', id => accounts.get(id) || null);
  patch(accountStore, 'getRaw', id => accounts.get(id) || null);
  patch(accountStore, 'list', () => [...accounts.values()]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [...accounts.values()], defaults: {}, bindings: {}, audit: [] }));
  patch(accountStore, 'record', async () => ({}));
  patch(messageStore, 'listConversations', () => []);
  patch(telegram, 'disconnect', async (_id, logout) => ({ state: logout ? 'logged-out' : 'paused' }));
  patch(telegram, 'status', () => ({ state: 'logged-out' }));
  patch(facebook, 'disconnect', async (_id, logout) => ({ state: logout ? 'logged-out' : 'paused', canSend: false, canReceive: false }));
  patch(facebook, 'status', () => ({ state: 'logged-out', canSend: false, canReceive: false }));
  patch(securityGuard, 'removeCredential', async ref => { removed.push(ref); return true; });
  patch(securityGuard, 'readCredential', () => null);

  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  for (const id of accounts.keys()) {
    const result = await manager.disconnect(id, { logout: true });
    assert.equal(result.account.state, 'logged-out');
    assert.equal(result.account.credentialReady, false);
  }
  assert.deepEqual(removed.sort(), ['credential:fb-logout', 'credential:tg-logout']);
});

test('connect persistence failure rolls back the already-started adapter instance', async t => {
  const { AccountManager } = accountManagerModule;
  const account = { id: 'wa-connect-rollback', platform: 'whatsapp', adapterAccountId: 'wa-connect-rollback', displayName: 'WA', identityLabel: 'WA', metadata: {}, paused: false, autoReconnect: true, notificationsEnabled: true, lifecycleState: 'active' };
  persistSagaFixture(t, account);
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });
  let stopCalls = 0;
  let failedRecordCalls = 0;
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'getRaw', () => account);
  patch(accountStore, 'list', () => [account]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [account], defaults: {}, bindings: {}, audit: [] }));
  patch(accountStore, 'update', async (_id, patchValue) => Object.assign(account, patchValue));
  patch(accountStore, 'commitConnectedIdentityTx', async () => {
    throw Object.assign(new Error('SQLITE_WRITE_FAILED'), { code: 'SQLITE_WRITE_FAILED' });
  });
  patch(accountStore, 'record', async (event) => {
    if (event === 'account-connect-failed') failedRecordCalls += 1;
    return {};
  });
  patch(whatsapp, 'start', async () => ({ state: 'connected' }));
  patch(whatsapp, 'stop', async () => { stopCalls += 1; return { stopped: true }; });
  patch(whatsapp, 'status', () => []);
  patch(whatsapp, 'credentialState', () => ({ usable: false, accountKey: account.adapterAccountId, registered: false }));
  patch(whatsapp, 'resolveAccountKey', () => account.adapterAccountId);
  patch(messageStore, 'listConversations', () => []);
  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  await assert.rejects(manager.connect(account.id), error => error.code === 'SQLITE_WRITE_FAILED');
  assert.equal(stopCalls, 1);
  assert.equal(failedRecordCalls, 1);
  assert.equal(manager.rawRuntime(account).state, 'error');
});



test('connected adapter event and connect return share one durable Saga finalizer', async t => {
  const { AccountManager } = accountManagerModule;
  const account = { id: 'wa-finalizer-race', platform: 'whatsapp', adapterAccountId: 'wa-finalizer-race', displayName: 'WA', identityLabel: 'WA', metadata: {}, paused: false, lifecycleState: 'active' };
  let saga = { operation_id: 'account-connect-finalizer-race', account_id: account.id, operation_type: 'connect', phase: 'adapter_connect_started', state: 'running' };
  let commitCalls = 0;
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });
  patch(accountLifecycleSaga, 'latest', () => ({ ...saga }));
  patch(accountLifecycleSaga, 'get', () => ({ ...saga }));
  patch(accountLifecycleSaga, 'setPhase', async (_operationId, expected, next) => {
    if (saga.phase !== expected || !['running','compensating'].includes(saga.state)) {
      throw Object.assign(new Error('stale'), { code: 'ACCOUNT_SAGA_STALE_TRANSITION' });
    }
    saga = { ...saga, phase: next };
    return { ...saga };
  });
  patch(accountLifecycleSaga, 'finish', async (_operationId, state) => {
    saga = { ...saga, phase: 'finished', state };
    return { updated: true, saga: { ...saga } };
  });
  patch(accountLifecycleSaga, 'markCompensating', async () => { saga = { ...saga, phase: 'compensating', state: 'compensating' }; return { ...saga }; });
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'commitConnectedIdentityTx', async () => {
    commitCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 25));
    return account;
  });
  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  const runtime = { state: 'connected', user: { id: 'wa-finalizer-race', name: 'WA' } };
  const [eventResult, returnResult] = await Promise.all([
    manager.finalizeConnectedSagaFromRuntime(account, runtime, { source: 'adapter-event' }),
    manager.finalizeConnectedSagaFromRuntime(account, runtime, { source: 'connect-return' })
  ]);
  assert.equal(commitCalls, 1);
  assert.equal(saga.state, 'succeeded');
  assert.equal(eventResult.saga.state, 'succeeded');
  assert.equal(returnResult.saga.state, 'succeeded');
});

test('runtime shutdown stops adapters without persisting a user pause or poisoning next-start auto-connect', async t => {
  const { AccountManager } = accountManagerModule;
  const account = {
    id: 'wa-shutdown',
    platform: 'whatsapp',
    adapterAccountId: 'wa-shutdown',
    displayName: 'WA',
    identityLabel: 'WA',
    metadata: {},
    paused: false,
    autoReconnect: true,
    notificationsEnabled: true,
    lifecycleState: 'active'
  };
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });

  let stopCalls = 0;
  let updateCalls = 0;
  const auditEvents = [];
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'getRaw', () => account);
  patch(accountStore, 'list', () => [account]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [account], defaults: {}, bindings: {}, audit: [] }));
  patch(accountStore, 'update', async (_id, patchValue) => { updateCalls += 1; Object.assign(account, patchValue); return account; });
  patch(accountStore, 'record', async event => { auditEvents.push(event); return {}; });
  patch(whatsapp, 'stop', async (_account, logout) => { stopCalls += 1; assert.equal(logout, false); return { stopped: true }; });
  patch(whatsapp, 'status', () => []);
  patch(whatsapp, 'credentialState', () => ({ usable: true, accountKey: account.adapterAccountId, registered: true }));
  patch(whatsapp, 'resolveAccountKey', () => account.adapterAccountId);
  patch(messageStore, 'listConversations', () => []);

  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  await manager.shutdown('desktop-exit');

  assert.equal(stopCalls, 1);
  assert.equal(updateCalls, 0);
  assert.equal(account.paused, false);
  assert.deepEqual(auditEvents, []);
  assert.equal(accountLifecycle.eligibility(account, { manual: false }).eligible, true);
});

test('server startup schedules immediate account recovery only when auto-connect is enabled', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /runtimeSettings\.read\(\)\.autoConnectAccounts/);
  assert.match(source, /runtimeRecovery\.scheduleRecovery\('startup-auto-connect',\s*250\)/);
});
