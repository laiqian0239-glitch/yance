from pathlib import Path
import textwrap

INDEX_REPOSITORY = textwrap.dedent(r'''
'use strict';

const crypto = require('node:crypto');
const { getPrimaryStoreCapability } = require('./storeProvider');
const whatsappIdentityAuthority = require('../services/whatsappIdentityAuthority');

const SCHEMA_VERSION = 23;
const PRIVATE = new WeakMap();

function repositoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppMessageKeyIndexRepositoryError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw repositoryError('WHATSAPP_MESSAGE_KEY_INPUT_INVALID', `${field} is invalid`, { field });
  return text;
}

function normalizeForStorage(value, seen = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains a non-finite number');
    return value;
  }
  if (typeof value === 'bigint') return { $type: 'BigInt', data: value.toString(10) };
  if (typeof value !== 'object') throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains an unsupported value');
  if (seen.has(value)) throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains a cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeForStorage(item, seen));
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) output[key] = normalizeForStorage(value[key], seen);
    return output;
  } finally {
    seen.delete(value);
  }
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== 'object') return value;
  if (value.$type === 'Buffer' && typeof value.data === 'string') return Buffer.from(value.data, 'base64');
  if (value.$type === 'BigInt' && typeof value.data === 'string') return BigInt(value.data);
  const output = {};
  for (const [key, candidate] of Object.entries(value)) output[key] = revive(candidate);
  return output;
}

function encode(value) {
  return Buffer.from(JSON.stringify(normalizeForStorage(value)), 'utf8');
}

function decode(buffer) {
  try { return revive(JSON.parse(Buffer.from(buffer).toString('utf8'))); }
  catch (_) { throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_DECODE_FAILED', 'Encrypted raw message payload could not be decoded'); }
}

function hashRawMessage(value) {
  return crypto.createHash('sha256').update(encode(value)).digest('hex');
}

function defaultRemoteJidNormalizer(accountId, value) {
  const raw = nonEmptyString(value, 'remoteJid').toLowerCase();
  try {
    const resolved = whatsappIdentityAuthority.resolve(accountId, [raw]);
    const canonical = String(resolved?.canonicalJid || '').trim().toLowerCase();
    if (canonical) return canonical;
  } catch (_) {}
  const [local, domain = ''] = raw.split('@');
  return `${local.replace(/:\d+$/u, '')}@${domain}`;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw repositoryError('WHATSAPP_MESSAGE_KEY_REPOSITORY_INVALID', 'Repository private state is unavailable');
  return state;
}

function storeFor(instance) {
  const state = stateFor(instance);
  const store = state.storeProvider();
  if (!store?.db || typeof store.transaction !== 'function') {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_STORE_UNAVAILABLE', 'Primary Store capability is unavailable');
  }
  return store;
}

function cipherFor(instance) {
  const cipher = stateFor(instance).cipherProvider();
  if (!cipher || typeof cipher.encrypt !== 'function' || typeof cipher.decrypt !== 'function' || typeof cipher.hmacIndex !== 'function') {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_CIPHER_UNAVAILABLE', 'WhatsApp auth cipher capability is unavailable');
  }
  return cipher;
}

function requireTransaction(store) {
  if (store?.db?.inTransaction !== true) {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_TRANSACTION_REQUIRED', 'Canonical message index writes require the canonical message transaction');
  }
}

function keyInput(instance, input = {}) {
  const state = stateFor(instance);
  const accountId = nonEmptyString(input.accountId, 'accountId');
  const remoteJid = state.remoteJidNormalizer(accountId, input.remoteJid);
  const messageId = nonEmptyString(input.id ?? input.messageId, 'messageId');
  const participant = String(input.participant || '').trim();
  const canonicalParticipant = participant ? state.remoteJidNormalizer(accountId, participant) : '';
  return Object.freeze({
    accountId,
    remoteJid,
    messageId,
    participant: canonicalParticipant,
    fromMe: input.fromMe === true
  });
}

function keyFromMessage(instance, message = {}) {
  const rawMeta = message.rawMeta || message.raw || {};
  return keyInput(instance, {
    accountId: message.sourceAccountId || message.accountId,
    remoteJid: rawMeta.canonicalJid || rawMeta.remoteJid || message.chatJid,
    id: message.externalMessageId || rawMeta.messageId || message.id,
    participant: rawMeta.participant || message.participant || '',
    fromMe: message.fromMe === true || message.direction === 'outbound'
  });
}

function publicLookupRow(row) {
  return Object.freeze({
    canonicalMessageId: String(row.canonical_message_id),
    accountId: String(row.account_id),
    fromMe: Boolean(row.from_me),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  });
}

class WhatsAppMessageKeyIndexRepository {
  constructor(options = {}) {
    const cipherProvider = options.cipherProvider || (() => options.cipher);
    const storeProvider = options.storeProvider || getPrimaryStoreCapability;
    const remoteJidNormalizer = options.remoteJidNormalizer || defaultRemoteJidNormalizer;
    if (typeof cipherProvider !== 'function' || typeof storeProvider !== 'function' || typeof remoteJidNormalizer !== 'function') {
      throw repositoryError('WHATSAPP_MESSAGE_KEY_REPOSITORY_CONFIGURATION_INVALID', 'Repository dependencies are invalid');
    }
    PRIVATE.set(this, Object.freeze({ cipherProvider, storeProvider, remoteJidNormalizer, clock: options.clock || (() => new Date().toISOString()) }));
    Object.freeze(this);
  }

  upsertWithinTransaction(store, message = {}) {
    requireTransaction(store);
    const canonicalMessageId = nonEmptyString(message.id || message.dedupeKey, 'canonicalMessageId');
    const accountId = nonEmptyString(message.sourceAccountId || message.accountId, 'accountId');
    const revoked = message.revoked === true || String(message.type || message.messageType || '').toLowerCase() === 'revoke';
    const rawMessage = message.rawMessage;
    store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
    store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
    if (revoked || !rawMessage || typeof rawMessage !== 'object') {
      return Object.freeze({ indexed: false, canonicalMessageId, reasonCode: revoked ? 'WHATSAPP_MESSAGE_REVOKED' : 'WHATSAPP_RAW_MESSAGE_ABSENT' });
    }

    const key = keyFromMessage(this, message);
    const cipher = cipherFor(this);
    const rawMessageSha256 = hashRawMessage(rawMessage);
    const plaintext = encode({ rawMessage, rawMessageSha256 });
    let envelope;
    try {
      envelope = cipher.encrypt('RETRY_PAYLOAD', {
        schemaVersion: SCHEMA_VERSION,
        accountId,
        canonicalMessageId
      }, plaintext);
    } finally {
      plaintext.fill(0);
    }
    const state = stateFor(this);
    const at = String(state.clock());
    store.db.prepare(`INSERT INTO whatsapp_message_retry_payloads(
      canonical_message_id,account_id,cipher_version,key_version,nonce,ciphertext,
      auth_tag,ciphertext_sha256,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      canonicalMessageId, accountId, envelope.cipherVersion, envelope.keyVersion,
      envelope.nonce, envelope.ciphertext, envelope.authTag, envelope.ciphertextSha256,
      at, at
    );
    store.db.prepare(`INSERT INTO whatsapp_message_key_index(
      account_id,remote_jid_hmac,message_id_hmac,from_me,participant_hmac,
      canonical_message_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : '',
      canonicalMessageId,
      at,
      at
    );
    return Object.freeze({ indexed: true, canonicalMessageId, rawMessageSha256, key: Object.freeze({ ...key }) });
  }

  deleteWithinTransaction(store, canonicalMessageId) {
    requireTransaction(store);
    const id = nonEmptyString(canonicalMessageId, 'canonicalMessageId');
    const index = store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(id);
    const payload = store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(id);
    return Object.freeze({ deleted: Number(index.changes) + Number(payload.changes), canonicalMessageId: id });
  }

  lookup(input = {}) {
    const store = storeFor(this);
    const cipher = cipherFor(this);
    const key = keyInput(this, input);
    const row = store.db.prepare(`SELECT account_id,canonical_message_id,from_me,created_at,updated_at
      FROM whatsapp_message_key_index
      WHERE account_id=? AND remote_jid_hmac=? AND message_id_hmac=?
        AND from_me=? AND participant_hmac=?`).get(
      key.accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : ''
    );
    if (!row) return undefined;
    const canonical = store.getMessage(String(row.canonical_message_id));
    if (!canonical) return undefined;
    if (canonical.revoked === true || String(canonical.type || canonical.messageType || '').toLowerCase() === 'revoke') return undefined;
    const payload = store.db.prepare(`SELECT canonical_message_id,account_id,cipher_version,key_version,
      nonce,ciphertext,auth_tag,ciphertext_sha256 FROM whatsapp_message_retry_payloads
      WHERE canonical_message_id=?`).get(String(row.canonical_message_id));
    if (!payload) return undefined;
    const plaintext = cipher.decrypt('RETRY_PAYLOAD', {
      schemaVersion: SCHEMA_VERSION,
      accountId: String(payload.account_id),
      canonicalMessageId: String(payload.canonical_message_id)
    }, {
      cipherVersion: Number(payload.cipher_version),
      keyVersion: Number(payload.key_version),
      nonce: payload.nonce,
      ciphertext: payload.ciphertext,
      authTag: payload.auth_tag,
      ciphertextSha256: String(payload.ciphertext_sha256)
    });
    let decoded;
    try { decoded = decode(plaintext); }
    finally { plaintext.fill(0); }
    const payloadHash = hashRawMessage(decoded.rawMessage);
    const canonicalHash = canonical.rawMessage && typeof canonical.rawMessage === 'object'
      ? hashRawMessage(canonical.rawMessage)
      : '';
    if (decoded.rawMessageSha256 !== payloadHash || !canonicalHash || canonicalHash !== payloadHash) {
      throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH', 'Canonical raw message and encrypted retry payload differ', {
        canonicalMessageId: String(row.canonical_message_id)
      });
    }
    return decoded.rawMessage;
  }

  inspect(input = {}) {
    const store = storeFor(this);
    const key = keyInput(this, input);
    const cipher = cipherFor(this);
    const row = store.db.prepare(`SELECT account_id,canonical_message_id,from_me,created_at,updated_at
      FROM whatsapp_message_key_index WHERE account_id=? AND remote_jid_hmac=?
      AND message_id_hmac=? AND from_me=? AND participant_hmac=?`).get(
      key.accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : ''
    );
    return row ? publicLookupRow(row) : null;
  }
}

Object.freeze(WhatsAppMessageKeyIndexRepository.prototype);

function createWhatsAppMessageKeyIndexRepository(options = {}) {
  return new WhatsAppMessageKeyIndexRepository(options);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  WhatsAppMessageKeyIndexRepository,
  createWhatsAppMessageKeyIndexRepository,
  defaultRemoteJidNormalizer,
  hashRawMessage
});
''').lstrip()

