'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const baileys = require('@whiskeysockets/baileys');

const ACCOUNT_ID = 'wa-state-store-account';
const ACCOUNT_KEY = 'whatsapp-auth-account:state-store-account';
const GENERATION = 11;
const SOCKET_TOKEN = 'state-store-socket-token-11';

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function loadStateStoreModule() {
  try {
    return require('../services/whatsappAuthStateStore');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappAuthStateStore')) {
      assert.fail('repository-backed whatsappAuthStateStore production module is missing');
    }
    throw error;
  }
}

function createStateStore(stateStoreModule, repository) {
  const options = Object.freeze({ repository, baileys });
  if (typeof stateStoreModule.createWhatsAppAuthStateStore === 'function') {
    return stateStoreModule.createWhatsAppAuthStateStore(options);
  }
  if (typeof stateStoreModule.WhatsAppAuthStateStore === 'function') {
    return new stateStoreModule.WhatsAppAuthStateStore(options);
  }
  if (typeof stateStoreModule === 'function') {
    return new stateStoreModule(options);
  }
  assert.fail('whatsappAuthStateStore must export a factory or class');
}

function createRepositoryFixture(options = {}) {
  const calls = {
    loadAccount: 0,
    initializeAccount: 0,
    assertWriter: 0,
    commitCreds: 0,
    getKeys: 0,
    setKeys: 0
  };
  let account = options.account || null;
  const keys = new Map();
  for (const [category, values] of Object.entries(options.keys || {})) {
    for (const [id, value] of Object.entries(values)) keys.set(`${category}\u0000${id}`, value);
  }
  const repository = Object.freeze({
    loadAccount(accountKey) {
      calls.loadAccount += 1;
      assert.equal(accountKey, ACCOUNT_KEY);
      return account;
    },
    initializeAccount(input) {
      calls.initializeAccount += 1;
      assert.equal(input.accountId, ACCOUNT_ID);
      assert.equal(input.accountKey, ACCOUNT_KEY);
      assert.equal(input.writerGeneration, GENERATION);
      assert.equal(input.socketToken, SOCKET_TOKEN);
      account = Object.freeze({
        accountId: input.accountId,
        accountKey: input.accountKey,
        currentEpoch: input.currentEpoch,
        state: 'ACTIVE',
        writerGeneration: input.writerGeneration,
        writerSocketToken: input.socketToken,
        creds: input.creds
      });
      return Object.freeze({ committed: true, changes: 1, ...account });
    },
    assertWriter(input) {
      calls.assertWriter += 1;
      assert.equal(input.accountKey, ACCOUNT_KEY);
      assert.equal(input.expectedEpoch, account.currentEpoch);
      assert.equal(input.expectedWriterGeneration, GENERATION);
      assert.equal(input.expectedSocketToken, SOCKET_TOKEN);
      if (options.assertWriterError) throw options.assertWriterError;
      return Object.freeze({
        accountKey: ACCOUNT_KEY,
        accountId: ACCOUNT_ID,
        currentEpoch: account.currentEpoch,
        state: account.state,
        writerGeneration: GENERATION,
        writerSocketToken: SOCKET_TOKEN
      });
    },
    commitCreds(input) {
      calls.commitCreds += 1;
      this.assertWriter(input);
      account = Object.freeze({ ...account, creds: input.creds });
      return Object.freeze({ committed: true, changes: 1 });
    },
    getKeys(accountKey, epoch, category, ids) {
      calls.getKeys += 1;
      assert.equal(accountKey, ACCOUNT_KEY);
      assert.equal(epoch, account.currentEpoch);
      const output = {};
      for (const id of ids) {
        const value = keys.get(`${category}\u0000${id}`);
        if (value != null) output[id] = value;
      }
      return output;
    },
    setKeys(input) {
      calls.setKeys += 1;
      this.assertWriter(input);
      for (const [category, categoryValues] of Object.entries(input.updates)) {
        for (const [id, value] of Object.entries(categoryValues)) {
          const key = `${category}\u0000${id}`;
          if (value == null) keys.delete(key);
          else keys.set(key, value);
        }
      }
      return Object.freeze({ committed: true, changes: 1 });
    }
  });
  return {
    repository,
    calls,
    readAccount: () => account,
    readKey: (category, id) => keys.get(`${category}\u0000${id}`)
  };
}

