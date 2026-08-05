'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');

const ACCOUNT_KEY = 'whatsapp-auth-account:account-1';
const ACCOUNT_ID = 'account-1';
const EPOCH = 1;
const GENERATION = 7;
const SOCKET_TOKEN = 'socket-token-generation-7';
const AT = '2026-08-05T00:00:00.000Z';

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function loadRepositoryModule() {
  try {
    return require('../repositories/whatsappAuthStateRepository');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappAuthStateRepository')) {
      assert.fail('generation-fenced encrypted whatsappAuthStateRepository production module is missing');
    }
    throw error;
  }
}

function createRepository(repositoryModule, options) {
  const input = Object.freeze({
    storeProvider: () => options.store,
    cipher: options.cipher,
    clock: () => AT,
    faultInjector: options.faultInjector || null
  });
  if (typeof repositoryModule.createWhatsAppAuthStateRepository === 'function') {
    return repositoryModule.createWhatsAppAuthStateRepository(input);
  }
  if (typeof repositoryModule.WhatsAppAuthStateRepository === 'function') {
    return new repositoryModule.WhatsAppAuthStateRepository(input);
  }
  if (typeof repositoryModule === 'function') {
    return new repositoryModule(input);
  }
  assert.fail('whatsappAuthStateRepository must export a factory or class');
}

function withFixture(callback, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-auth-repository-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({
    dbPath,
    ownershipHeartbeatMs: 60000,
    ownershipStaleMs: 120000
  });
  const cipher = options.cipher || createWhatsAppAuthCipher({
    key: Buffer.alloc(32, 0x44),
    keyVersion: 1
  });
  try {
    store.upsertAccount({
      id: ACCOUNT_ID,
      platform: 'whatsapp',
      adapterAccountId: 'device-1'
    });
    seedActiveAccount(store, cipher, options.seed || {});
    return callback({ root, dbPath, store, cipher });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function aad(recordType, extra = {}) {
  return {
    schemaVersion: 23,
    accountKey: ACCOUNT_KEY,
    accountId: ACCOUNT_ID,
    currentEpoch: EPOCH,
    ...(recordType === 'AUTH_KEY' ? {
      category: extra.category,
      keyId: extra.keyId
    } : {})
  };
}

function seedActiveAccount(store, cipher, overrides = {}) {
  const creds = overrides.creds || {
    registered: true,
    me: { id: '15551234567:1@s.whatsapp.net' },
    noiseKey: { private: 'not-plaintext-in-db' }
  };
  const envelope = cipher.encrypt('AUTH_CREDS', aad('AUTH_CREDS'), encode(creds));
  store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
    account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
    creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
    identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
    logged_out_at,quarantine_reason
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ACCOUNT_KEY,
    ACCOUNT_ID,
    EPOCH,
    overrides.state || 'ACTIVE',
    envelope.cipherVersion,
    envelope.keyVersion,
    envelope.nonce,
    envelope.ciphertext,
    envelope.authTag,
    envelope.ciphertextSha256,
    creds.registered ? 1 : 0,
    cipher.hmacIndex('IDENTITY_JID', creds.me.id),
    overrides.writerGeneration ?? GENERATION,
    overrides.socketToken ?? SOCKET_TOKEN,
    AT,
    AT,
    '',
    overrides.quarantineReason || ''
  );
  return creds;
}

function writer(overrides = {}) {
  return {
    accountKey: ACCOUNT_KEY,
    expectedEpoch: EPOCH,
    expectedWriterGeneration: GENERATION,
    expectedSocketToken: SOCKET_TOKEN,
    ...overrides
  };
}

function rawAccount(store) {
  return store.db.prepare(`SELECT state,current_epoch,writer_generation,writer_socket_token,
    creds_cipher_version,creds_key_version,creds_nonce,creds_ciphertext,creds_auth_tag,
    creds_ciphertext_sha256,registered,identity_jid_hmac,logged_out_at,quarantine_reason
    FROM whatsapp_auth_accounts WHERE account_key=?`).get(ACCOUNT_KEY);
}

function rawKeys(store) {
  return store.db.prepare(`SELECT category,key_id,value_present,cipher_version,key_version,
    nonce,ciphertext,auth_tag,ciphertext_sha256,epoch
    FROM whatsapp_auth_keys WHERE account_key=? ORDER BY category,key_id`).all(ACCOUNT_KEY);
}

function assertRepositoryInterface(repository) {
  for (const method of [
    'loadAccount',
    'inspectAccount',
    'initializeAccount',
    'commitCreds',
    'getKeys',
    'setKeys',
    'markLoggedOut',
    'quarantine',
    'assertWriter',
    'importLegacySnapshot'
  ]) {
    assert.equal(typeof repository?.[method], 'function', method);
  }
}

test('encrypted auth repository loads through the cipher and exposes the frozen Task 2 interface', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    const repository = createRepository(repositoryModule, { store, cipher });
    assertRepositoryInterface(repository);

    const loaded = repository.loadAccount(ACCOUNT_KEY);
    assert.equal(loaded.accountKey, ACCOUNT_KEY);
    assert.equal(loaded.accountId, ACCOUNT_ID);
    assert.equal(loaded.currentEpoch, EPOCH);
    assert.equal(loaded.writerGeneration, GENERATION);
    assert.equal(loaded.writerSocketToken, SOCKET_TOKEN);
    assert.equal(loaded.state, 'ACTIVE');
    assert.equal(loaded.creds.registered, true);
    assert.equal(loaded.creds.me.id, '15551234567:1@s.whatsapp.net');

    const raw = rawAccount(store);
    const serializedRaw = JSON.stringify(raw);
    assert.equal(serializedRaw.includes('15551234567'), false);
    assert.equal(serializedRaw.includes('noiseKey'), false);
    assert.equal(Object.isFrozen(loaded), true);
  });
});