RETRY_STORE = textwrap.dedent(r'''
'use strict';

const { getPrimaryStoreCapability } = require('../repositories/storeProvider');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRIVATE = new WeakMap();

function retryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppMessageRetryStoreError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw retryError('WHATSAPP_RETRY_STORE_INPUT_INVALID', `${field} is invalid`, { field });
  return text;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw retryError('WHATSAPP_RETRY_STORE_INVALID', 'Retry store private state is unavailable');
  return state;
}

function storeFor(instance) {
  const store = stateFor(instance).storeProvider();
  if (!store?.db || typeof store.transaction !== 'function') throw retryError('WHATSAPP_RETRY_STORE_PRIMARY_STORE_UNAVAILABLE', 'Primary Store capability is unavailable');
  return store;
}

function cipherFor(instance) {
  const cipher = stateFor(instance).cipherProvider();
  if (!cipher || typeof cipher.hmacIndex !== 'function') throw retryError('WHATSAPP_RETRY_STORE_CIPHER_UNAVAILABLE', 'WhatsApp auth cipher capability is unavailable');
  return cipher;
}

function normalizeValue(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw retryError('WHATSAPP_RETRY_STORE_VALUE_INVALID', 'Retry counter must be a non-negative safe integer');
  return number;
}

class WhatsAppMessageRetryStore {
  constructor(options = {}) {
    const accountKey = nonEmptyString(options.accountKey, 'accountKey');
    const cipherProvider = options.cipherProvider || (() => options.cipher);
    const storeProvider = options.storeProvider || getPrimaryStoreCapability;
    if (typeof cipherProvider !== 'function' || typeof storeProvider !== 'function') throw retryError('WHATSAPP_RETRY_STORE_CONFIGURATION_INVALID', 'Retry store dependencies are invalid');
    PRIVATE.set(this, Object.freeze({
      accountKey,
      cipherProvider,
      storeProvider,
      clock: options.clock || (() => Date.now()),
      defaultTtlMs: Math.max(1000, Number(options.defaultTtlMs || DEFAULT_TTL_MS))
    }));
    Object.freeze(this);
  }

  cacheKeyHmac(key) {
    return cipherFor(this).hmacIndex('CACHE_KEY', nonEmptyString(key, 'cacheKey'));
  }

  cleanupExpired() {
    const state = stateFor(this);
    const store = storeFor(this);
    const nowIso = new Date(Number(state.clock())).toISOString();
    const result = store.db.prepare('DELETE FROM whatsapp_message_retry_counters WHERE account_key=? AND expires_at<=?').run(state.accountKey, nowIso);
    return Number(result.changes);
  }

  get(key) {
    const state = stateFor(this);
    const store = storeFor(this);
    this.cleanupExpired();
    const row = store.db.prepare(`SELECT value_json FROM whatsapp_message_retry_counters
      WHERE account_key=? AND cache_key_hmac=?`).get(state.accountKey, this.cacheKeyHmac(key));
    if (!row) return undefined;
    try { return normalizeValue(JSON.parse(String(row.value_json))); }
    catch (_) { throw retryError('WHATSAPP_RETRY_STORE_VALUE_CORRUPT', 'Persisted retry counter is invalid'); }
  }

  set(key, value, ttlMs = undefined) {
    const state = stateFor(this);
    const store = storeFor(this);
    const normalized = normalizeValue(value);
    const nowMs = Number(state.clock());
    const ttl = Math.max(1000, Number(ttlMs ?? state.defaultTtlMs));
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttl).toISOString();
    const cacheKeyHmac = this.cacheKeyHmac(key);
    return store.transaction(() => {
      store.db.prepare('DELETE FROM whatsapp_message_retry_counters WHERE account_key=? AND expires_at<=?').run(state.accountKey, nowIso);
      store.db.prepare(`INSERT INTO whatsapp_message_retry_counters(
        account_key,cache_key_hmac,value_json,expires_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_key,cache_key_hmac) DO UPDATE SET
        value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).run(
        state.accountKey, cacheKeyHmac, JSON.stringify(normalized), expiresAt, nowIso, nowIso
      );
      return normalized;
    });
  }

  del(key) {
    const state = stateFor(this);
    const result = storeFor(this).db.prepare(`DELETE FROM whatsapp_message_retry_counters
      WHERE account_key=? AND cache_key_hmac=?`).run(state.accountKey, this.cacheKeyHmac(key));
    return Number(result.changes) > 0;
  }

  flushAll() {
    const state = stateFor(this);
    const result = storeFor(this).db.prepare('DELETE FROM whatsapp_message_retry_counters WHERE account_key=?').run(state.accountKey);
    return Number(result.changes);
  }

  snapshot() {
    const state = stateFor(this);
    const store = storeFor(this);
    this.cleanupExpired();
    const row = store.db.prepare('SELECT COUNT(*) AS count FROM whatsapp_message_retry_counters WHERE account_key=?').get(state.accountKey);
    return Object.freeze({ module: 'WhatsAppMessageRetryStore', accountKey: state.accountKey, persistedCounters: Number(row?.count || 0) });
  }
}

Object.freeze(WhatsAppMessageRetryStore.prototype);

function createWhatsAppMessageRetryStore(options = {}) {
  return new WhatsAppMessageRetryStore(options);
}

module.exports = Object.freeze({ DEFAULT_TTL_MS, WhatsAppMessageRetryStore, createWhatsAppMessageRetryStore });
''').lstrip()

