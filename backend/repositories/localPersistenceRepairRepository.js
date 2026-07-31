'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }

function ensure(store = getStore()) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS local_persistence_repairs (
      id TEXT PRIMARY KEY,
      queue_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_local_persistence_repairs_ready
      ON local_persistence_repairs(state, next_attempt_at, created_at);
  `);
}

function row(value) {
  if (!value) return null;
  return {
    id: value.id,
    queueId: value.queue_id,
    platform: value.platform,
    accountId: value.account_id,
    conversationId: value.conversation_id,
    payload: parseJson(value.payload_json, {}) || {},
    state: value.state,
    attempts: Number(value.attempts || 0),
    nextAttemptAt: value.next_attempt_at,
    lastError: value.last_error,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  };
}

function enqueue(input = {}, store = getStore()) {
  ensure(store);
  const timestamp = now();
  const id = clean(input.id) || `local-repair-${crypto.randomUUID()}`;
  store.db.prepare(`
    INSERT INTO local_persistence_repairs(
      id, queue_id, platform, account_id, conversation_id, payload_json,
      state, attempts, next_attempt_at, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, '', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json=excluded.payload_json,
      state=CASE WHEN local_persistence_repairs.state='completed' THEN local_persistence_repairs.state ELSE 'pending' END,
      next_attempt_at=excluded.next_attempt_at,
      updated_at=excluded.updated_at
  `).run(
    id,
    clean(input.queueId),
    clean(input.platform),
    clean(input.accountId),
    clean(input.conversationId),
    JSON.stringify(input.payload || {}),
    timestamp,
    timestamp,
    timestamp
  );
  return get(id, store);
}

function get(id, store = getStore()) {
  ensure(store);
  return row(store.db.prepare('SELECT * FROM local_persistence_repairs WHERE id=?').get(clean(id)));
}

function claimNext(store = getStore()) {
  ensure(store);
  return store.transaction(() => {
    const value = store.db.prepare(`
      SELECT * FROM local_persistence_repairs
      WHERE state IN ('pending','retry') AND next_attempt_at<=?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(now());
    if (!value) return null;
    const timestamp = now();
    const result = store.db.prepare(`
      UPDATE local_persistence_repairs
      SET state='running', attempts=attempts+1, updated_at=?
      WHERE id=? AND state IN ('pending','retry')
    `).run(timestamp, value.id);
    return Number(result.changes || 0) === 1 ? get(value.id, store) : null;
  });
}

function recoverInterrupted(store = getStore()) {
  ensure(store);
  const timestamp = now();
  const result = store.db.prepare(`
    UPDATE local_persistence_repairs
    SET state='retry',
        next_attempt_at=?,
        last_error=CASE
          WHEN last_error='' THEN 'LOCAL_REPAIR_INTERRUPTED: 后端重启前本地投影修复未完成，已自动重新排队'
          ELSE last_error
        END,
        updated_at=?
    WHERE state='running'
  `).run(timestamp, timestamp);
  return Number(result.changes || 0);
}

function complete(id, store = getStore()) {
  ensure(store);
  const timestamp = now();
  store.db.prepare(`UPDATE local_persistence_repairs SET state='completed', last_error='', updated_at=? WHERE id=?`).run(timestamp, clean(id));
  return get(id, store);
}

function fail(id, error = '', options = {}, store = getStore()) {
  ensure(store);
  const timestamp = now();
  const delayMs = Math.max(1000, Number(options.delayMs || 5000));
  const terminal = options.terminal === true;
  store.db.prepare(`
    UPDATE local_persistence_repairs
    SET state=?, next_attempt_at=?, last_error=?, updated_at=?
    WHERE id=?
  `).run(
    terminal ? 'failed' : 'retry',
    new Date(Date.now() + delayMs).toISOString(),
    clean(error).slice(0, 2000),
    timestamp,
    clean(id)
  );
  return get(id, store);
}

function list(options = {}, store = getStore()) {
  ensure(store);
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 200)));
  return store.db.prepare('SELECT * FROM local_persistence_repairs ORDER BY created_at DESC LIMIT ?').all(limit).map(row);
}

module.exports = { ensure, enqueue, get, claimNext, recoverInterrupted, complete, fail, list };
