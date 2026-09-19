'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULT_TTL_MS = 75 * 1000;
const challenges = new Map();
const events = new EventEmitter();
events.setMaxListeners(100);

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso(ms = Date.now()) { return new Date(ms).toISOString(); }
function keyFor(accountId) { return clean(accountId); }

function clonePublic(row, includeSecret = false) {
  if (!row) return null;
  return {
    challengeId: row.challengeId,
    accountId: row.accountId,
    type: row.type,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    version: row.version,
    ...(includeSecret ? { dataUrl: row.dataUrl } : {})
  };
}

function purgeExpired(now = Date.now()) {
  let purged = 0;
  for (const [key, row] of challenges.entries()) {
    if (row.expiresAtMs <= now) { challenges.delete(key); purged += 1; }
  }
  return purged;
}

function issue({ accountId, aliases = [], type = 'whatsapp-qr', dataUrl, ttlMs = DEFAULT_TTL_MS } = {}) {
  const canonical = keyFor(accountId);
  if (!canonical) throw Object.assign(new Error('Authentication challenge accountId is required'), { code: 'AUTH_CHALLENGE_ACCOUNT_REQUIRED' });
  if (!clean(dataUrl)) throw Object.assign(new Error('Authentication challenge data is required'), { code: 'AUTH_CHALLENGE_DATA_REQUIRED' });
  purgeExpired();
  const previous = challenges.get(canonical);
  const createdAtMs = Date.now();
  const row = {
    challengeId: crypto.randomUUID(),
    accountId: canonical,
    type: clean(type) || 'whatsapp-qr',
    dataUrl: String(dataUrl),
    createdAt: nowIso(createdAtMs),
    expiresAt: nowIso(createdAtMs + Math.max(5_000, Number(ttlMs || DEFAULT_TTL_MS))),
    expiresAtMs: createdAtMs + Math.max(5_000, Number(ttlMs || DEFAULT_TTL_MS)),
    version: Number(previous?.version || 0) + 1
  };
  const keys = [...new Set([canonical, ...(aliases || []).map(keyFor).filter(Boolean)])];
  for (const alias of keys) challenges.set(alias, row);
  for (const alias of keys) events.emit(`challenge:${alias}`, row);
  return clonePublic(row, false);
}

function read(accountId, options = {}) {
  purgeExpired();
  const key = keyFor(accountId);
  const row = challenges.get(key);
  if (!row) return null;
  const output = clonePublic(row, options.includeSecret === true);
  if (options.consume === true) clear(row.accountId);
  return output;
}

function wait(accountId, options = {}) {
  purgeExpired();
  const key = keyFor(accountId);
  const includeSecret = options.includeSecret === true;
  const immediate = read(key, { includeSecret });
  if (immediate) return Promise.resolve(immediate);
  const timeoutMs = Math.max(0, Math.min(Number(options.timeoutMs || 0), 30_000));
  if (!key || timeoutMs <= 0) return Promise.resolve(null);
  if (options.signal?.aborted) {
    const error = options.signal.reason instanceof Error ? options.signal.reason : new Error('Authentication challenge wait aborted');
    if (!error.code) error.code = 'AUTH_CHALLENGE_WAIT_ABORTED';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const eventName = `challenge:${key}`;
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      events.removeListener(eventName, onChallenge);
      options.signal?.removeEventListener?.('abort', onAbort);
      if (timer) clearTimeout(timer);
    };
    const onChallenge = row => {
      cleanup();
      resolve(clonePublic(row, includeSecret));
    };
    const onAbort = () => {
      cleanup();
      const error = options.signal?.reason instanceof Error ? options.signal.reason : new Error('Authentication challenge wait aborted');
      if (!error.code) error.code = 'AUTH_CHALLENGE_WAIT_ABORTED';
      reject(error);
    };
    events.once(eventName, onChallenge);
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const afterSubscribe = read(key, { includeSecret });
    if (afterSubscribe) {
      cleanup();
      resolve(afterSubscribe);
    }
  });
}

function clear(accountId) {
  const key = keyFor(accountId);
  const row = challenges.get(key);
  if (!row) return false;
  for (const [alias, candidate] of challenges.entries()) if (candidate === row) challenges.delete(alias);
  return true;
}

function status(accountId) {
  const row = read(accountId, { includeSecret: false });
  return row ? { ready: true, ...row } : { ready: false, accountId: keyFor(accountId), type: '', expiresAt: '', version: 0 };
}

function resetForTests() { challenges.clear(); events.removeAllListeners(); }

module.exports = { issue, read, wait, clear, status, purgeExpired, resetForTests, DEFAULT_TTL_MS };