RETRY_TEST = textwrap.dedent(r'''
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');
const { createWhatsAppMessageRetryStore } = require('../services/whatsappMessageRetryStore');

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-retry-store-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db'), ownershipHeartbeatMs: 60000, ownershipStaleMs: 120000 });
  const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x58), keyVersion: 1 });
  let now = Date.parse('2026-08-05T00:00:00.000Z');
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
      account_key,account_id,current_epoch,state,registered,identity_jid_hmac,
      writer_generation,writer_socket_token,created_at,updated_at,logged_out_at,quarantine_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'whatsapp-auth-account:account-1','account-1',1,'ACTIVE',1,'',1,'socket-1',
      new Date(now).toISOString(),new Date(now).toISOString(),'',''
    );
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
''').lstrip()

GET_MESSAGE_TEST = textwrap.dedent(r'''
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');
const { createWhatsAppMessageKeyIndexRepository } = require('../repositories/whatsappMessageKeyIndexRepository');

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-message-index-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db'), ownershipHeartbeatMs: 60000, ownershipStaleMs: 120000 });
  const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x62), keyVersion: 1 });
  const aliases = new Map([
    ['15550001111:7@s.whatsapp.net', 'canonical-peer@whatsapp'],
    ['A1B2C3@lid', 'canonical-peer@whatsapp'],
    ['canonical-peer@whatsapp', 'canonical-peer@whatsapp']
  ]);
  const remoteJidNormalizer = (_accountId, value) => aliases.get(String(value)) || String(value).toLowerCase();
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    return callback({ store, cipher, remoteJidNormalizer });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function message(rawMessage = { conversation: 'hello', contextInfo: { stanzaId: 'quoted-1' } }) {
  return {
    id: 'canonical-message-1',
    dedupeKey: 'canonical-message-1',
    externalMessageId: 'platform-message-1',
    accountId: 'account-1',
    sourceAccountId: 'account-1',
    sessionKey: 'account-1:15550001111@s.whatsapp.net',
    conversationId: 'account-1:15550001111@s.whatsapp.net',
    chatJid: '15550001111:7@s.whatsapp.net',
    senderId: 'peer-1',
    role: 'user',
    direction: 'inbound',
    fromMe: false,
    messageType: 'text',
    type: 'text',
    text: 'hello',
    rawMessage,
    rawMeta: { remoteJid: '15550001111:7@s.whatsapp.net', messageId: 'platform-message-1' },
    timestamp: '2026-08-05T00:00:00.000Z',
    sentAt: '2026-08-05T00:00:00.000Z',
    platform: 'whatsapp'
  };
}

function persist(store, repository, value) {
  store.upsertConversation({
    sessionKey: value.sessionKey,
    accountId: value.accountId,
    platform: 'whatsapp',
    title: 'Peer',
    updatedAt: value.timestamp
  });
  return store.transaction(() => {
    store.upsertMessage(value);
    return repository.upsertWithinTransaction(store, value);
  });
}

test('exact key lookup survives restart and LID/PN alias normalization without scans', () => {
  fixture(({ store, cipher, remoteJidNormalizer }) => {
    const options = { cipher, storeProvider: () => store, remoteJidNormalizer, clock: () => '2026-08-05T00:00:00.000Z' };
    const first = createWhatsAppMessageKeyIndexRepository(options);
    const written = persist(store, first, message());
    assert.equal(written.indexed, true);

    const restarted = createWhatsAppMessageKeyIndexRepository(options);
    const result = restarted.lookup({
      accountId: 'account-1',
      remoteJid: 'A1B2C3@lid',
      id: 'platform-message-1',
      fromMe: false,
      participant: ''
    });
    assert.deepEqual(result, { conversation: 'hello', contextInfo: { stanzaId: 'quoted-1' } });

    const indexRow = store.db.prepare('SELECT * FROM whatsapp_message_key_index').get();
    const payloadRow = store.db.prepare('SELECT * FROM whatsapp_message_retry_payloads').get();
    assert.equal(JSON.stringify(indexRow).includes('15550001111'), false);
    assert.equal(JSON.stringify(indexRow).includes('platform-message-1'), false);
    assert.equal(Buffer.from(payloadRow.ciphertext).toString('utf8').includes('hello'), false);
  });
});

test('raw payload mismatch fails closed and revoked rows never return content', () => {
  fixture(({ store, cipher, remoteJidNormalizer }) => {
    const repository = createWhatsAppMessageKeyIndexRepository({ cipher, storeProvider: () => store, remoteJidNormalizer });
    const original = message();
    persist(store, repository, original);
    store.transaction(() => store.upsertMessage({ ...original, rawMessage: { conversation: 'tampered' } }));
    assert.throws(() => repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), error => error?.code === 'WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH');

    persist(store, repository, original);
    store.transaction(() => {
      store.upsertMessage({ ...original, revoked: true, type: 'revoke', messageType: 'revoke', rawMessage: null });
      repository.deleteWithinTransaction(store, original.id);
    });
    assert.equal(repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), undefined);
  });
});

test('production composition and canonical message transaction own the index while adapter performs exact lookup', () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const messageSource = fs.readFileSync(path.join(__dirname, '../repositories/messageRepository.js'), 'utf8');
  const compositionSource = fs.readFileSync(path.join(__dirname, '../runtime/AppRuntimeComposition.js'), 'utf8');
  const getMessageStart = adapterSource.indexOf('getMessage: async key =>');
  const getMessageEnd = adapterSource.indexOf('\n      }', getMessageStart);
  const getMessageBlock = adapterSource.slice(getMessageStart, getMessageEnd + 8);
  assert.ok(getMessageStart >= 0);
  assert.match(getMessageBlock, /getWhatsAppMessageByKey/u);
  assert.doesNotMatch(getMessageBlock, /listMessages/u);
  assert.doesNotMatch(getMessageBlock, /5000/u);
  assert.match(adapterSource, /msgRetryCounterCache/u);
  assert.match(messageSource, /store\.upsertMessage\(message\);\s*\n\s*if \(whatsappMessageKeyIndexRepository/u);
  assert.match(messageSource, /upsertWithinTransaction\(store, message\)/u);
  assert.match(messageSource, /deleteWithinTransaction\(store, found\.row\.id\)/u);
  assert.match(compositionSource, /configureWhatsAppMessageKeyIndex/u);
  assert.match(compositionSource, /configureRuntimeAuthorities/u);
});
''').lstrip()

