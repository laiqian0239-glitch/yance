'use strict';

const { getPrimaryStoreCapability } = require('./storeProvider');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRIVATE = new WeakMap();

function repositoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppMessageRetryRepositoryError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw repositoryError('WHATSAPP_RETRY_REPOSITORY_INPUT_INVALID', `${field} is invalid`, { field });
  return text;
}

function normalizeValue(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw repositoryError('WHATSAPP_RETRY_STORE_VALUE_INVALID', 'Retry counter must be a non-negative safe integer');
  }
  return number;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw repositoryError('WHATSAPP_RETRY_REPOSITORY_INVALID', 'Retry repository private state is unavailable');
  return state;
}

function storeFor(instance) {
  const store = stateFor(instance).storeProvider();
  if (!store?.db || typeof store.transaction !== 'function') {
    throw repositoryError('WHATSAPP_RETRY_STORE_PRIMARY_STORE_UNAVAILABLE', 'Primary Store capability is unavailable');
  }
  return store;
}

function cipherFor(instance) {
  const cipher = stateFor(instance).cipherProvider();
  if (!cipher || typeof cipher.hmacIndex !== 'function') {
    throw repositoryError('WHATSAPP_RETRY_STORE_CIPHER_UNAVAILABLE', 'WhatsApp auth cipher capability is unavailable');
  }
  return cipher;
}

class WhatsAppMessageRetryRepository {
  constructor(options = {}) {
    const accountKey = nonEmptyString(options.accountKey, 'accountKey');
    const cipherProvider = options.cipherProvider || (() => options.cipher);
    const storeProvider = options.storeProvider || getPrimaryStoreCapability;
    if (typeof cipherProvider !== 'function' || typeof storeProvider !== 'function') {
      throw repositoryError('WHATSAPP_RETRY_REPOSITORY_CONFIGURATION_INVALID', 'Retry repository dependencies are invalid');
    }
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
    const result = store.db.prepare(
      'DELETE FROM whatsapp_message_retry_counters WHERE account_key=? AND expires_at<=?'
    ).run(state.accountKey, nowIso);
    return Number(result.changes);
  }

  read(key) {
    const state = stateFor(this);
    const store = storeFor(this);
    this.cleanupExpired();
    const row = store.db.prepare(`SELECT value_json FROM whatsapp_message_retry_counters
      WHERE account_key=? AND cache_key_hmac=?`).get(state.accountKey, this.cacheKeyHmac(key));
    if (!row) return undefined;
    try { return normalizeValue(JSON.parse(String(row.value_json))); }
    catch (_) { throw repositoryError('WHATSAPP_RETRY_STORE_VALUE_CORRUPT', 'Persisted retry counter is invalid'); }
  }

  write(key, value, ttlMs = undefined) {
    const state = stateFor(this);
    const store = storeFor(this);
    const normalized = normalizeValue(value);
    const nowMs = Number(state.clock());
    const ttl = Math.max(1000, Number(ttlMs ?? state.defaultTtlMs));
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttl).toISOString();
    const cacheKeyHmac = this.cacheKeyHmac(key);
    return store.transaction(() => {
      store.db.prepare(
        'DELETE FROM whatsapp_message_retry_counters WHERE account_key=? AND expires_at<=?'
      ).run(state.accountKey, nowIso);
      store.db.prepare(`INSERT INTO whatsapp_message_retry_counters(
        account_key,cache_key_hmac,value_json,expires_at,updated_at
      ) VALUES(?,?,?,?,?)
      ON CONFLICT(account_key,cache_key_hmac) DO UPDATE SET
        value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).run(
        state.accountKey, cacheKeyHmac, JSON.stringify(normalized), expiresAt, nowIso
      );
      return normalized;
    });
  }

  delete(key) {
    const state = stateFor(this);
    const result = storeFor(this).db.prepare(`DELETE FROM whatsapp_message_retry_counters
      WHERE account_key=? AND cache_key_hmac=?`).run(state.accountKey, this.cacheKeyHmac(key));
    return Number(result.changes) > 0;
  }

  deleteAll() {
    const state = stateFor(this);
    const result = storeFor(this).db.prepare(
      'DELETE FROM whatsapp_message_retry_counters WHERE account_key=?'
    ).run(state.accountKey);
    return Number(result.changes);
  }

  count() {
    const state = stateFor(this);
    const store = storeFor(this);
    this.cleanupExpired();
    const row = store.db.prepare(
      'SELECT COUNT(*) AS count FROM whatsapp_message_retry_counters WHERE account_key=?'
    ).get(state.accountKey);
    return Number(row?.count || 0);
  }

  snapshot() {
    const state = stateFor(this);
    return Object.freeze({
      module: 'WhatsAppMessageRetryRepository',
      accountKey: state.accountKey,
      persistedCounters: this.count()
    });
  }
}

Object.freeze(WhatsAppMessageRetryRepository.prototype);

function createWhatsAppMessageRetryRepository(options = {}) {
  return new WhatsAppMessageRetryRepository(options);
}

module.exports = Object.freeze({
  DEFAULT_TTL_MS,
  WhatsAppMessageRetryRepository,
  createWhatsAppMessageRetryRepository
});
