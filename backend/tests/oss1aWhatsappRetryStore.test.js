'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');
const { createWhatsAppAuthStateRepository } = require('../repositories/whatsappAuthStateRepository');
const { createWhatsAppMessageRetryStore } = require('../services/whatsappMessageRetryStore');

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-retry-store-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db'), ownershipHeartbeatMs: 60000, ownershipStaleMs: 120000 });
  const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x58), keyVersion: 1 });
  let now = Date.parse('2026-08-05T00:00:00.000Z');
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    const authRepository = createWhatsAppAuthStateRepository({
      storeProvider: () => store,
      cipher,
      clock: () => new Date(now).toISOString()
    });
    authRepository.initializeAccount({
      accountKey: 'whatsapp-auth-account:account-1',
      accountId: 'account-1',
      currentEpoch: 1,
      writerGeneration: 1,
      socketToken: 'socket-1',
      creds: { registered: true, me: { id: '15550001111:1@s.whatsapp.net' } }
    });
    return callback({ store, cipher, clock: () => now, advance: ms => { now += ms; } });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('retry counters persist across store instances without plaintext cache keys', () => {
  fixture(({ store, cipher, clock }) => {
    const options = { accountKey: 'whatsapp-auth-account:account-1', cipher, storeProvider: () => store, clock };
    const first = createWhatsAppMessageRetryStore(options);
    assert.equal(first.set('message-retry:secret-id', 3), 3);
    assert.equal(first.get('message-retry:secret-id'), 3);

    const restarted = createWhatsAppMessageRetryStore(options);
    assert.equal(restarted.get('message-retry:secret-id'), 3);
    assert.equal(restarted.snapshot().persistedCounters, 1);

    const row = store.db.prepare('SELECT cache_key_hmac,value_json FROM whatsapp_message_retry_counters').get();
    assert.match(row.cache_key_hmac, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(row).includes('secret-id'), false);
    assert.equal(row.value_json, '3');
  });
});

test('retry TTL cleanup, delete and account-scoped flush are durable', () => {
  fixture(({ store, cipher, clock, advance }) => {
    const retry = createWhatsAppMessageRetryStore({
      accountKey: 'whatsapp-auth-account:account-1', cipher, storeProvider: () => store, clock, defaultTtlMs: 2000
    });
    retry.set('a', 1);
    retry.set('b', 2, 5000);
    advance(2500);
    assert.equal(retry.get('a'), undefined);
    assert.equal(retry.get('b'), 2);
    assert.equal(retry.del('b'), true);
    assert.equal(retry.get('b'), undefined);
    retry.set('c', 4);
    retry.set('d', 5);
    assert.equal(retry.flushAll(), 2);
    assert.equal(retry.snapshot().persistedCounters, 0);
  });
});

test('retry store rejects negative, fractional and non-numeric counters', () => {
  fixture(({ store, cipher, clock }) => {
    const retry = createWhatsAppMessageRetryStore({ accountKey: 'whatsapp-auth-account:account-1', cipher, storeProvider: () => store, clock });
    for (const value of [-1, 1.5, 'not-a-counter']) {
      assert.throws(() => retry.set('key', value), error => error?.code === 'WHATSAPP_RETRY_STORE_VALUE_INVALID');
    }
  });
});



test('retry persistence is repository-owned and the Baileys store is a thin capability adapter', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../services/whatsappMessageRetryStore.js'), 'utf8');
  const repositorySource = fs.readFileSync(path.join(__dirname, '../repositories/whatsappMessageRetryRepository.js'), 'utf8');
  assert.match(serviceSource, /createWhatsAppMessageRetryRepository/u);
  assert.doesNotMatch(serviceSource, /whatsapp_message_retry_counters/u);
  assert.doesNotMatch(serviceSource, /\.prepare\(/u);
  assert.match(repositorySource, /whatsapp_message_retry_counters/u);
  assert.match(repositorySource, /CACHE_KEY/u);
  assert.match(repositorySource, /store\.transaction/u);
});