Path('backend/repositories/whatsappMessageKeyIndexRepository.js').write_text(INDEX_REPOSITORY, encoding='utf-8')
Path('backend/services/whatsappMessageRetryStore.js').write_text(RETRY_STORE, encoding='utf-8')
Path('backend/tests/oss1aWhatsappRetryStore.test.js').write_text(RETRY_TEST, encoding='utf-8')
Path('backend/tests/oss1aWhatsappGetMessage.test.js').write_text(GET_MESSAGE_TEST, encoding='utf-8')

message_path = Path('backend/repositories/messageRepository.js')
source = message_path.read_text(encoding='utf-8')
import_marker = "const { getStore } = require('./storeProvider');"
new_import = import_marker + "\nconst { createWhatsAppMessageKeyIndexRepository } = require('./whatsappMessageKeyIndexRepository');"
assert source.count(import_marker) == 1
source = source.replace(import_marker, new_import, 1)
state_marker = "const backgroundJobAuthority = require('../services/backgroundJobAuthority');\n"
state_block = state_marker + "\nlet whatsappMessageKeyIndexRepository = null;\n\nfunction configureWhatsAppMessageKeyIndex(options = {}) {\n  whatsappMessageKeyIndexRepository = createWhatsAppMessageKeyIndexRepository(options);\n  return whatsappMessageKeyIndexRepository;\n}\n\nfunction getWhatsAppMessageByKey(input = {}) {\n  return whatsappMessageKeyIndexRepository ? whatsappMessageKeyIndexRepository.lookup(input) : undefined;\n}\n"
assert source.count(state_marker) == 1
source = source.replace(state_marker, state_block, 1)
upsert_marker = "      store.upsertMessage(message);\n      conversation = mergeConversationPayload(store, message, inserted);"
upsert_replacement = "      store.upsertMessage(message);\n      if (whatsappMessageKeyIndexRepository && String(message.platform || '').toLowerCase() === 'whatsapp') {\n        whatsappMessageKeyIndexRepository.upsertWithinTransaction(store, message);\n      }\n      conversation = mergeConversationPayload(store, message, inserted);"
assert source.count(upsert_marker) == 1
source = source.replace(upsert_marker, upsert_replacement, 1)
revoke_marker = "      store.upsertMessage({ ...payload, id: found.row.id, sessionKey: found.row.session_key, sentAt: found.row.sent_at });\n      const messageIds ="
revoke_replacement = "      store.upsertMessage({ ...payload, id: found.row.id, sessionKey: found.row.session_key, sentAt: found.row.sent_at });\n      if (whatsappMessageKeyIndexRepository) whatsappMessageKeyIndexRepository.deleteWithinTransaction(store, found.row.id);\n      const messageIds ="
assert source.count(revoke_marker) == 1
source = source.replace(revoke_marker, revoke_replacement, 1)
exports_marker = "module.exports = { read, upsert, getMessageByDedupeKey,"
exports_replacement = "module.exports = { read, upsert, configureWhatsAppMessageKeyIndex, getWhatsAppMessageByKey, getMessageByDedupeKey,"
assert source.count(exports_marker) == 1
source = source.replace(exports_marker, exports_replacement, 1)
message_path.write_text(source, encoding='utf-8')

