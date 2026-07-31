'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

function now() { return new Date().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function batchId() { return `sync-${crypto.randomUUID()}`; }

function receiptRemoteKey(platform, remoteMessageId, conversationId = '') {
  const remote = clean(remoteMessageId);
  const scope = clean(conversationId);
  // WhatsApp remote message ids can collide across chats and companion-device
  // wrappers. Keep the existing schema while making the durable receipt key
  // conversation-scoped. Other platforms retain their original contract.
  return clean(platform).toLowerCase() === 'whatsapp' && scope
    ? `${scope}\u001f${remote}`
    : remote;
}

function read(platform, accountId, scopeId = '', store = getStore()) {
  const row = store.db.prepare(`SELECT * FROM sync_checkpoints WHERE platform=? AND account_id=? AND scope_id=?`).get(clean(platform), clean(accountId), clean(scopeId));
  return row ? {
    platform: row.platform, accountId: row.account_id, scopeId: row.scope_id,
    cursor: row.cursor, remoteMessageId: row.remote_message_id,
    remoteTimestamp: row.remote_timestamp, batchId: row.batch_id,
    phase: row.phase, payload: parseJson(row.payload_json, {}) || {},
    committedAt: row.committed_at, updatedAt: row.updated_at
  } : null;
}

function begin({ platform, accountId, scopeId = '', cursor = '', payload = {} }, store = getStore()) {
  const id = batchId();
  const timestamp = now();
  return store.transaction(() => {
    const previous = read(platform, accountId, scopeId, store);
    store.db.prepare(`
      INSERT INTO sync_checkpoints(platform, account_id, scope_id, cursor, remote_message_id, remote_timestamp, batch_id, phase, payload_json, committed_at, updated_at)
      VALUES (?, ?, ?, ?, '', '', ?, 'in_progress', ?, '', ?)
      ON CONFLICT(platform, account_id, scope_id) DO UPDATE SET
        cursor=CASE WHEN excluded.cursor<>'' THEN excluded.cursor ELSE sync_checkpoints.cursor END,
        batch_id=excluded.batch_id, phase='in_progress', payload_json=excluded.payload_json, updated_at=excluded.updated_at
    `).run(clean(platform), clean(accountId), clean(scopeId), clean(cursor), id, JSON.stringify(payload || {}), timestamp);
    return { batchId: id, startedAt: timestamp, previous };
  });
}

function claimRemoteMessage({ platform, accountId, remoteMessageId, conversationId = '', messageId = '' }, store = getStore()) {
  const remote = receiptRemoteKey(platform, remoteMessageId, conversationId);
  if (!remote) return { claimed: true, reason: 'no-remote-id' };
  const timestamp = now();
  const result = store.db.prepare(`
    INSERT INTO sync_message_receipts(platform, account_id, remote_message_id, conversation_id, message_id, first_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, account_id, remote_message_id) DO NOTHING
  `).run(clean(platform), clean(accountId), remote, clean(conversationId), clean(messageId), timestamp, timestamp);
  return { claimed: result.changes > 0, duplicate: result.changes === 0, receiptKey: remote };
}

function releaseRemoteMessage({ platform, accountId, remoteMessageId, conversationId = '' }, store = getStore()) {
  const remote = receiptRemoteKey(platform, remoteMessageId, conversationId);
  if (!remote) return { released: false, reason: 'no-remote-id' };
  const result = store.db.prepare(`
    DELETE FROM sync_message_receipts
    WHERE platform=? AND account_id=? AND remote_message_id=?
  `).run(clean(platform), clean(accountId), remote);
  return { released: Number(result.changes || 0) > 0, receiptKey: remote };
}

function commit({ platform, accountId, scopeId = '', batchId: id, cursor = '', remoteMessageId = '', remoteTimestamp = '', payload = {} }, store = getStore()) {
  const timestamp = now();
  const result = store.db.prepare(`
    UPDATE sync_checkpoints SET cursor=?, remote_message_id=?, remote_timestamp=?, phase='committed', payload_json=?, committed_at=?, updated_at=?
    WHERE platform=? AND account_id=? AND scope_id=? AND batch_id=?
  `).run(clean(cursor), clean(remoteMessageId), clean(remoteTimestamp), JSON.stringify(payload || {}), timestamp, timestamp, clean(platform), clean(accountId), clean(scopeId), clean(id));
  if (!result.changes) throw Object.assign(new Error('Sync checkpoint batch no longer owns the scope'), { code: 'SYNC_CHECKPOINT_OWNERSHIP_LOST' });
  return read(platform, accountId, scopeId, store);
}

function fail({ platform, accountId, scopeId = '', batchId: id, error = '', payload = {} }, store = getStore()) {
  const timestamp = now();
  store.db.prepare(`
    UPDATE sync_checkpoints SET phase='interrupted', payload_json=?, updated_at=?
    WHERE platform=? AND account_id=? AND scope_id=? AND batch_id=?
  `).run(JSON.stringify({ ...payload, error: clean(error) }), timestamp, clean(platform), clean(accountId), clean(scopeId), clean(id));
  return read(platform, accountId, scopeId, store);
}

function recoverInterrupted(store = getStore()) {
  const rows = store.db.prepare(`SELECT platform, account_id, scope_id, cursor, remote_message_id, remote_timestamp, batch_id, payload_json, updated_at FROM sync_checkpoints WHERE phase='in_progress'`).all();
  const timestamp = now();
  for (const row of rows) store.db.prepare(`UPDATE sync_checkpoints SET phase='interrupted', updated_at=? WHERE platform=? AND account_id=? AND scope_id=?`).run(timestamp, row.platform, row.account_id, row.scope_id);
  return rows.map(row => ({ platform: row.platform, accountId: row.account_id, scopeId: row.scope_id, cursor: row.cursor, remoteMessageId: row.remote_message_id, remoteTimestamp: row.remote_timestamp, batchId: row.batch_id, payload: parseJson(row.payload_json, {}) || {}, interruptedAt: row.updated_at }));
}

module.exports = { read, begin, claimRemoteMessage, releaseRemoteMessage, receiptRemoteKey, commit, fail, recoverInterrupted };
