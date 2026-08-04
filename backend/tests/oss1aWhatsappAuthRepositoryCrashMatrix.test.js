'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');

const ACCOUNT_KEY = 'whatsapp-auth-account:crash-account';
const ACCOUNT_ID = 'crash-account';
const EPOCH = 1;
const GENERATION = 3;
const SOCKET_TOKEN = 'crash-socket-token';
const AT = '2026-08-05T00:00:00.000Z';

function loadRepositoryModule() {
  return require('../repositories/whatsappAuthStateRepository');
}

function createRepository(repositoryModule, options) {
  const input = {
    storeProvider: () => options.store,
    cipher: options.cipher,
    clock: () => AT,
    faultInjector: options.faultInjector
  };
  if (typeof repositoryModule.createWhatsAppAuthStateRepository === 'function') {
    return repositoryModule.createWhatsAppAuthStateRepository(input);
  }
  if (typeof repositoryModule.WhatsAppAuthStateRepository === 'function') {
    return new repositoryModule.WhatsAppAuthStateRepository(input);
  }
  return new repositoryModule(input);
}

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-auth-repository-crash-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({
    dbPath,
    ownershipHeartbeatMs: 60000,
    ownershipStaleMs: 120000
  });
  const cipher = createWhatsAppAuthCipher({
    key: Buffer.alloc(32, 0x63),
    keyVersion: 1
  });
  try {
    store.upsertAccount({
      id: ACCOUNT_ID,
      platform: 'whatsapp',
      adapterAccountId: 'crash-device'
    });
    const creds = { registered: true, me: { id: 'crash@s.whatsapp.net' } };
    const envelope = cipher.encrypt('AUTH_CREDS', {
      schemaVersion: 23,
      accountKey: ACCOUNT_KEY,
      accountId: ACCOUNT_ID,
      currentEpoch: EPOCH
    }, Buffer.from(JSON.stringify(creds), 'utf8'));
    store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
      account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
      creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
      identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
      logged_out_at,quarantine_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ACCOUNT_KEY, ACCOUNT_ID, EPOCH, 'ACTIVE',
      envelope.cipherVersion, envelope.keyVersion, envelope.nonce, envelope.ciphertext,
      envelope.authTag, envelope.ciphertextSha256, 1,
      cipher.hmacIndex('IDENTITY_JID', creds.me.id),
      GENERATION, SOCKET_TOKEN, AT, AT, '', ''
    );
    return callback({ store, cipher });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function writer() {
  return {
    accountKey: ACCOUNT_KEY,
    expectedEpoch: EPOCH,
    expectedWriterGeneration: GENERATION,
    expectedSocketToken: SOCKET_TOKEN
  };
}

function rows(store) {
  return store.db.prepare(`SELECT category,key_id,value_present,ciphertext_sha256
    FROM whatsapp_auth_keys WHERE account_key=? ORDER BY category,key_id`).all(ACCOUNT_KEY);
}

function accountHash(store) {
  return store.db.prepare(`SELECT creds_ciphertext_sha256,identity_jid_hmac,registered,updated_at
    FROM whatsapp_auth_accounts WHERE account_key=?`).get(ACCOUNT_KEY);
}

for (const faultPoint of ['after-key-write:1', 'before-key-commit']) {
  test(`keys.set rolls back the complete encrypted batch at ${faultPoint}`, () => {
    const repositoryModule = loadRepositoryModule();
    withFixture(({ store, cipher }) => {
      const baseline = createRepository(repositoryModule, { store, cipher });
      baseline.setKeys({
        ...writer(),
        updates: {
          session: {
            original: { value: 'old' }
          }
        }
      });
      const before = rows(store);
      const injected = Object.assign(new Error(`injected ${faultPoint}`), {
        code: 'OSS1A_AUTH_REPOSITORY_FAULT_INJECTED'
      });
      const repository = createRepository(repositoryModule, {
        store,
        cipher,
        faultInjector(point) {
          if (point === faultPoint) throw injected;
        }
      });

      assert.throws(
        () => repository.setKeys({
          ...writer(),
          updates: {
            session: {
              original: { value: 'new' },
              second: { value: 'must-not-commit' }
            },
            'sender-key': {
              third: { value: 'must-not-commit' }
            }
          }
        }),
        expectCode('OSS1A_AUTH_REPOSITORY_FAULT_INJECTED')
      );
      assert.deepEqual(rows(store), before);
    });
  });
}

test('creds commit fault after SQL update rolls back ciphertext, HMAC and registered projection', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    const before = accountHash(store);
    const injected = Object.assign(new Error('injected creds fault'), {
      code: 'OSS1A_AUTH_REPOSITORY_FAULT_INJECTED'
    });
    const repository = createRepository(repositoryModule, {
      store,
      cipher,
      faultInjector(point) {
        if (point === 'after-creds-write') throw injected;
      }
    });

    assert.throws(
      () => repository.commitCreds({
        ...writer(),
        creds: {
          registered: false,
          me: { id: 'new-identity@s.whatsapp.net' },
          privateMaterial: 'must-not-commit'
        }
      }),
      expectCode('OSS1A_AUTH_REPOSITORY_FAULT_INJECTED')
    );
    assert.deepEqual(accountHash(store), before);
  });
});

test('writer promotion makes all prior writer calls stale with zero changes', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    const repository = createRepository(repositoryModule, { store, cipher });
    const promoted = store.db.prepare(`UPDATE whatsapp_auth_accounts
      SET writer_generation=?,writer_socket_token=?,updated_at=?
      WHERE account_key=? AND current_epoch=? AND writer_generation=? AND writer_socket_token=?`).run(
      GENERATION + 1,
      'replacement-socket-token',
      AT,
      ACCOUNT_KEY,
      EPOCH,
      GENERATION,
      SOCKET_TOKEN
    );
    assert.equal(Number(promoted.changes), 1);
    const beforeRows = rows(store);
    const beforeAccount = accountHash(store);

    assert.throws(
      () => repository.setKeys({
        ...writer(),
        updates: { session: { stale: { value: 1 } } }
      }),
      expectCode('WHATSAPP_AUTH_GENERATION_STALE')
    );
    assert.throws(
      () => repository.commitCreds({
        ...writer(),
        creds: { registered: true, me: { id: 'stale@s.whatsapp.net' } }
      }),
      expectCode('WHATSAPP_AUTH_GENERATION_STALE')
    );

    assert.deepEqual(rows(store), beforeRows);
    assert.deepEqual(accountHash(store), beforeAccount);
  });
});