adapter_path = Path('backend/services/whatsappAdapter.js')
adapter = adapter_path.read_text(encoding='utf-8')
import_marker = "const { AUTH_EPOCH_ACTION, classifyDisconnect, shouldExecuteReconnect } = require('./whatsappDisconnectPolicy');"
new_import = import_marker + "\nconst { createWhatsAppMessageRetryStore } = require('./whatsappMessageRetryStore');"
assert adapter.count(import_marker) == 1
adapter = adapter.replace(import_marker, new_import, 1)
constructor_marker = "    this.credentialStateTtlMs = 3000;\n  }\n\n  status() {"
constructor_replacement = "    this.credentialStateTtlMs = 3000;\n    this.whatsappAuthKeyAuthority = null;\n    this.runtimeStoreProvider = null;\n  }\n\n  configureRuntimeAuthorities(options = {}) {\n    if (!options.whatsappAuthKeyAuthority || typeof options.whatsappAuthKeyAuthority.getCipher !== 'function') {\n      throw Object.assign(new Error('WhatsApp auth key authority is required'), { code: 'WHATSAPP_RUNTIME_KEY_AUTHORITY_REQUIRED' });\n    }\n    if (typeof options.storeProvider !== 'function') {\n      throw Object.assign(new Error('WhatsApp runtime Store provider is required'), { code: 'WHATSAPP_RUNTIME_STORE_PROVIDER_REQUIRED' });\n    }\n    this.whatsappAuthKeyAuthority = options.whatsappAuthKeyAuthority;\n    this.runtimeStoreProvider = options.storeProvider;\n    return true;\n  }\n\n  status() {"
assert adapter.count(constructor_marker) == 1
adapter = adapter.replace(constructor_marker, constructor_replacement, 1)
row_marker = "    const socketOptions = {\n      auth: state,"
row_replacement = "    const messageRetryStore = this.whatsappAuthKeyAuthority && this.runtimeStoreProvider\n      ? createWhatsAppMessageRetryStore({\n        accountKey: auth.key,\n        cipherProvider: () => this.whatsappAuthKeyAuthority.getCipher(),\n        storeProvider: this.runtimeStoreProvider\n      })\n      : null;\n    row.messageRetryStore = messageRetryStore;\n\n    const socketOptions = {\n      auth: state,\n      ...(messageRetryStore ? { msgRetryCounterCache: messageRetryStore } : {}),"
assert adapter.count(row_marker) == 1
adapter = adapter.replace(row_marker, row_replacement, 1)
old_get_message = """      getMessage: async key => {
        const rawConversationId = `${databaseAccountId}:${key.remoteJid}`;
        const target = canonicalWhatsAppTarget(databaseAccountId, key.remoteJid, rawConversationId);
        const conversationIds = [...new Set([target.conversationId, rawConversationId].filter(Boolean))];
        let found = null;
        for (const conversationId of conversationIds) {
          found = messageStore.listMessages(conversationId, { limit: 5000 }).find(message => (
            String(message.externalMessageId || '') === String(key.id || '') || String(message.id || '') === String(key.id || '')
          ));
          if (found) break;
        }
        if (found?.rawMessage) return found.rawMessage;
        const envelope = mediaAttachment(found || {})?.mediaEnvelope;
        return reconstructBaileysMessageInfo(envelope)?.message || undefined;
      }
"""
new_get_message = """      getMessage: async key => messageStore.getWhatsAppMessageByKey({
        accountId: databaseAccountId,
        remoteJid: key.remoteJid,
        id: key.id,
        fromMe: key.fromMe === true,
        participant: key.participant || ''
      })
"""
assert adapter.count(old_get_message) == 1
adapter = adapter.replace(old_get_message, new_get_message, 1)
adapter_path.write_text(adapter, encoding='utf-8')

