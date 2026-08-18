'use strict';

const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

function clean(value) { return String(value == null ? '' : value).trim(); }

function receiptRemoteKey(platform, remoteMessageId, conversationId = '') {
  const remote = clean(remoteMessageId);
  const scope = clean(conversationId);
  return clean(platform).toLowerCase() === 'whatsapp' && scope ? `${scope}\u001f${remote}` : remote;
}

function read(platform, accountId, scopeId = '', store = getStore()) {
  const row = store.db.prepare(`SELECT * FROM sync_checkpoints WHERE platform=? AND account_id=? AND scope_id=?`)
    .get(clean(platform), clean(accountId), clean(scopeId));
  return row ? {
    platform: row.platform, accountId: row.account_id, scopeId: row.scope_id,
    cursor: row.cursor, remoteMessageId: row.remote_message_id,
    remoteTimestamp: row.remote_timestamp, batchId: row.batch_id,
    phase: row.phase, payload: parseJson(row.payload_json, {}) || {},
    committedAt: row.committed_at, updatedAt: row.updated_at,
    canonical: false
  } : null;
}

function claimRemoteMessage({ platform, accountId, remoteMessageId, conversationId = '', messageId = '' }, store = getStore()) {
  const remote = receiptRemoteKey(platform, remoteMessageId, conversationId);
  if (!remote) return { claimed: true, reason: 'no-remote-id' };
  const timestamp = new Date().toISOString();
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
  const result = store.db.prepare(`DELETE FROM sync_message_receipts WHERE platform=? AND account_id=? AND remote_message_id=?`)
    .run(clean(platform), clean(accountId), remote);
  return { released: Number(result.changes || 0) > 0, receiptKey: remote };
}

function directMutationForbidden() {
  throw Object.assign(new Error('Legacy sync checkpoint repository is read-only; mutations require SyncCheckpointService durable execution context'), {
    code: 'WP_B_SYNC_CHECKPOINT_DIRECT_MUTATION_FORBIDDEN'
  });
}

function recoverInterrupted(store = getStore()) {
  return store.db.prepare(`SELECT platform, account_id, scope_id, cursor, remote_message_id, remote_timestamp, batch_id, payload_json, updated_at FROM sync_checkpoints WHERE phase='in_progress'`).all()
    .map(row => ({
      platform: row.platform, accountId: row.account_id, scopeId: row.scope_id, cursor: row.cursor,
      remoteMessageId: row.remote_message_id, remoteTimestamp: row.remote_timestamp, batchId: row.batch_id,
      payload: parseJson(row.payload_json, {}) || {}, interruptedAt: row.updated_at,
      recoveryRequired: true, mutationPerformed: false
    }));
}

module.exports = {
  read,
  begin: directMutationForbidden,
  commit: directMutationForbidden,
  fail: directMutationForbidden,
  claimRemoteMessage,
  releaseRemoteMessage,
  receiptRemoteKey,
  recoverInterrupted
};
