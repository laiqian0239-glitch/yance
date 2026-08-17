'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const REMOTE_SUCCESS_PROVEN = 'REMOTE_SUCCESS_PROVEN';
const REMOTE_ABSENCE_PROVEN = 'REMOTE_ABSENCE_PROVEN';
const REMOTE_RESULT_UNKNOWN = 'REMOTE_RESULT_UNKNOWN';

function clean(value) { return String(value == null ? '' : value).trim(); }
function send(payload) { if (typeof process.send === 'function') process.send(payload); }
function remoteError(code, message) { return Object.assign(new Error(message || code), { code }); }

const dbPath = path.resolve(process.argv[2] || 'wp-b-fake-remote.db');
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS remote_requests(
  idempotency_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  provider_receipt_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;`);

function rowByIdentity(input = {}) {
  const idempotencyKey = clean(input.idempotencyKey);
  const requestId = clean(input.requestId);
  if (idempotencyKey) return db.prepare('SELECT * FROM remote_requests WHERE idempotency_key=?').get(idempotencyKey) || null;
  if (requestId) return db.prepare('SELECT * FROM remote_requests WHERE request_id=?').get(requestId) || null;
  return null;
}

function stats() {
  return Object.freeze({
    processId: process.pid,
    physicalSideEffectCount: Number(db.prepare('SELECT COUNT(*) AS count FROM remote_requests').get().count || 0)
  });
}

function perform(input = {}) {
  const idempotencyKey = clean(input.idempotencyKey);
  if (!idempotencyKey) throw remoteError('WP_B_FAKE_REMOTE_IDEMPOTENCY_REQUIRED');
  const existing = rowByIdentity({ idempotencyKey });
  if (existing) {
    return Object.freeze({
      requestId: clean(existing.request_id),
      providerReceiptId: clean(existing.provider_receipt_id),
      outcome: REMOTE_SUCCESS_PROVEN,
      duplicate: true,
      ...stats()
    });
  }
  const behavior = clean(input.behavior || 'SUCCESS');
  if (behavior === 'RETRYABLE_FAILURE') {
    throw Object.assign(remoteError('REMOTE_RETRYABLE_FAILURE'), { retryable: true, remoteOutcomeUnknown: false });
  }
  if (behavior === 'PERMANENT_FAILURE') {
    throw Object.assign(remoteError('REMOTE_PERMANENT_FAILURE'), { retryable: false, remoteOutcomeUnknown: false });
  }
  if (behavior === 'UNKNOWN_WITHOUT_ACCEPTANCE') {
    throw Object.assign(remoteError('REMOTE_RESULT_UNKNOWN'), { retryable: false, remoteOutcomeUnknown: true });
  }
  const requestId = `remote-request-${crypto.randomUUID()}`;
  const providerReceiptId = `remote-receipt-${crypto.randomUUID()}`;
  const at = clean(input.authorityTimestamp) || new Date().toISOString();
  db.prepare(`INSERT INTO remote_requests(
    idempotency_key,request_id,provider_receipt_id,status,created_at
  ) VALUES(?,?,?,'SUCCEEDED',?)`).run(idempotencyKey, requestId, providerReceiptId, at);
  return Object.freeze({
    requestId,
    providerReceiptId,
    outcome: REMOTE_SUCCESS_PROVEN,
    duplicate: false,
    ...stats()
  });
}

function lookup(input = {}) {
  if (clean(input.forceOutcome) === REMOTE_RESULT_UNKNOWN) {
    return Object.freeze({ outcome: REMOTE_RESULT_UNKNOWN, requestId: clean(input.requestId), ...stats() });
  }
  const row = rowByIdentity(input);
  if (!row) return Object.freeze({ outcome: REMOTE_ABSENCE_PROVEN, requestId: clean(input.requestId), ...stats() });
  return Object.freeze({
    outcome: REMOTE_SUCCESS_PROVEN,
    requestId: clean(row.request_id),
    providerReceiptId: clean(row.provider_receipt_id),
    ...stats()
  });
}

async function handle(message = {}) {
  const correlationId = clean(message.correlationId);
  try {
    let result;
    if (message.type === 'perform') result = perform(message);
    else if (message.type === 'lookup') result = lookup(message);
    else if (message.type === 'stats') result = stats();
    else if (message.type === 'shutdown') {
      result = { closed: true, ...stats() };
      send({ type: 'response', correlationId, ok: true, result });
      try { db.close(); } catch (_) {}
      process.disconnect?.();
      return;
    } else throw remoteError('WP_B_FAKE_REMOTE_COMMAND_INVALID');
    const delayMs = Math.max(0, Math.min(5000, Number(message.delayMs || 0)));
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    send({ type: 'response', correlationId, ok: true, result });
  } catch (error) {
    send({
      type: 'response',
      correlationId,
      ok: false,
      error: {
        code: clean(error.code) || 'WP_B_FAKE_REMOTE_FAILED',
        retryable: error.retryable === true,
        remoteOutcomeUnknown: error.remoteOutcomeUnknown === true
      }
    });
  }
}

process.on('message', message => { handle(message).catch(error => send({ type: 'fatal', code: clean(error.code), message: clean(error.message) })); });
process.on('disconnect', () => { try { db.close(); } catch (_) {} process.exit(0); });
send({ type: 'ready', processId: process.pid, dbPath });

module.exports = Object.freeze({
  REMOTE_SUCCESS_PROVEN,
  REMOTE_ABSENCE_PROVEN,
  REMOTE_RESULT_UNKNOWN,
  lookup,
  perform,
  stats
});