composition_path = Path('backend/runtime/AppRuntimeComposition.js')
composition = composition_path.read_text(encoding='utf-8')
composition_import = "const messageStore = require('../services/messageStore');"
composition_new_import = composition_import + "\nconst whatsappAdapter = require('../services/whatsappAdapter');"
assert composition.count(composition_import) == 1
composition = composition.replace(composition_import, composition_new_import, 1)
key_marker = """  const whatsappAuthKeyAuthority = createWhatsAppAuthKeyAuthority({
    securityGuard,
    credentials: securityGuard.credentials
  });
  const accountContext = new AccountContext({ securityGuard, accountManager, accountStore, accountMigration, messageStore, sendQueue, platformMessaging, platformCapabilities, platformDrivers, canonicalIdentity, eventBus });
"""
key_replacement = """  const whatsappAuthKeyAuthority = createWhatsAppAuthKeyAuthority({
    securityGuard,
    credentials: securityGuard.credentials
  });
  const whatsappStoreProvider = () => authorityStore;
  messageStore.configureWhatsAppMessageKeyIndex({
    cipherProvider: () => whatsappAuthKeyAuthority.getCipher(),
    storeProvider: whatsappStoreProvider
  });
  whatsappAdapter.configureRuntimeAuthorities({
    whatsappAuthKeyAuthority,
    storeProvider: whatsappStoreProvider
  });
  const accountContext = new AccountContext({ securityGuard, accountManager, accountStore, accountMigration, messageStore, sendQueue, platformMessaging, platformCapabilities, platformDrivers, canonicalIdentity, eventBus });
"""
assert composition.count(key_marker) == 1
composition = composition.replace(key_marker, key_replacement, 1)
composition_path.write_text(composition, encoding='utf-8')

for name in [
  'backend/repositories/whatsappMessageKeyIndexRepository.js',
  'backend/services/whatsappMessageRetryStore.js',
  'backend/repositories/messageRepository.js',
  'backend/services/whatsappAdapter.js',
  'backend/runtime/AppRuntimeComposition.js',
  'backend/tests/oss1aWhatsappRetryStore.test.js',
  'backend/tests/oss1aWhatsappGetMessage.test.js'
]:
  assert Path(name).exists(), name
