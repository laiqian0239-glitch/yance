'use strict';

const { projectMessage } = require('./domainMessageProjector');

function clean(value) { return String(value == null ? '' : value).trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function parse(value, fallback) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function projection(event = {}) { return event.payload?.projection && typeof event.payload.projection === 'object' ? event.payload.projection : {}; }
function stable(value) { return JSON.stringify(value ?? null); }
function subsetMatches(actual, expected) {
  if (expected == null) return actual == null;
  if (Array.isArray(expected)) return Array.isArray(actual) && stable(actual) === stable(expected);
  if (typeof expected !== 'object') return stable(actual) === stable(expected);
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => key.startsWith('_') || subsetMatches(actual[key], value));
}
function verified(actual = {}) { return { ...actual, _projectionVerified: true }; }
function invalid(actual = {}, reasonCode = 'DOMAIN_OPERATIONAL_PROJECTION_MISMATCH', expected = {}) {
  return { ...actual, _projectionVerified: false, _reasonCode: reasonCode, _expectedProjection: expected };
}
function isVerified(actual) { return Boolean(actual && actual._projectionVerified === true); }

const REPAIRABLE_TYPES = new Set([
  'message.reaction.updated', 'message.revoked', 'message.receipt.updated',
  'message.receipt.range.updated', 'conversation.read'
]);
const VERIFIED_TYPES = new Set([
  'message.sent', 'message.echo.received', 'contact.observed', 'conversation.observed',
  'history.sync.completed', 'history.sync.failed', 'reconcile.completed', 'reconcile.failed',
  'identity.link.observed', 'identity.link.transitioned', 'identity.person.merged',
  'identity.operation.rolled_back', 'media.lifecycle.updated'
]);

function accountState(accountId, provider) {
  try {
    if (typeof provider === 'function') return provider(clean(accountId)) || null;
    const manager = provider || require('./accountManager');
    if (typeof manager.get === 'function') {
      const direct = manager.get(clean(accountId));
      if (direct) return direct;
    }
    const listed = typeof manager.list === 'function' ? manager.list() : manager;
    const rows = array(listed?.accounts || listed);
    return rows.find(row => [row.id, row.accountId, row.adapterAccountId, row.authAccountKey].map(clean).includes(clean(accountId))) || null;
  } catch (_) { return null; }
}

function auditRow(db, auditId) {
  if (!clean(auditId)) return null;
  const row = db.prepare('SELECT * FROM identity_link_audit WHERE audit_id=?').get(clean(auditId));
  return row ? {
    ...row,
    before: parse(row.before_json, {}),
    after: parse(row.after_json, {}),
    rollbackPlan: parse(row.rollback_plan_json, {})
  } : null;
}

function eventProjection(row) {
  const payload = parse(row?.payload_json, {});
  return object(payload.projection);
}

function sameOperationalTarget(left = {}, right = {}) {
  const keys = ['accountId', 'messageId', 'conversationId', 'contactId', 'auditId', 'identityLinkId', 'kind'];
  return keys.every(key => !clean(left[key]) || !clean(right[key]) || clean(left[key]) === clean(right[key]));
}