test('read-only auth authority projection exposes readiness without decrypting credential material', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    let decryptCalls = 0;
    const countingCipher = Object.freeze({
      encrypt: (...args) => cipher.encrypt(...args),
      decrypt(...args) {
        decryptCalls += 1;
        return cipher.decrypt(...args);
      },
      hmacIndex: (...args) => cipher.hmacIndex(...args),
      snapshot: () => cipher.snapshot()
    });
    const repository = createRepository(repositoryModule, { store, cipher: countingCipher });

    const active = repository.inspectAccount(ACCOUNT_KEY);
    assert.deepEqual(active, {
      accountKey: ACCOUNT_KEY,
      accountId: ACCOUNT_ID,
      currentEpoch: EPOCH,
      state: 'ACTIVE',
      registered: true,
      hasIdentity: true,
      credentialMaterialPresent: true,
      usable: true,
      reasonCode: ''
    });
    assert.equal(Object.isFrozen(active), true);
    assert.equal(decryptCalls, 0, 'readiness projection must not decrypt auth material');
    assert.equal(repository.inspectAccount('missing-auth-account'), null);

    repository.markLoggedOut({
      ...writer(),
      nextEpoch: EPOCH + 1,
      loggedOutAt: AT
    });
    const loggedOut = repository.inspectAccount(ACCOUNT_KEY);
    assert.equal(loggedOut.state, 'LOGGED_OUT');
    assert.equal(loggedOut.currentEpoch, EPOCH + 1);
    assert.equal(loggedOut.registered, false);
    assert.equal(loggedOut.hasIdentity, false);
    assert.equal(loggedOut.credentialMaterialPresent, false);
    assert.equal(loggedOut.usable, false);
    assert.equal(loggedOut.reasonCode, 'WHATSAPP_AUTH_LOGGED_OUT');
    assert.equal(decryptCalls, 0, 'terminal readiness projection must remain metadata-only');
  });
});

test('stale generation and socket token fail before encryption and leave ciphertext unchanged', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    let encryptCalls = 0;
    const countingCipher = Object.freeze({
      encrypt(...args) {
        encryptCalls += 1;
        return cipher.encrypt(...args);
      },
      decrypt: (...args) => cipher.decrypt(...args),
      hmacIndex: (...args) => cipher.hmacIndex(...args),
      snapshot: () => cipher.snapshot()
    });
    const repository = createRepository(repositoryModule, { store, cipher: countingCipher });
    const before = rawAccount(store);

    assert.throws(
      () => repository.commitCreds({
        ...writer({ expectedWriterGeneration: GENERATION - 1 }),
        creds: { registered: true, me: { id: 'stale@s.whatsapp.net' } }
      }),
      expectCode('WHATSAPP_AUTH_GENERATION_STALE')
    );
    assert.throws(
      () => repository.commitCreds({
        ...writer({ expectedSocketToken: 'stale-socket-token' }),
        creds: { registered: true, me: { id: 'stale@s.whatsapp.net' } }
      }),
      expectCode('WHATSAPP_AUTH_GENERATION_STALE')
    );

    assert.equal(encryptCalls, 0, 'writer fence must run before auth material encryption');
    assert.deepEqual(rawAccount(store), before);
  });
});