function openInput() {
  return Object.freeze({
    accountId: ACCOUNT_ID,
    accountKey: ACCOUNT_KEY,
    generation: GENERATION,
    socketToken: SOCKET_TOKEN
  });
}

test('empty account opens exactly one repository epoch using real Baileys initAuthCreds', async () => {
  const stateStoreModule = loadStateStoreModule();
  const fixture = createRepositoryFixture();
  const store = createStateStore(stateStoreModule, fixture.repository);

  const lease = await store.open(openInput());

  assert.equal(fixture.calls.loadAccount, 1);
  assert.equal(fixture.calls.initializeAccount, 1);
  assert.equal(fixture.calls.assertWriter >= 1, true);
  assert.equal(lease.epoch, 1);
  assert.equal(lease.state.creds.registered, false);
  assert.equal(typeof lease.state.keys.get, 'function');
  assert.equal(typeof lease.state.keys.set, 'function');
  assert.equal(typeof lease.saveCreds, 'function');
  assert.equal(typeof lease.close, 'function');
  assert.equal(Object.isFrozen(lease), true);

  const created = fixture.readAccount();
  assert.equal(created.currentEpoch, 1);
  assert.equal(created.creds, lease.state.creds, 'lease must use the initialized mutable creds object');
});

test('existing account restores Buffer values and AppStateSyncKeyData through the real Baileys contract', async () => {
  const stateStoreModule = loadStateStoreModule();
  const creds = baileys.initAuthCreds();
  const appStateObject = {
    keyData: Buffer.from([1, 2, 3, 4]),
    fingerprint: { rawId: 7, currentIndex: 8, deviceIndexes: [9] },
    timestamp: 10
  };
  const fixture = createRepositoryFixture({
    account: Object.freeze({
      accountId: ACCOUNT_ID,
      accountKey: ACCOUNT_KEY,
      currentEpoch: 4,
      state: 'ACTIVE',
      writerGeneration: GENERATION,
      writerSocketToken: SOCKET_TOKEN,
      creds
    }),
    keys: {
      session: { 'session-a': Buffer.from([5, 6, 7]) },
      'app-state-sync-key': { 'app-key-a': appStateObject }
    }
  });
  const store = createStateStore(stateStoreModule, fixture.repository);
  const lease = await store.open(openInput());

  assert.equal(fixture.calls.initializeAccount, 0);
  assert.equal(lease.epoch, 4);
  assert.equal(lease.state.creds, creds);

  const sessions = await lease.state.keys.get('session', ['session-a', 'missing']);
  assert.deepEqual(Object.keys(sessions), ['session-a']);
  assert.equal(Buffer.isBuffer(sessions['session-a']) || sessions['session-a'] instanceof Uint8Array, true);
  assert.deepEqual([...sessions['session-a']], [5, 6, 7]);

  const appKeys = await lease.state.keys.get('app-state-sync-key', ['app-key-a']);
  const restored = appKeys['app-key-a'];
  assert.ok(restored);
  assert.notEqual(restored, appStateObject, 'app-state key must be restored through proto.fromObject');
  assert.equal(typeof restored.toJSON, 'function');
  assert.deepEqual([...restored.keyData], [1, 2, 3, 4]);
});