function laterMatchingEventExists(db, event, eventTypes = [], expected = {}) {
  const types = array(eventTypes).map(clean).filter(Boolean);
  if (!types.length) return false;
  const marks = types.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT event_id, correlation_id, payload_json
    FROM domain_events
    WHERE source_account_id=? AND event_type IN (${marks})
      AND (occurred_at>? OR (occurred_at=? AND event_id>?))
    ORDER BY occurred_at, event_id
    LIMIT 100
  `).all(clean(event.source_account_id), ...types, clean(event.occurred_at), clean(event.occurred_at), clean(event.event_id));
  const correlationId = clean(event.correlation_id);
  return rows.some(row => {
    if (correlationId && clean(row.correlation_id) === correlationId) return true;
    return sameOperationalTarget(expected, eventProjection(row));
  });
}

function sameLink(left = {}, right = {}) {
  const keys = ['identityLinkId', 'personId', 'platform', 'sourceAccountId', 'externalId', 'linkStatus', 'verificationMethod', 'supersededBy'];
  return keys.every(key => !clean(right?.[key]) || clean(left?.[key]) === clean(right?.[key]));
}

function actualFor(event = {}, store, options = {}) {
  if (!store?.db) return null;
  const type = clean(event.event_type || event.eventType);
  const expected = projection(event);
  const db = store.db;

  if (type === 'message.reaction.updated') {
    const row = store.getMessage(clean(expected.messageId));
    if (!row) return null;
    const actual = { messageId: clean(row.id), reactions: array(row.reactions) };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'MESSAGE_REACTION_MISMATCH', expected);
  }
  if (type === 'message.revoked') {
    const row = store.getMessage(clean(expected.messageId));
    if (!row) return null;
    const actual = { messageId: clean(row.id), revoked: Boolean(row.revoked), text: clean(row.text), messageType: clean(row.messageType || row.type) };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'MESSAGE_REVOKE_MISMATCH', expected);
  }
  if (type === 'message.receipt.updated') {
    const row = store.getMessage(clean(expected.messageId));
    if (!row) return null;
    const actual = { messageId: clean(row.id), status: clean(row.deliveryStatus || row.status) };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'MESSAGE_RECEIPT_MISMATCH', expected);
  }
  if (type === 'message.receipt.range.updated') {
    const ids = array(expected.messageIds).map(clean).filter(Boolean);
    const rows = ids.map(id => store.getMessage(id)).filter(Boolean);
    const statuses = [...new Set(rows.map(row => clean(row.deliveryStatus || row.status)))];
    const actual = { messageIds: rows.map(row => clean(row.id)).sort(), status: statuses.length === 1 ? statuses[0] : '', statuses };
    const expectedIds = [...ids].sort();
    const matched = rows.length === ids.length && stable(actual.messageIds) === stable(expectedIds) && (!clean(expected.status) || actual.status === clean(expected.status));
    return matched ? verified(actual) : invalid(actual, 'MESSAGE_RECEIPT_RANGE_MISMATCH', expected);
  }
  if (type === 'conversation.read') {
    const row = db.prepare('SELECT session_key, unread_count FROM r32_conversations WHERE session_key=?').get(clean(expected.conversationId));
    if (!row) return null;
    const actual = { conversationId: clean(row.session_key), unreadCount: Number(row.unread_count || 0) };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'CONVERSATION_READ_STATE_MISMATCH', expected);
  }
  if (type === 'message.echo.received') {
    const id = clean(expected.id || expected.messageId);
    const row = id ? store.getMessage(id) : null;
    if (!row) return null;
    const persisted = projectMessage(row);
    const actual = {
      id: clean(persisted.id), messageId: clean(persisted.id), externalMessageId: clean(persisted.externalMessageId),
      platform: clean(persisted.platform), accountId: clean(persisted.accountId), conversationId: clean(persisted.conversationId),
      contactId: clean(persisted.contactId), direction: clean(persisted.direction), fromMe: persisted.fromMe === true,
      text: clean(persisted.text), timestamp: clean(persisted.timestamp)
    };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'MESSAGE_ECHO_TARGET_MISMATCH', expected);
  }
  if (type === 'message.sent') {
    const commandId = clean(expected.commandId);
    const outboxId = clean(expected.outboxId);
    const row = commandId
      ? db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(commandId)
      : db.prepare('SELECT * FROM r32_send_queue WHERE outbox_id=? ORDER BY created_at DESC LIMIT 1').get(outboxId);
    if (!row) return null;
    const actual = {
      commandId: clean(row.id), outboxId: clean(row.outbox_id), platform: clean(row.platform), accountId: clean(row.account_id),
      conversationId: clean(row.conversation_id), state: clean(row.state), platformMessageId: clean(row.platform_message_id),
      idempotencyKey: clean(row.idempotency_key), sendPolicyHash: clean(row.send_policy_hash),
      platformResult: parse(row.platform_result_json, {})
    };
    const accepted = ['sent', 'platform_accepted_local_pending', 'delivered', 'read'].includes(actual.state);
    const matched = accepted && (!commandId || actual.commandId === commandId) && (!outboxId || actual.outboxId === outboxId)
      && (!clean(expected.accountId) || actual.accountId === clean(expected.accountId))
      && (!clean(expected.platformMessageId || expected.messageId) || actual.platformMessageId === clean(expected.platformMessageId || expected.messageId));
    return matched ? verified(actual) : invalid(actual, 'MESSAGE_SEND_QUEUE_STATE_MISMATCH', expected);
  }
  if (type === 'contact.observed') {
    const row = db.prepare('SELECT id, platform, account_id, external_id, canonical_contact_id, merged_into_id, tombstoned_at FROM contacts WHERE id=?').get(clean(expected.contactId));
    if (!row) return null;
    const binding = db.prepare("SELECT person_id, state, source, updated_at FROM person_contact_bindings WHERE contact_id=? AND state='active' ORDER BY updated_at DESC LIMIT 1").get(clean(row.id));
    const actual = {
      contactId: clean(row.id), platform: clean(row.platform), accountId: clean(row.account_id), externalId: clean(row.external_id),
      personId: clean(binding?.person_id), bindingState: clean(binding?.state), canonicalContactId: clean(row.canonical_contact_id),
      mergedIntoId: clean(row.merged_into_id), tombstonedAt: clean(row.tombstoned_at)
    };
    const matched = (!clean(expected.personId) || actual.personId === clean(expected.personId)) && subsetMatches(actual, expected);
    return matched ? verified(actual) : invalid(actual, 'CONTACT_PROJECTION_SCOPE_MISMATCH', expected);
  }
  if (type === 'conversation.observed') {
    const row = db.prepare('SELECT session_key, contact_id, person_id, platform, account_id FROM r32_conversations WHERE session_key=?').get(clean(expected.conversationId));
    if (!row) return null;
    const binding = db.prepare("SELECT person_id, state, source, updated_at FROM conversation_bindings WHERE conversation_id=? AND state='active' ORDER BY updated_at DESC LIMIT 1").get(clean(row.session_key));
    const actual = {
      conversationId: clean(row.session_key), contactId: clean(row.contact_id), personId: clean(row.person_id || binding?.person_id),
      platform: clean(row.platform), accountId: clean(row.account_id), bindingState: clean(binding?.state)
    };
    return subsetMatches(actual, expected) ? verified(actual) : invalid(actual, 'CONVERSATION_PROJECTION_SCOPE_MISMATCH', expected);
  }
  if (type.startsWith('history.sync.') || type.startsWith('reconcile.')) {
    const account = accountState(expected.accountId || event.source_account_id, options.accountStateProvider);
    if (!account) return null;
    const failedEvent = type.endsWith('.failed');
    const history = type.startsWith('history.sync.');
    const result = object(history ? account.historySyncLastResult : account.reconciliationLastResult);
    const errorCode = clean(history ? account.historySyncLastError : account.reconciliationLastError);
    const observedAt = clean(history ? account.historySyncLastAt : account.reconciliationLastAt) || clean(account.lastSyncAt);
    const actualFailed = Boolean(errorCode || result.failed === true || result.ok === false);
    const actual = {
      accountId: clean(account.id || account.accountId || expected.accountId || event.source_account_id),
      platform: clean(account.platform || event.platform), operation: history ? 'history-sync' : 'reconcile',
      status: actualFailed ? 'failed' : (observedAt || Object.keys(result).length ? 'completed' : 'unknown'),
      errorCode, result, observedAt
    };
    const matched = failedEvent ? actual.status === 'failed' : actual.status === 'completed';
    if (matched) return verified(actual);
    const siblingTypes = history ? ['history.sync.completed', 'history.sync.failed'] : ['reconcile.completed', 'reconcile.failed'];
    if (laterMatchingEventExists(db, event, siblingTypes, expected)) return verified({ ...actual, superseded: true });
    return invalid(actual, 'ACCOUNT_OPERATION_STATE_MISMATCH', expected);
  }
  if (type === 'media.lifecycle.updated') {
    const messageId = clean(expected.messageId);
    const row = messageId ? store.getMessage(messageId) : null;
    if (!row) return null;
    const attachments = array(row.attachments || parse(row.attachments_json, []));
    const attachment = attachments.find(item => !clean(expected.kind) || clean(item.kind) === clean(expected.kind)) || attachments[0];
    if (!attachment) return invalid({ messageId }, 'MEDIA_ATTACHMENT_MISSING', expected);
    const currentState = clean(attachment.downloadStatus || attachment.state || row.mediaState);
    const actual = {
      messageId: clean(row.id), conversationId: clean(row.conversationId || row.sessionKey), kind: clean(attachment.kind),
      mimeType: clean(attachment.mimeType), state: currentState, downloadStatus: clean(attachment.downloadStatus),
      fileHash: clean(attachment.fileHash), retryable: attachment.retryable === true,
      errorCode: clean(attachment.downloadError)
    };
    const expectedState = clean(expected.state || expected.downloadStatus);
    const progression = { observed: 0, queued: 1, running: 2, failed: 2, ready: 3, cached: 3, recovered: 3 };
    const sameOrSuccessor = !expectedState || currentState === expectedState
      || (progression[currentState] != null && progression[expectedState] != null && progression[currentState] >= progression[expectedState] && currentState !== 'failed');
    const fieldsMatch = (!clean(expected.kind) || actual.kind === clean(expected.kind))
      && (!clean(expected.mimeType) || actual.mimeType === clean(expected.mimeType))
      && (!clean(expected.fileHash) || actual.fileHash === clean(expected.fileHash));
    if (sameOrSuccessor && fieldsMatch) return verified(actual);
    if (laterMatchingEventExists(db, event, ['media.lifecycle.updated'], expected)) return verified({ ...actual, superseded: true });
    return invalid(actual, 'MEDIA_LIFECYCLE_STATE_MISMATCH', expected);
  }
  if (type === 'identity.link.observed' || type === 'identity.link.transitioned') {
    const audit = auditRow(db, clean(expected.auditId));
    if (!audit) return null;
    const afterLink = object(audit.after?.link || audit.after);
    const actual = {
      auditId: clean(audit.audit_id), operation: clean(audit.operation), actor: clean(audit.actor), reason: clean(audit.reason),
      sourcePersonId: clean(audit.source_person_id), targetPersonId: clean(audit.target_person_id), link: afterLink,
      createdAt: clean(audit.created_at)
    };
    const expectedOperation = type === 'identity.link.observed' ? 'observe' : clean(expected.operation);
    const matched = (!expectedOperation || actual.operation === expectedOperation) && sameLink(afterLink, object(expected.link));
    return matched ? verified(actual) : invalid(actual, 'IDENTITY_LINK_AUDIT_MISMATCH', expected);
  }
  if (type === 'identity.person.merged') {
    const audit = auditRow(db, clean(expected.auditId));
    if (!audit) return null;
    const receipt = db.prepare("SELECT * FROM identity_governance_operation_receipts WHERE audit_id=? AND operation='merge' ORDER BY created_at DESC LIMIT 1").get(clean(expected.auditId));
    const actual = {
      auditId: clean(audit.audit_id), operation: clean(audit.operation), sourcePersonId: clean(audit.source_person_id),
      targetPersonId: clean(audit.target_person_id), receiptStatus: clean(receipt?.status), receiptId: clean(receipt?.receipt_id),
      createdAt: clean(receipt?.created_at)
    };
    const sourceId = clean(expected.sourcePerson?.personId || expected.sourcePerson?.person_id);
    const targetId = clean(expected.targetPerson?.personId || expected.targetPerson?.person_id);
    const matched = actual.operation === 'merge' && actual.receiptStatus === 'applied'
      && (!sourceId || actual.sourcePersonId === sourceId) && (!targetId || actual.targetPersonId === targetId);
    return matched ? verified(actual) : invalid(actual, 'IDENTITY_PERSON_MERGE_AUDIT_MISMATCH', expected);
  }
  if (type === 'identity.operation.rolled_back') {
    const rollbackAudit = auditRow(db, clean(expected.rollbackAuditId));
    const originalAuditId = clean(expected.auditId || expected.mergeAuditId);
    const receipt = originalAuditId ? db.prepare('SELECT * FROM identity_governance_operation_receipts WHERE audit_id=? ORDER BY created_at DESC LIMIT 1').get(originalAuditId) : null;
    if (!rollbackAudit || !receipt) return null;
    const actual = {
      rollbackAuditId: clean(rollbackAudit.audit_id), auditId: originalAuditId, operation: clean(rollbackAudit.operation),
      receiptStatus: clean(receipt.status), receiptId: clean(receipt.receipt_id), createdAt: clean(receipt.created_at)
    };
    const matched = actual.operation === 'rollback' && actual.receiptStatus === 'rolled-back';
    return matched ? verified(actual) : invalid(actual, 'IDENTITY_ROLLBACK_RECEIPT_MISMATCH', expected);
  }
  return null;
}

async function repair(event = {}, store) {
  const type = clean(event.event_type || event.eventType);
  const expected = projection(event);
  if (type === 'message.reaction.updated') {
    if (!store.getMessage(clean(expected.messageId))) return false;
    store.updateMessage(clean(expected.messageId), { reactions: array(expected.reactions) }); return true;
  }
  if (type === 'message.revoked') {
    const row = store.getMessage(clean(expected.messageId)); if (!row) return false;
    store.updateMessage(clean(expected.messageId), { revoked: Boolean(expected.revoked), text: clean(expected.text), messageType: clean(expected.messageType || row.messageType) }); return true;
  }
  if (type === 'message.receipt.updated') {
    if (!store.getMessage(clean(expected.messageId))) return false;
    store.updateMessage(clean(expected.messageId), { deliveryStatus: clean(expected.status), status: clean(expected.status) }); return true;
  }
  if (type === 'message.receipt.range.updated') {
    const ids = array(expected.messageIds).map(clean).filter(Boolean); if (!ids.length) return false;
    let count = 0;
    for (const id of ids) if (store.getMessage(id)) { store.updateMessage(id, { deliveryStatus: clean(expected.status), status: clean(expected.status) }); count += 1; }
    return count === ids.length;
  }
  if (type === 'conversation.read') {
    const row = store.db.prepare('SELECT 1 FROM r32_conversations WHERE session_key=?').get(clean(expected.conversationId)); if (!row) return false;
    store.db.prepare('UPDATE r32_conversations SET unread_count=?, updated_at=? WHERE session_key=?').run(Number(expected.unreadCount || 0), new Date().toISOString(), clean(expected.conversationId)); return true;
  }
  return false;
}

function supported(type) { return REPAIRABLE_TYPES.has(clean(type)) || VERIFIED_TYPES.has(clean(type)); }
module.exports = { REPAIRABLE_TYPES, VERIFIED_TYPES, projection, actualFor, repair, supported, isVerified, subsetMatches };