test('matching writer commits encrypted creds and keys set/delete atomically', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    const repository = createRepository(repositoryModule, { store, cipher });

    const nextCreds = {
      registered: true,
      me: { id: '15557654321:4@s.whatsapp.net' },
      signedIdentityKey: { private: 'must-never-be-plaintext' }
    };
    const committed = repository.commitCreds({
      ...writer(),
      creds: nextCreds
    });
    assert.equal(committed.committed, true);
    assert.equal(committed.changes, 1);

    const raw = rawAccount(store);
    assert.equal(JSON.stringify(raw).includes('15557654321'), false);
    assert.equal(JSON.stringify(raw).includes('signedIdentityKey'), false);
    assert.equal(repository.loadAccount(ACCOUNT_KEY).creds.me.id, nextCreds.me.id);

    const firstBatch = repository.setKeys({
      ...writer(),
      updates: {
        session: {
          'session-a': { chainKey: Buffer.from([1, 2, 3]), counter: 1 },
          'session-b': { chainKey: Buffer.from([4, 5, 6]), counter: 2 }
        },
        'sender-key': {
          'sender-a': { iteration: 9 }
        }
      }
    });
    assert.equal(firstBatch.committed, true);
    assert.equal(firstBatch.changes, 3);

    const loaded = repository.getKeys(
      ACCOUNT_KEY,
      EPOCH,
      'session',
      ['session-a', 'session-b', 'missing']
    );
    assert.deepEqual(Object.keys(loaded).sort(), ['session-a', 'session-b']);
    assert.equal(Buffer.isBuffer(loaded['session-a'].chainKey), true);
    assert.deepEqual([...loaded['session-a'].chainKey], [1, 2, 3]);

    const secondBatch = repository.setKeys({
      ...writer(),
      updates: {
        session: {
          'session-a': null,
          'session-b': { chainKey: Buffer.from([7, 8]), counter: 3 }
        }
      }
    });
    assert.equal(secondBatch.committed, true);
    assert.equal(secondBatch.changes, 2);

    const after = repository.getKeys(
      ACCOUNT_KEY,
      EPOCH,
      'session',
      ['session-a', 'session-b']
    );
    assert.equal(Object.prototype.hasOwnProperty.call(after, 'session-a'), false);
    assert.deepEqual([...after['session-b'].chainKey], [7, 8]);

    const rows = rawKeys(store);
    assert.equal(rows.length, 3);
    assert.equal(rows.find(row => row.key_id === 'session-a').value_present, 0);
    for (const row of rows.filter(candidate => candidate.value_present === 1)) {
      const serialized = JSON.stringify(row);
      assert.equal(serialized.includes('chainKey'), false);
      assert.equal(row.epoch, EPOCH);
      assert.equal(row.nonce.length, 12);
      assert.equal(row.auth_tag.length, 16);
    }
  });
});

test('logged-out and quarantined authority reject all credential writes without mutating rows', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    const repository = createRepository(repositoryModule, { store, cipher });
    const loggedOut = repository.markLoggedOut({
      ...writer(),
      nextEpoch: EPOCH + 1,
      loggedOutAt: AT
    });
    assert.equal(loggedOut.state, 'LOGGED_OUT');
    assert.equal(loggedOut.currentEpoch, EPOCH + 1);
    assert.equal(rawKeys(store).length, 0);

    const afterLogout = rawAccount(store);
    assert.throws(
      () => repository.commitCreds({
        ...writer({ expectedEpoch: EPOCH + 1 }),
        creds: { registered: true, me: { id: 'resurrection@s.whatsapp.net' } }
      }),
      expectCode('WHATSAPP_AUTH_STATE_NOT_ACTIVE')
    );
    assert.deepEqual(rawAccount(store), afterLogout);
  });

  withFixture(({ store, cipher }) => {
    const repository = createRepository(repositoryModule, { store, cipher });
    const result = repository.quarantine({
      ...writer(),
      reasonCode: 'OSS1A_TEST_QUARANTINE'
    });
    assert.equal(result.state, 'QUARANTINED');
    const before = rawAccount(store);
    assert.throws(
      () => repository.setKeys({
        ...writer(),
        updates: { session: { blocked: { value: 1 } } }
      }),
      expectCode('WHATSAPP_AUTH_STATE_NOT_ACTIVE')
    );
    assert.deepEqual(rawAccount(store), before);
    assert.equal(rawKeys(store).length, 0);
  });
});

require('./oss1aWhatsappAuthRepositoryCrashMatrix.test');