test('saveCreds persists the current mutable creds snapshot and keys.set preserves one repository batch', async () => {
  const stateStoreModule = loadStateStoreModule();
  const creds = baileys.initAuthCreds();
  const fixture = createRepositoryFixture({
    account: Object.freeze({
      accountId: ACCOUNT_ID,
      accountKey: ACCOUNT_KEY,
      currentEpoch: 2,
      state: 'ACTIVE',
      writerGeneration: GENERATION,
      writerSocketToken: SOCKET_TOKEN,
      creds
    })
  });
  const store = createStateStore(stateStoreModule, fixture.repository);
  const lease = await store.open(openInput());

  lease.state.creds.registered = true;
  lease.state.creds.me = { id: '15551234567:2@s.whatsapp.net', name: 'Yance' };
  await lease.saveCreds({ ignored: 'event-payload-must-not-be-authority' });

  assert.equal(fixture.calls.commitCreds, 1);
  assert.equal(fixture.readAccount().creds, lease.state.creds);
  assert.equal(fixture.readAccount().creds.registered, true);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.readAccount().creds, 'ignored'), false);

  const batch = {
    session: {
      'session-a': Buffer.from([8, 9]),
      'session-delete': null
    },
    'sender-key': {
      'sender-a': { iteration: 3 }
    }
  };
  await lease.state.keys.set(batch);
  assert.equal(fixture.calls.setKeys, 1);
  assert.deepEqual([...fixture.readKey('session', 'session-a')], [8, 9]);
  assert.equal(fixture.readKey('session', 'session-delete'), undefined);
  assert.deepEqual(fixture.readKey('sender-key', 'sender-a'), { iteration: 3 });
});

test('lease close is idempotent and permanently fences every subsequent read or write', async () => {
  const stateStoreModule = loadStateStoreModule();
  const fixture = createRepositoryFixture({
    account: Object.freeze({
      accountId: ACCOUNT_ID,
      accountKey: ACCOUNT_KEY,
      currentEpoch: 3,
      state: 'ACTIVE',
      writerGeneration: GENERATION,
      writerSocketToken: SOCKET_TOKEN,
      creds: baileys.initAuthCreds()
    })
  });
  const store = createStateStore(stateStoreModule, fixture.repository);
  const lease = await store.open(openInput());

  const firstClose = await lease.close();
  const secondClose = await lease.close();
  assert.notEqual(firstClose, false, 'first close must transition the lease');
  assert.equal(secondClose, false, 'repeated close must be a no-op');

  await assert.rejects(
    Promise.resolve().then(() => lease.saveCreds()),
    expectCode('WHATSAPP_AUTH_LEASE_CLOSED')
  );
  await assert.rejects(
    Promise.resolve().then(() => lease.state.keys.get('session', ['session-a'])),
    expectCode('WHATSAPP_AUTH_LEASE_CLOSED')
  );
  await assert.rejects(
    Promise.resolve().then(() => lease.state.keys.set({ session: { 'session-a': {} } })),
    expectCode('WHATSAPP_AUTH_LEASE_CLOSED')
  );
  assert.equal(fixture.calls.commitCreds, 0);
  assert.equal(fixture.calls.getKeys, 0);
  assert.equal(fixture.calls.setKeys, 0);
});

test('writer rejection is propagated before any AuthenticationState lease is published', async () => {
  const stateStoreModule = loadStateStoreModule();
  const stale = Object.assign(new Error('writer generation is stale'), {
    code: 'WHATSAPP_AUTH_GENERATION_STALE'
  });
  const fixture = createRepositoryFixture({
    account: Object.freeze({
      accountId: ACCOUNT_ID,
      accountKey: ACCOUNT_KEY,
      currentEpoch: 5,
      state: 'ACTIVE',
      writerGeneration: GENERATION + 1,
      writerSocketToken: 'replacement-token',
      creds: baileys.initAuthCreds()
    }),
    assertWriterError: stale
  });
  const store = createStateStore(stateStoreModule, fixture.repository);

  await assert.rejects(store.open(openInput()), expectCode('WHATSAPP_AUTH_GENERATION_STALE'));
  assert.equal(fixture.calls.initializeAccount, 0);
  assert.equal(fixture.calls.commitCreds, 0);
  assert.equal(fixture.calls.setKeys, 0);
});
