'use strict';

const crypto = require('node:crypto');
const { getStore } = require('./storeProvider');
const { parseJson, stableId } = require('../lib/r32SqliteStore');
const eventBus = require('../services/eventBus');
const performancePolicy = require('../services/performancePolicy');
const messageSpeakerAuthority = require('../services/messageSpeakerAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { createPlatformCoreRepository } = require('./platformCoreRepository');
const { projectMessage, projectDomainEvent, applyProjectionToMessage } = require('../services/domainMessageProjector');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const logger = require('../services/logger');
const operationalProjectionReceipts = require('../services/operationalProjectionReceiptAuthority');
const externalIdentityAuthority = require('../services/externalIdentityAuthority').singleton;
const identityDomainEventOutbox = require('../services/identityDomainEventOutboxService').singleton;
const backgroundJobAuthority = require('../services/backgroundJobAuthority');

const platformCoreRepository = createPlatformCoreRepository({ storeProvider: getStore });
const domainEventLog = new DomainEventLogService({ repository: platformCoreRepository });
const identityLinkAuthority = new IdentityLinkAuthority({ repository: platformCoreRepository });
identityDomainEventOutbox.start(observation => identityLinkAuthority.finalizeObservation(observation));

const OPERATIONAL_PROJECTOR_NAME = 'operational-projection';
const OPERATIONAL_PROJECTOR_VERSION = 'round13-v2';
function appendOperationalEvent({ platform, sourceAccountId, eventType, externalEventId = '', idempotencyKey, occurredAt = '', projection = {}, payload = {} }) {
  const created = domainEventLog.append({
    platform: String(platform || '').trim().toLowerCase(),
    sourceAccountId: String(sourceAccountId || '').trim(),
    externalEventId: String(externalEventId || '').trim(),
    eventType,
    idempotencyKey,
    occurredAt: occurredAt || now(),
    payload: { ...payload, projection },
    retentionDays: 30
  });
  return created;
}
function recordOperationalApplied(created, _projection, targetRefs = []) {
  if (!created?.event?.eventId) return null;
  return operationalProjectionReceipts.verifyAndRecord({ created, eventLog: domainEventLog, repository: platformCoreRepository, store: getStore(), targetRefs });
}
function recordOperationalFailure(created, cause, targetRefs = []) {
  if (!created?.event?.eventId) return null;
  try {
    return domainEventLog.recordProjectionFailure({
      eventId: created.event.eventId,
      projectorName: OPERATIONAL_PROJECTOR_NAME,
      projectorVersion: OPERATIONAL_PROJECTOR_VERSION,
      failureCode: cause?.code || 'OPERATIONAL_PROJECTION_FAILED',
      failureReason: cause?.message || String(cause || ''),
      targetRefs
    });
  } catch (receiptError) {
    logger.error('domain-event', 'operational-projection-failure-receipt-write-failed', {
      eventId: created.event.eventId,
      code: receiptError.code || 'OPERATIONAL_RECEIPT_FAILED',
      error: receiptError.message
    });
    return null;
  }
}

function now() { return new Date().toISOString(); }
function projectionRetry(attempts) { return new Date(Date.now() + Math.min(300, Math.max(5, 2 ** Math.min(8, Number(attempts || 0)))) * 1000).toISOString(); }
function appendInboundEventWithProjectionJob(store, input = {}) {
  return store.transaction(() => {
    const created = domainEventLog.append(input);
    const eventId = String(created?.event?.eventId || '').trim();
    if (!eventId) throw Object.assign(new Error('Domain event append did not return eventId'), { code: 'DOMAIN_EVENT_ID_MISSING' });
    const at = now();
    store.db.prepare(`INSERT INTO domain_event_projection_jobs(
      job_id,event_id,projector_name,state,attempts,claim_token,lease_expires_at,next_attempt_at,last_error,created_at,updated_at
    ) VALUES(?,?,?,'pending',0,'','','','',?,?)
    ON CONFLICT(event_id) DO NOTHING`).run(`project-${eventId}`, eventId, 'message-projection', at, at);
    return created;
  });
}
function existingAuthoritativeDomainEvent(eventId) {
  const row = platformCoreRepository.getDomainEvent(String(eventId || '').trim());
  if (!row) throw Object.assign(new Error('Authoritative domain event for projection replay was not found'), {
    code: 'DOMAIN_EVENT_NOT_FOUND', status: 404, eventId: String(eventId || '').trim()
  });
  return {
    created: false,
    event: {
      eventId: row.event_id,
      schemaVersion: Number(row.schema_version || 1),
      platform: row.platform,
      sourceAccountId: row.source_account_id,
      externalEventId: row.external_event_id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
      redactionVersion: row.redaction_version,
      payload: row.payload || {},
      payloadSha256: row.payload_sha256,
      retentionUntil: row.retention_until,
      replayState: row.replay_state
    }
  };
}

function recoverExpiredProjectionJob(store, eventId = '') {
  const at = now();
  const params = [at, at, at];
  let sql = `UPDATE domain_event_projection_jobs
    SET state='failed',claim_token='',lease_expires_at='',last_error='PROCESSING_LEASE_EXPIRED',next_attempt_at=?,updated_at=?
    WHERE state='processing' AND lease_expires_at<>'' AND lease_expires_at<=?`;
  if (eventId) { sql += ' AND event_id=?'; params.push(eventId); }
  return Number(store.db.prepare(sql).run(...params).changes || 0);
}
function claimProjectionJob(store, eventId) {
  recoverExpiredProjectionJob(store, eventId);
  const token = crypto.randomUUID();
  const at = now();
  const lease = new Date(Date.now() + 60000).toISOString();
  const updated = store.db.prepare(`UPDATE domain_event_projection_jobs
    SET state='processing',attempts=attempts+1,claim_token=?,lease_expires_at=?,updated_at=?
    WHERE event_id=? AND state IN ('pending','failed') AND (next_attempt_at='' OR next_attempt_at<=?)`)
    .run(token, lease, at, eventId, at);
  if (Number(updated.changes || 0) !== 1) {
    const row = store.db.prepare('SELECT * FROM domain_event_projection_jobs WHERE event_id=?').get(eventId);
    if (row?.state === 'applied') return { eventId, applied: true, token: '' };
    throw Object.assign(new Error('Domain event projection job is not claimable'), {
      code: row?.state === 'processing' ? 'DOMAIN_EVENT_PROJECTION_JOB_BUSY' : 'DOMAIN_EVENT_PROJECTION_JOB_NOT_CLAIMABLE',
      status: 409, eventId, state: row?.state || 'missing'
    });
  }
  return { eventId, token, applied: false };
}
function settleProjectionJobWithinTransaction(store, claim, state, error = null) {
  if (!claim || claim.applied) return;
  const at = now();
  const target = state === 'applied' ? 'applied' : 'failed';
  const row = store.db.prepare('SELECT attempts FROM domain_event_projection_jobs WHERE event_id=?').get(claim.eventId);
  const nextAttemptAt = target === 'failed' ? projectionRetry(Number(row?.attempts || 1)) : '';
  const updated = store.db.prepare(`UPDATE domain_event_projection_jobs
    SET state=?,claim_token='',lease_expires_at='',next_attempt_at=?,last_error=?,updated_at=?
    WHERE event_id=? AND state='processing' AND claim_token=?`)
    .run(target, nextAttemptAt, target === 'failed' ? String(error?.message || error?.code || 'DOMAIN_EVENT_PROJECTION_FAILED').slice(0, 2000) : '', at, claim.eventId, claim.token);
  if (Number(updated.changes || 0) !== 1) throw Object.assign(new Error('Stale projection completion rejected'), { code: 'DOMAIN_EVENT_PROJECTION_STALE_COMPLETION', eventId: claim.eventId });
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function normalizeMessage(message = {}) {
  const conversationId = String(message.conversationId || message.sessionKey || '').trim();
  if (!conversationId) throw new Error('INVALID_MESSAGE_CONVERSATION');
  const externalMessageId = String(message.externalMessageId || message.messageId || message.id || '').trim();
  const timestamp = String(message.timestamp || message.sentAt || message.createdAt || now());
  const dedupeKey = String(message.dedupeKey || '').trim() || stableId('msg', [message.accountId, conversationId, externalMessageId, timestamp, message.text]);
  return messageSpeakerAuthority.normalizeMessageIdentity({
    ...message,
    id: dedupeKey,
    dedupeKey,
    externalMessageId: externalMessageId || dedupeKey,
    conversationId,
    sessionKey: conversationId,
    messageType: message.type || message.messageType || 'text',
    type: message.type || message.messageType || 'text',
    sentAt: timestamp,
    timestamp,
    senderId: message.senderId || message.sender || '',
    quotedMessageId: message.quotedMessageId || message.quoted?.id || '',
    deliveryStatus: message.deliveryStatus || message.status || ''
  });
}

function firstAvatar(...sources) {
  for (const source of sources) {
    if (!source) continue;
    for (const key of ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url']) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return '';
}

function facebookPeerId(message = {}) {
  const explicit = String(message.pageScopedUserId || message.contactExternalId || '').trim();
  if (explicit) return explicit;
  return String(message.chatJid || message.externalId || '').trim().replace(/^facebook:/i, '');
}

function ensureFacebookContact(store, message = {}) {
  if (String(message.platform || '').trim().toLowerCase() !== 'facebook') return '';
  const externalId = facebookPeerId(message);
  const accountId = String(message.accountId || message.sourceAccountId || '').trim();
  if (!externalId || !accountId) return '';
  const requestedContactId = String(message.contactId || '').trim() || stableId('contact', ['facebook', accountId, externalId]);
  const existing = store.db.prepare(`
    SELECT * FROM contacts
    WHERE platform='facebook' AND account_id=? AND external_id=?
    LIMIT 1
  `).get(accountId, externalId) || store.db.prepare('SELECT * FROM contacts WHERE id=?').get(requestedContactId) || null;
  const existingPayload = parseJson(existing?.payload_json, {}) || {};
  const displayName = String(message.contactName || message.senderName || (!message.fromMe ? message.sender : '') || existing?.display_name || `Facebook ${externalId}`).trim();
  const avatarUrl = firstAvatar(message, { avatarUrl: existing?.avatar_url }, existingPayload);
  const sourceAccountId = String(message.sourceAccountId || existingPayload.sourceAccountId || accountId).trim();
  const pageId = String(message.pageId || existingPayload.pageId || '').trim();
  const externalConversationId = String(message.externalConversationId || existingPayload.externalConversationId || '').trim();
  const contactId = store.upsertContact({
    ...existingPayload,
    id: existing?.id || requestedContactId,
    platform: 'facebook',
    accountId,
    externalId,
    displayName,
    avatarUrl,
    avatarUpdatedAt: message.avatarUpdatedAt || message.avatar_updated_at || existing?.avatar_updated_at || existingPayload.avatarUpdatedAt || '',
    avatarStatus: message.avatarStatus || message.avatar_status || existing?.avatar_status || existingPayload.avatarStatus || '',
    tags: parseJson(existing?.tags_json, []),
    aliases: parseJson(existing?.aliases_json, []),
    source: message.source || existing?.source || 'facebook-message',
    lastSeenAt: message.timestamp || message.sentAt || existing?.last_seen_at || now(),
    sourceAccountId,
    pageId,
    pageScopedUserId: externalId,
    externalConversationId,
    canonicalContactId: existing?.canonical_contact_id || existing?.id || requestedContactId,
    mergedIntoId: existing?.merged_into_id || '',
    tombstonedAt: existing?.tombstoned_at || '',
    createdAt: existing?.created_at || message.timestamp || message.sentAt || now()
  });
  message.contactId = contactId;
  message.contactExternalId = externalId;
  message.pageScopedUserId = externalId;
  message.sourceAccountId = sourceAccountId;
  return contactId;
}

function conversationFromRow(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  const contactPayload = parseJson(row.contact_payload_json, {}) || {};
  const avatarUrl = firstAvatar(
    { avatarUrl: row.avatar_url },
    payload,
    { avatarUrl: row.contact_avatar_url },
    contactPayload
  );
  return {
    ...contactPayload,
    ...payload,
    id: row.session_key,
    sessionKey: row.session_key,
    conversationId: row.session_key,
    accountId: row.account_id,
    contactId: row.contact_id,
    platform: row.platform,
    title: row.title || row.contact_display_name || payload.title || payload.contactName || '',
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    avatarUpdatedAt: row.avatar_updated_at || row.contact_avatar_updated_at || payload.avatarUpdatedAt || payload.avatar_updated_at || contactPayload.avatarUpdatedAt || contactPayload.avatar_updated_at || '',
    avatar_updated_at: row.avatar_updated_at || row.contact_avatar_updated_at || payload.avatarUpdatedAt || payload.avatar_updated_at || contactPayload.avatarUpdatedAt || contactPayload.avatar_updated_at || '',
    avatarStatus: row.avatar_status || row.contact_avatar_status || payload.avatarStatus || payload.avatar_status || contactPayload.avatarStatus || contactPayload.avatar_status || '',
    avatar_status: row.avatar_status || row.contact_avatar_status || payload.avatarStatus || payload.avatar_status || contactPayload.avatarStatus || contactPayload.avatar_status || '',
    lastMessage: row.last_message,
    lastText: row.last_message,
    lastMessageAt: row.last_message_at,
    updatedAt: row.updated_at,
    unread: Number(row.unread_count || 0),
    unreadCount: Number(row.unread_count || 0),
    routeState: row.route_state,
    archived: Boolean(row.archived_at || row.contact_archived_at),
    archivedAt: row.archived_at || row.contact_archived_at || '',
    archiveReason: row.archive_reason || row.contact_archive_reason || '',
    archivedBy: row.archived_by || row.contact_archived_by || '',
    pinned: payload.pinned === true,
    pinnedAt: String(payload.pinnedAt || ''),
    pinnedBy: String(payload.pinnedBy || '')
  };
}

function resolveMergedConversationKey(store, conversationId) {
  let key = String(conversationId || '').trim();
  if (!key) return '';
  const visited = new Set();
  for (let attempt = 0; attempt < 8 && key && !visited.has(key); attempt += 1) {
    visited.add(key);
    const row = store.db.prepare('SELECT merged_into FROM r32_conversations WHERE session_key=?').get(key);
    const next = String(row?.merged_into || '').trim();
    if (next) { key = next; continue; }
    const hasAudit = store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity_merge_audit'").get();
    if (hasAudit) {
      const audit = store.db.prepare(`SELECT target_id FROM identity_merge_audit
        WHERE platform='whatsapp' AND entity_type='conversation' AND source_id=?
        ORDER BY created_at DESC LIMIT 1`).get(key);
      const audited = String(audit?.target_id || '').trim();
      if (audited && audited !== key) { key = audited; continue; }
    }
    break;
  }
  return key;
}

function getConversation(store, conversationId) {
  const resolvedConversationId = resolveMergedConversationKey(store, conversationId);
  const row = store.db.prepare(`
    SELECT conv.*, contact.avatar_url AS contact_avatar_url,
           contact.display_name AS contact_display_name,
           contact.payload_json AS contact_payload_json,
           contact.avatar_updated_at AS contact_avatar_updated_at,
           contact.avatar_status AS contact_avatar_status,
           contact.archived_at AS contact_archived_at,
           contact.archive_reason AS contact_archive_reason,
           contact.archived_by AS contact_archived_by
    FROM r32_conversations conv
    LEFT JOIN contacts contact ON contact.id = conv.contact_id
    WHERE conv.session_key=?
  `).get(resolvedConversationId);
  return row ? conversationFromRow(row) : null;
}

function mergeConversationPayload(store, message, inserted) {
  const current = getConversation(store, message.conversationId) || {};
  const incoming = messageSpeakerAuthority.isPeerInbound(message);
  const historical = message.historical === true || /history/i.test(String(message.source || ''));
  const unread = Math.max(0, Number(current.unread || 0) + (inserted && incoming && !historical ? 1 : 0));
  const platform = message.platform || current.platform || (String(message.accountId || '').toLowerCase().includes('telegram') ? 'telegram' : String(message.accountId || '').toLowerCase().includes('facebook') ? 'facebook' : 'whatsapp');
  const title = message.contactName || message.senderName || (!message.fromMe ? message.sender : '') || current.title || message.chatJid || message.conversationId;
  const avatarUrl = firstAvatar(message, current);
  const payload = {
    ...current,
    accountId: message.accountId || current.accountId || '',
    contactId: message.contactId || current.contactId || '',
    chatJid: message.chatJid || current.chatJid || '',
    platform,
    title,
    contactName: title,
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    lastMessage: message.text || `[${message.type}]`,
    lastMessageAt: message.timestamp,
    unread,
    sourceAccountId: message.sourceAccountId || current.sourceAccountId || message.accountId || '',
    pageId: message.pageId || current.pageId || '',
    pageScopedUserId: message.pageScopedUserId || message.contactExternalId || current.pageScopedUserId || '',
    contactExternalId: message.contactExternalId || current.contactExternalId || '',
    externalConversationId: message.externalConversationId || current.externalConversationId || '',
    updatedAt: message.timestamp
  };
  store.upsertConversation({ ...payload, sessionKey: message.conversationId, unreadCount: unread });
  return getConversation(store, message.conversationId);
}

function inboundIdentityScope(message = {}) {
  if (!messageSpeakerAuthority.isPeerInbound(message)) return null;
  const platform = String(message.platform || '').trim().toLowerCase();
  const sourceAccountId = String(message.sourceAccountId || message.accountId || '').trim();
  let externalId = '';
  if (platform === 'facebook') externalId = String(message.pageScopedUserId || message.contactExternalId || message.chatJid || message.senderId || '').trim().replace(/^facebook:/i, '');
  else if (platform === 'telegram') externalId = String(message.contactExternalId || message.senderId || message.chatJid || '').trim().replace(/^telegram:/i, '');
  else if (platform === 'whatsapp') externalId = String(message.senderId || message.contactExternalId || message.chatJid || '').trim();
  if (!platform || !sourceAccountId || !externalId) return null;
  if (platform === 'whatsapp' && (/@g\.us$/i.test(externalId) || /status@broadcast$/i.test(externalId))) return null;
  return { platform, sourceAccountId, externalId };
}

async function upsert(input) {
  const requestedBackgroundJobs = Array.isArray(input?.backgroundJobs) ? input.backgroundJobs.filter(Boolean) : [];
  const projectionReplayEventId = String(input?.authoritativeDomainEventId || input?.projectionReplayEventId || '').trim();
  const message = normalizeMessage(input);
  const store = getStore();
  const existingByDedupe = store.getMessage(message.id);
  if (existingByDedupe) {
    const aliases = [...new Set([
      ...(Array.isArray(existingByDedupe.externalMessageAliases) ? existingByDedupe.externalMessageAliases : []),
      existingByDedupe.externalMessageId,
      message.externalMessageId
    ].map(value => String(value || '').trim()).filter(Boolean))];
    message.externalMessageAliases = aliases;
    message.externalMessageId = String(existingByDedupe.externalMessageId || message.externalMessageId || '').trim();
    const oldAttachments = Array.isArray(existingByDedupe.attachments) ? existingByDedupe.attachments : [];
    const newAttachments = Array.isArray(message.attachments) ? message.attachments : [];
    const oldReady = oldAttachments.some(item => String(item?.downloadStatus || '').toLowerCase() === 'ready' && (item?.mediaUrl || item?.localFile));
    const newReady = newAttachments.some(item => String(item?.downloadStatus || '').toLowerCase() === 'ready' && (item?.mediaUrl || item?.localFile));
    if (oldReady && !newReady) {
      message.attachments = oldAttachments;
      message.mediaUrl = existingByDedupe.mediaUrl || message.mediaUrl;
      message.mediaPath = existingByDedupe.mediaPath || message.mediaPath;
    }
  }
  const resolvedConversationId = resolveMergedConversationKey(store, message.conversationId);
  if (resolvedConversationId && resolvedConversationId !== message.conversationId) {
    const target = getConversation(store, resolvedConversationId) || {};
    const originalConversationId = message.conversationId;
    message.conversationId = resolvedConversationId;
    message.sessionKey = resolvedConversationId;
    message.chatJid = target.chatJid || target.externalId || message.chatJid;
    message.contactId = target.contactId || message.contactId;
    message.contactName = target.title || target.contactName || message.contactName;
    message.avatarUrl = target.avatarUrl || message.avatarUrl;
    message.rawMeta = { ...(message.rawMeta || {}), mergedFromConversationId: originalConversationId };
  }
  if (message.externalMessageId && message.accountId) {
    // Inbound remote ids are scoped to the concrete chat. Treating them as
    // account-global can merge unrelated conversations when ids collide.
    // Outbound companion-device echoes may legitimately arrive under an alias
    // JID, so they retain an account-level fallback after the exact lookup.
    const exact = findTarget({
      accountId: message.accountId,
      chatJid: message.chatJid || '',
      targetId: message.externalMessageId
    });
    const existing = exact || (message.fromMe
      ? findTarget({ accountId: message.accountId, chatJid: '', targetId: message.externalMessageId })
      : null);
    if (existing) {
      message.id = existing.row.id;
      message.dedupeKey = existing.row.id;
    }
  }
  let authoritativeDomainEvent = null;
  let outboundEchoDomainEvent = null;
  const ingressPlatform = String(message.platform || '').trim().toLowerCase();
  const ingressAccountId = String(message.sourceAccountId || message.accountId || '').trim();
  if (messageSpeakerAuthority.isPeerInbound(message)) {
    if (!ingressPlatform || !ingressAccountId) {
      throw Object.assign(new Error('入站消息缺少平台或来源账号，不能写入权威领域事件。'), {
        code: 'DOMAIN_EVENT_SCOPE_INCOMPLETE', status: 409
      });
    }
    const expectedProjection = projectMessage(message);
    authoritativeDomainEvent = projectionReplayEventId
      ? existingAuthoritativeDomainEvent(projectionReplayEventId)
      : appendInboundEventWithProjectionJob(store, {
        platform: ingressPlatform,
        sourceAccountId: ingressAccountId,
        externalEventId: message.externalMessageId || message.id,
        eventType: 'message.received',
        idempotencyKey: ['ingress', ingressPlatform, ingressAccountId, message.conversationId, message.externalMessageId || message.id].join(':'),
        occurredAt: message.timestamp,
        payload: { projection: expectedProjection },
        retentionDays: 30
      });
    const eventProjection = projectDomainEvent(authoritativeDomainEvent.event);
    if (!projectionReplayEventId && JSON.stringify(eventProjection) !== JSON.stringify(expectedProjection)) {
      throw Object.assign(new Error('领域事件归一化投影与入站消息不一致。'), {
        code: 'DOMAIN_EVENT_PROJECTION_NORMALIZATION_MISMATCH', status: 409,
        expectedProjection, eventProjection, eventId: authoritativeDomainEvent.event?.eventId || ''
      });
    }
    // During durable replay the persisted event projection is authoritative.
    // The worker transport adds replay metadata that must never participate in
    // event equality or create a new event identity.
    Object.assign(message, applyProjectionToMessage(message, eventProjection));
  } else if (message.fromMe === true && ingressPlatform && ingressAccountId && /echo|history|external|webhook|sync/i.test(String(message.source || ''))) {
    const projection = projectMessage(message);
    outboundEchoDomainEvent = appendOperationalEvent({
      platform: ingressPlatform, sourceAccountId: ingressAccountId, eventType: 'message.echo.received',
      externalEventId: message.externalMessageId || message.id,
      idempotencyKey: ['echo', ingressPlatform, ingressAccountId, message.conversationId, message.externalMessageId || message.id].join(':'),
      occurredAt: message.timestamp, projection, payload: { source: message.source || '' }
    });
  }
  let inserted = false;
  let conversation;
  let identityObservation = null;
  let saved = null;
  let projectionReceipt = null;
  let projectionClaim = null;
  const identityScope = inboundIdentityScope(message);
  if (authoritativeDomainEvent?.event?.eventId) {
    projectionClaim = store.transaction(() => claimProjectionJob(store, authoritativeDomainEvent.event.eventId));
  }
  try {
    store.transaction(() => {
      inserted = !store.db.prepare('SELECT 1 FROM r32_messages WHERE id=?').get(message.id);
      ensureFacebookContact(store, message);
      if (identityScope) {
        identityObservation = identityLinkAuthority.observeWithinTransaction({
          ...identityScope,
          displayName: message.contactName || message.senderName || message.sender || '',
          profileContactId: message.contactId || '',
          conversationId: message.conversationId || '',
          confidence: 0.6,
          evidenceRefs: [message.id],
          reason: '平台入站消息观察到稳定身份。',
          payload: { firstObservedConversationId: message.conversationId, firstObservedMessageId: message.id }
        });
        message.personId = identityObservation.person?.personId || '';
        message.identityLinkId = identityObservation.link?.identityLinkId || '';
        const externalIdentity = externalIdentityAuthority.upsertWithinTransaction({
          workspaceId: identityObservation.link?.workspaceId || 'default',
          platform: identityScope.platform,
          sourceAccountId: identityScope.sourceAccountId,
          externalId: identityScope.externalId,
          contactId: message.contactId || identityObservation.contactId || '',
          personId: message.personId,
          identityLinkId: message.identityLinkId,
          conversationId: message.conversationId,
          state: 'active',
          payload: { observedFromMessageId: message.id }
        }, store);
        message.externalIdentityId = externalIdentity.externalIdentityId;
      }
      store.touchConversationFromMessage(message);
      store.upsertMessage(message);
      conversation = mergeConversationPayload(store, message, inserted);
      if (message.personId && message.conversationId) {
        store.db.prepare('UPDATE r32_conversations SET person_id=?,updated_at=? WHERE session_key=?').run(message.personId, now(), message.conversationId);
        conversation = getConversation(store, message.conversationId) || conversation;
      }
      // The identity domain event is part of the same durable transaction as
      // the identity link, binding, conversation and message. The consumer may
      // run after commit, but the obligation to publish can no longer be lost
      // by a process crash between commit and finalizeObservation().
      if (identityObservation) identityDomainEventOutbox.enqueue(identityObservation, null, store);
      saved = store.getMessage(message.id) || message;

      // Durable follow-up work must be committed with the authoritative
      // message projection. This closes the crash window between message
      // commit and an in-memory debounce/setImmediate callback.
      const durableJobs = [...requestedBackgroundJobs];
      if (messageSpeakerAuthority.isPeerInbound(saved)) {
        const entityId = String(saved.externalMessageId || saved.id || '').trim();
        if (entityId) {
          durableJobs.push({
            jobType: 'ai-conversation-analysis',
            platform: String(saved.platform || '').trim().toLowerCase(),
            sourceAccountId: String(saved.sourceAccountId || saved.accountId || '').trim(),
            conversationId: String(saved.conversationId || saved.sessionKey || '').trim(),
            entityId,
            revision: entityId,
            maxAttempts: 20,
            payload: { conversationId: String(saved.conversationId || saved.sessionKey || '').trim(), messageId: entityId }
          });
        }
      }
      for (const job of durableJobs) {
        backgroundJobAuthority.enqueue(job, { maxAttempts: Number(job.maxAttempts || 5) }, store);
      }

      if (authoritativeDomainEvent?.event?.eventId) {
        const eventProjection = projectDomainEvent(authoritativeDomainEvent.event);
        const savedProjection = projectMessage(saved);
        if (JSON.stringify(eventProjection) !== JSON.stringify(savedProjection)) {
          throw Object.assign(new Error('权威领域事件与消息投影在提交前发生差异。'), {
            code: 'DOMAIN_EVENT_PROJECTION_DIVERGED_BEFORE_COMMIT', status: 409,
            eventId: authoritativeDomainEvent.event.eventId, messageId: saved.id
          });
        }
        projectionReceipt = domainEventLog.recordAppliedProjection({
          eventId: authoritativeDomainEvent.event.eventId,
          projectorName: 'message-projection',
          projectorVersion: 'round12-v2',
          projection: savedProjection,
          targetRefs: [{ table: 'r32_messages', id: saved.id }]
        });
        settleProjectionJobWithinTransaction(store, projectionClaim, 'applied');
      }
    });
  } catch (cause) {
    if (authoritativeDomainEvent?.event?.eventId) {
      try {
        domainEventLog.recordProjectionFailure({
          eventId: authoritativeDomainEvent.event.eventId,
          projectorName: 'message-projection',
          projectorVersion: 'round12-v2',
          failureCode: cause.code || 'MESSAGE_PROJECTION_TRANSACTION_FAILED',
          failureReason: cause.message,
          targetRefs: [{ table: 'r32_messages', id: message.id }]
        });
      } catch (receiptError) {
        logger.error('domain-event', 'projection-failure-receipt-write-failed', {
          eventId: authoritativeDomainEvent.event.eventId,
          messageId: message.id,
          code: receiptError.code || 'PROJECTION_FAILURE_RECEIPT_FAILED',
          error: receiptError.message
        });
      }
    }
    if (outboundEchoDomainEvent?.event?.eventId) recordOperationalFailure(outboundEchoDomainEvent, cause, [{ table: 'r32_messages', id: message.id }]);
    if (authoritativeDomainEvent?.event?.eventId && projectionClaim && !projectionClaim.applied) {
      try {
        store.transaction(() => settleProjectionJobWithinTransaction(store, projectionClaim, 'failed', cause));
      } catch (jobError) {
        logger.error('domain-event', 'projection-job-failure-checkpoint-failed', {
          eventId: authoritativeDomainEvent.event.eventId, code: jobError.code || 'PROJECTION_JOB_FAILURE_CHECKPOINT_FAILED', error: jobError.message
        });
      }
      const pending = {
        inserted: false,
        committed: true,
        projectionStatus: 'pending',
        repairRequired: true,
        eventId: authoritativeDomainEvent.event.eventId,
        message: null,
        conversation: null,
        failure: { code: cause.code || 'MESSAGE_PROJECTION_TRANSACTION_FAILED', message: cause.message }
      };
      eventBus.publish('domain-event:projection-pending', pending);
      return pending;
    }
    throw cause;
  }
  // The durable outbox was committed with the identity transaction above.
  // Only its lease/token consumer may call finalizeObservation(); direct
  // post-commit finalization would recreate a crash window and a second
  // authority. Wake the worker without changing the request result.
  if (identityObservation) {
    setImmediate(() => identityDomainEventOutbox.drainOnce().catch(error => {
      logger.warn('identity-link', 'identity-domain-event-outbox-drain-pending', {
        code: error.code || 'IDENTITY_DOMAIN_EVENT_OUTBOX_DRAIN_FAILED',
        platform: identityScope?.platform || '',
        accountId: identityScope?.sourceAccountId || '',
        messageId: message.id,
        error: error.message
      });
    }));
    eventBus.publish('identity-link:domain-event-pending', {
      code: 'IDENTITY_DOMAIN_EVENT_OUTBOX_COMMITTED',
      platform: identityScope?.platform || '',
      accountId: identityScope?.sourceAccountId || '',
      messageId: message.id,
      auditId: identityObservation.auditId || ''
    });
  }
  saved = saved || store.getMessage(message.id) || message;
  if (authoritativeDomainEvent?.event?.eventId && projectionReceipt) {
    eventBus.publish('domain-event:projection-applied', {
      eventId: authoritativeDomainEvent.event.eventId,
      messageId: saved.id,
      projectionHash: projectionReceipt.projectionHash
    });
  }
  if (outboundEchoDomainEvent?.event?.eventId) recordOperationalApplied(outboundEchoDomainEvent, projectMessage(saved), [{ table: 'r32_messages', id: saved.id }]);
  if (inserted && saved.platform && (saved.sourceAccountId || saved.accountId)) {
    const sourceAccountId = saved.sourceAccountId || saved.accountId;
    if (saved.contactId) {
      const contactProjection = { contactId: saved.contactId, personId: saved.personId || '', platform: saved.platform, accountId: sourceAccountId };
      const contactEvent = appendOperationalEvent({ platform: saved.platform, sourceAccountId, eventType: 'contact.observed', externalEventId: [saved.contactId, saved.id].join(':'), idempotencyKey: ['contact-observed', saved.platform, sourceAccountId, saved.contactId, saved.id].join(':'), projection: contactProjection });
      recordOperationalApplied(contactEvent, contactProjection, [{ table: 'contacts', id: saved.contactId }]);
    }
    const conversationProjection = { conversationId: saved.conversationId || saved.sessionKey, contactId: saved.contactId || '', personId: saved.personId || '', platform: saved.platform, accountId: sourceAccountId };
    const conversationEvent = appendOperationalEvent({ platform: saved.platform, sourceAccountId, eventType: 'conversation.observed', externalEventId: [saved.conversationId || saved.sessionKey, saved.id].join(':'), idempotencyKey: ['conversation-observed', saved.platform, sourceAccountId, saved.conversationId || saved.sessionKey, saved.id].join(':'), projection: conversationProjection });
    recordOperationalApplied(conversationEvent, conversationProjection, [{ table: 'r32_conversations', id: saved.conversationId || saved.sessionKey }]);
  }
  eventBus.publish(inserted ? 'message:inserted' : 'message:updated', { message: saved, conversation });
  return { inserted, message: saved, conversation };
}

function findTarget({ accountId, chatJid, targetId }) {
  const store = getStore();
  const target = String(targetId || '').trim();
  if (!target) return null;
  const direct = store.db.prepare('SELECT * FROM r32_messages WHERE id=?').get(target);
  const row = direct || store.db.prepare(`
    SELECT * FROM r32_messages
    WHERE account_id=?
      AND (
        json_extract(payload_json, '$.externalMessageId')=? OR
        json_extract(payload_json, '$.messageId')=? OR
        json_extract(payload_json, '$.id')=? OR
        EXISTS (
          SELECT 1 FROM json_each(COALESCE(json_extract(payload_json, '$.externalMessageAliases'), '[]'))
          WHERE CAST(value AS TEXT)=?
        )
      )
      AND (?='' OR COALESCE(json_extract(payload_json, '$.chatJid'),'')=?)
    ORDER BY COALESCE(NULLIF(sent_at,''), created_at) DESC
    LIMIT 1
  `).get(String(accountId || ''), target, target, target, target, String(chatJid || ''), String(chatJid || ''));
  return row ? { row, payload: parseJson(row.payload_json, {}) || {} } : null;
}

function getMessageByDedupeKey(dedupeKey) {
  const id = String(dedupeKey || '').trim();
  return id ? (getStore().getMessage(id) || null) : null;
}

function listPendingTelegramEnrichment(accountId, options = {}) {
  const store = getStore();
  const account = String(accountId || '').trim();
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 500)));
  const cursorAt = String(options.cursor?.updatedAt || '').trim();
  const cursorId = String(options.cursor?.id || '').trim();
  const rows = store.db.prepare(`
    SELECT id,updated_at FROM r32_messages
    WHERE account_id=?
      AND COALESCE(json_extract(payload_json,'$.platform'),'')='telegram'
      AND COALESCE(json_extract(payload_json,'$.rawMeta.enrichmentState'),'')='pending'
      AND (?='' OR updated_at>? OR (updated_at=? AND id>?))
    ORDER BY updated_at ASC,id ASC
    LIMIT ?
  `).all(account, cursorAt, cursorAt, cursorAt, cursorId, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const messages = page.map(row => store.getMessage(row.id)).filter(Boolean);
  const last = page[page.length - 1] || null;
  return { messages, hasMore, nextCursor: hasMore && last ? { updatedAt: last.updated_at, id: last.id } : null };
}

function getExternalMessage({ accountId, chatJid = '', targetId }) {
  const found = findTarget({ accountId, chatJid, targetId });
  if (!found) return null;
  return { ...found.payload, id: found.row.id, sessionKey: found.row.session_key, conversationId: found.row.session_key, messageType: found.row.message_type, type: found.row.message_type };
}

function hasExternalMessage({ accountId, chatJid = '', targetId }) {
  return Boolean(findTarget({ accountId, chatJid, targetId }));
}


function weakWhatsappIdentity(...values) {
  return values.filter(Boolean).every(value => {
    const text = String(value || '').trim();
    if (!text) return true;
    if (/^\+?\d{7,18}$/.test(text.replace(/[\s()-]/g, ''))) return true;
    if (/^\d{7,18}(?::\d+)?@(s\.whatsapp\.net|lid)$/i.test(text)) return true;
    return false;
  });
}

function syntheticMobileEchoMarker(payload = {}) {
  const text = JSON.stringify(payload || {});
  return payload?.mobileEchoRepair?.synthetic === true
    || text.includes('你发送了一条暂不支持的消息')
    || text.includes('对方发送了一条暂不支持的消息');
}

function archiveEmptySyntheticMobileEchoConversations(store, accountId, explicitSessions = []) {
  const candidates = new Set((explicitSessions || []).map(String).filter(Boolean));
  const legacyRows = store.db.prepare(`
    SELECT session_key FROM r32_conversations
    WHERE account_id=? AND platform='whatsapp' AND COALESCE(archived_at,'')=''
      AND COALESCE(merged_into,'')=''
      AND NOT EXISTS (SELECT 1 FROM r32_messages m WHERE m.session_key=r32_conversations.session_key)
  `).all(accountId);
  legacyRows.forEach(row => candidates.add(String(row.session_key || '')));
  const archivedConversations = [];
  const archivedContacts = [];
  const archivedAt = now();

  for (const sessionKey of candidates) {
    const conversation = store.db.prepare(`
      SELECT c.*, ct.display_name AS contact_display_name, ct.external_id AS contact_external_id,
             ct.phone AS contact_phone, ct.payload_json AS contact_payload_json,
             ct.archived_at AS contact_archived_at
      FROM r32_conversations c
      LEFT JOIN contacts ct ON ct.id=c.contact_id
      WHERE c.session_key=? AND c.account_id=? AND c.platform='whatsapp'
        AND COALESCE(c.archived_at,'')='' AND COALESCE(c.merged_into,'')=''
    `).get(sessionKey, accountId);
    if (!conversation) continue;
    const messageCount = Number(store.db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(sessionKey)?.n || 0);
    if (messageCount !== 0) continue;
    const payload = parseJson(conversation.payload_json, {}) || {};
    const contactPayload = parseJson(conversation.contact_payload_json, {}) || {};
    if (!syntheticMobileEchoMarker(payload) && !syntheticMobileEchoMarker(contactPayload)) continue;
    if (!weakWhatsappIdentity(conversation.title, conversation.contact_display_name, conversation.contact_external_id, conversation.contact_phone)) continue;

    const nextPayload = {
      ...payload,
      archived: true,
      archivedAt,
      archiveReason: 'synthetic-mobile-voice-echo',
      archivedBy: 'whatsapp-reconciliation',
      lastMessage: '',
      lastMessageAt: '',
      mobileEchoRepair: {
        ...(payload.mobileEchoRepair || {}),
        synthetic: true,
        archivedAt,
        status: 'archived-empty-artifact'
      }
    };
    store.db.prepare(`
      UPDATE r32_conversations
      SET last_message='', last_message_at='', unread_count=0,
          archived_at=?, archive_reason='synthetic-mobile-voice-echo',
          archived_by='whatsapp-reconciliation', payload_json=?, updated_at=?
      WHERE session_key=?
    `).run(archivedAt, JSON.stringify(nextPayload), archivedAt, sessionKey);
    archivedConversations.push(sessionKey);

    const contactId = String(conversation.contact_id || '');
    if (!contactId || conversation.contact_archived_at) continue;
    const otherActive = Number(store.db.prepare(`
      SELECT COUNT(*) AS n FROM r32_conversations
      WHERE contact_id=? AND session_key<>? AND COALESCE(archived_at,'')='' AND COALESCE(merged_into,'')=''
    `).get(contactId, sessionKey)?.n || 0);
    if (otherActive) continue;
    const nextContactPayload = {
      ...contactPayload,
      archived: true,
      archivedAt,
      archiveReason: 'synthetic-mobile-voice-echo',
      archivedBy: 'whatsapp-reconciliation',
      mobileEchoRepair: { synthetic: true, archivedAt, status: 'archived-empty-artifact' }
    };
    store.db.prepare(`
      UPDATE contacts
      SET archived_at=?, archive_reason='synthetic-mobile-voice-echo',
          archived_by='whatsapp-reconciliation', payload_json=?, updated_at=?
      WHERE id=?
    `).run(archivedAt, JSON.stringify(nextContactPayload), archivedAt, contactId);
    archivedContacts.push(contactId);
  }
  return { archivedConversations, archivedContacts };
}

function collapseDuplicateUnsupportedMobileEchoes(accountId = '') {
  const account = String(accountId || '').trim();
  if (!account) return { groups: 0, removed: 0, conversations: [], archivedConversations: [], archivedContacts: [] };
  const store = getStore();
  const groups = store.db.prepare(`
    SELECT session_key, sent_at, text, COUNT(*) AS n
    FROM r32_messages
    WHERE account_id=?
      AND direction IN ('outbound','outgoing')
      AND message_type='unknown'
      AND text IN ('你发送了一条暂不支持的消息','对方发送了一条暂不支持的消息')
      AND COALESCE(sent_at,'')<>''
    GROUP BY session_key, sent_at, text
    HAVING COUNT(*) > 1
  `).all(account);
  const conversations = new Set();
  let removed = 0;
  let archived = { archivedConversations: [], archivedContacts: [] };
  store.transaction(() => {
    const hasFts = Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='r32_messages_fts'").get());
    for (const group of groups) {
      const rows = store.db.prepare(`
        SELECT id FROM r32_messages
        WHERE account_id=? AND session_key=? AND sent_at=? AND text=?
          AND direction IN ('outbound','outgoing') AND message_type='unknown'
        ORDER BY created_at ASC, id ASC
      `).all(account, group.session_key, group.sent_at, group.text);
      for (const row of rows) {
        if (hasFts) store.db.prepare('DELETE FROM r32_messages_fts WHERE message_id=?').run(row.id);
        store.db.prepare('DELETE FROM r32_messages WHERE id=?').run(row.id);
        removed += 1;
      }
      const sessionKey = String(group.session_key || '');
      conversations.add(sessionKey);
      const conversation = store.db.prepare('SELECT payload_json FROM r32_conversations WHERE session_key=?').get(sessionKey);
      const payload = parseJson(conversation?.payload_json, {}) || {};
      payload.mobileEchoRepair = {
        ...(payload.mobileEchoRepair || {}),
        synthetic: true,
        repairedAt: now(),
        removed: Number(rows.length || 0),
        sentAt: String(group.sent_at || ''),
        sourceText: String(group.text || '')
      };
      store.db.prepare('UPDATE r32_conversations SET payload_json=?, updated_at=? WHERE session_key=?')
        .run(JSON.stringify(payload), now(), sessionKey);
    }
    for (const sessionKey of conversations) {
      const latest = store.db.prepare(`
        SELECT text,sent_at FROM r32_messages
        WHERE session_key=?
        ORDER BY COALESCE(NULLIF(sent_at,''),created_at) DESC, created_at DESC, id DESC
        LIMIT 1
      `).get(sessionKey);
      store.db.prepare(`
        UPDATE r32_conversations
        SET last_message=?, last_message_at=?, updated_at=?
        WHERE session_key=?
      `).run(String(latest?.text || ''), String(latest?.sent_at || ''), now(), sessionKey);
    }
    archived = archiveEmptySyntheticMobileEchoConversations(store, account, [...conversations]);
  });
  const result = {
    groups: groups.length,
    removed,
    conversations: [...conversations].filter(Boolean),
    archivedConversations: archived.archivedConversations,
    archivedContacts: archived.archivedContacts
  };
  if (removed || result.archivedConversations.length) eventBus.publish('messages:mobile-echo-repaired', { accountId: account, ...result });
  return result;
}

async function applyReaction({ accountId, chatJid, targetId, emoji, actor }) {
  const store = getStore();
  const found = findTarget({ accountId, chatJid, targetId });
  if (!found) return null;
  const payload = { ...found.payload };
  payload.reactions = Array.isArray(payload.reactions) ? payload.reactions.filter(item => item.actor !== actor) : [];
  if (emoji) payload.reactions.push({ actor, emoji, at: now() });
  const projection = { messageId: found.row.id, reactions: payload.reactions };
  const platform = String(payload.platform || store.db.prepare('SELECT platform FROM r32_conversations WHERE session_key=?').get(found.row.session_key)?.platform || 'unknown').toLowerCase();
  const event = appendOperationalEvent({
    platform, sourceAccountId: accountId, eventType: 'message.reaction.updated',
    externalEventId: `${found.row.id}:${String(actor || '')}:${String(emoji || 'removed')}`,
    idempotencyKey: ['reaction', platform, accountId, found.row.id, actor || '', JSON.stringify(payload.reactions)].join(':'),
    projection,
    payload: { actor: String(actor || ''), emoji: String(emoji || '') }
  });
  try {
    store.transaction(() => store.upsertMessage({ ...payload, id: found.row.id, sessionKey: found.row.session_key, sentAt: found.row.sent_at }));
    recordOperationalApplied(event, projection, [{ table: 'r32_messages', id: found.row.id }]);
  } catch (cause) {
    recordOperationalFailure(event, cause, [{ table: 'r32_messages', id: found.row.id }]);
    throw cause;
  }
  eventBus.publish('message:reaction', { messageId: targetId, emoji, actor, conversationId: payload.conversationId || payload.sessionKey });
  return payload;
}

async function revoke({ accountId, chatJid, targetId }) {
  const store = getStore();
  const found = findTarget({ accountId, chatJid, targetId });
  if (!found) return null;
  const updatedAt = now();
  const payload = {
    ...found.payload, revoked: true, text: '一条消息已被撤回', type: 'revoke', messageType: 'revoke', attachments: [], updatedAt
  };
  const projection = { messageId: found.row.id, revoked: true, type: 'revoke', text: payload.text };
  const platform = String(payload.platform || store.db.prepare('SELECT platform FROM r32_conversations WHERE session_key=?').get(found.row.session_key)?.platform || 'unknown').toLowerCase();
  const event = appendOperationalEvent({
    platform, sourceAccountId: accountId, eventType: 'message.revoked', externalEventId: found.row.id,
    idempotencyKey: ['revoke', platform, accountId, found.row.id].join(':'), projection
  });
  let retraction = null;
  try {
    store.transaction(() => {
      store.upsertMessage({ ...payload, id: found.row.id, sessionKey: found.row.session_key, sentAt: found.row.sent_at });
      const messageIds = [targetId, found.row.id, found.payload.externalMessageId, found.payload.platformMessageId, found.payload.messageId]
        .map(value => String(value || '').trim()).filter(Boolean);
      retraction = require('./workspaceRepository').retractMessageEvidence(found.row.session_key, messageIds, { store, at: updatedAt, publish: false });
    });
    recordOperationalApplied(event, projection, [{ table: 'r32_messages', id: found.row.id }]);
  } catch (cause) {
    recordOperationalFailure(event, cause, [{ table: 'r32_messages', id: found.row.id }]);
    throw cause;
  }
  const updated = { ...payload, evidenceRetraction: retraction };
  const eventPayload = { messageId: targetId, conversationId: updated.conversationId || updated.sessionKey, retraction };
  eventBus.publish('message:revoked', eventPayload);
  if (retraction?.retracted) {
    eventBus.publish('workspace.message-evidence-retracted', retraction);
    eventBus.publish('workspace.profile.updated', retraction);
    if (retraction.insightsInvalidated) eventBus.publish('workspace.insights.updated', retraction);
  }
  return updated;
}

async function markRead(conversationId) {
  const store = getStore();
  const resolvedConversationId = resolveMergedConversationKey(store, conversationId);
  const conversation = store.db.prepare('SELECT platform,account_id FROM r32_conversations WHERE session_key=?').get(resolvedConversationId);
  if (!conversation) return null;
  const projection = { conversationId: resolvedConversationId, unreadCount: 0 };
  const event = appendOperationalEvent({
    platform: conversation.platform, sourceAccountId: conversation.account_id, eventType: 'conversation.read',
    externalEventId: resolvedConversationId,
    idempotencyKey: ['conversation-read', conversation.platform, conversation.account_id, resolvedConversationId].join(':'), projection
  });
  try {
    store.db.prepare('UPDATE r32_conversations SET unread_count=0, updated_at=? WHERE session_key=?').run(now(), resolvedConversationId);
    recordOperationalApplied(event, projection, [{ table: 'r32_conversations', id: resolvedConversationId }]);
  } catch (cause) {
    recordOperationalFailure(event, cause, [{ table: 'r32_conversations', id: resolvedConversationId }]);
    throw cause;
  }
  eventBus.publish('conversation:read', { conversationId: resolvedConversationId, requestedConversationId: String(conversationId || '') });
  return getConversation(store, resolvedConversationId);
}

function listConversations(options = {}) {
  return getStore().listConversations({
    limit: options.limit || 500,
    offset: Math.max(0, Number(options.offset || 0))
  }).map(row => ({
    ...row,
    id: row.sessionKey,
    conversationId: row.sessionKey,
    unread: Number(row.unread ?? row.unreadCount ?? 0),
    lastMessageAt: row.lastMessageAt || row.updatedAt || '',
    pinned: row.pinned === true,
    pinnedAt: String(row.pinnedAt || ''),
    pinnedBy: String(row.pinnedBy || '')
  }));
}

function encodeCursor(row) {
  if (!row) return '';
  const value = { time: String(row.timestamp || row.sentAt || row.createdAt || ''), id: String(row.id || row.dedupeKey || '') };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return parsed?.time && parsed?.id ? { time: String(parsed.time), id: String(parsed.id) } : null;
  } catch (_) { return null; }
}

function normalizeListedMessage(row) {
  return {
    ...row,
    id: row.id,
    dedupeKey: row.dedupeKey || row.id,
    conversationId: row.sessionKey,
    timestamp: row.timestamp || row.sentAt || row.createdAt,
    type: row.type || row.messageType,
    status: row.status || row.deliveryStatus
  };
}

function listMessagePage(conversationId, options = {}) {
  const policy = performancePolicy.read();
  const requested = Number(options.limit || policy.messagePageSize);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.trunc(requested) : policy.messagePageSize, 250));
  const before = decodeCursor(options.before || options.cursor);
  const after = decodeCursor(options.after);
  const store = getStore();
  const resolvedConversationId = resolveMergedConversationKey(store, conversationId);
  const rows = store.listMessages(resolvedConversationId, { limit: limit + 1, before, after });
  const hasMore = rows.length > limit;
  const pageRows = after ? rows.slice(0, limit) : rows.slice(Math.max(0, rows.length - limit));
  const messages = pageRows.map(normalizeListedMessage);
  return {
    messages,
    page: {
      limit,
      streamed: false,
      hasMoreOlder: after ? Boolean(options.hasMoreOlder) : hasMore,
      hasMoreNewer: after ? hasMore : false,
      oldestCursor: encodeCursor(messages[0]),
      newestCursor: encodeCursor(messages.at(-1)),
      direction: after ? 'newer' : before ? 'older' : 'latest'
    }
  };
}

function listMessages(conversationId, options = {}) {
  return listMessagePage(conversationId, options).messages;
}

function listMessagesForExport(conversationId, options = {}) {
  const store = getStore();
  const id = resolveMergedConversationKey(store, conversationId);
  const requested = Number(options.limit || 250001);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.trunc(requested) : 250001, 250001));
  const rows = store.db.prepare(`
    SELECT id, session_key, account_id, sender_id, role, direction, message_type,
           text, media_url, media_path, quoted_message_id, delivery_status,
           sent_at, payload_json, created_at, updated_at
    FROM r32_messages
    WHERE session_key=?
    ORDER BY COALESCE(NULLIF(sent_at,''), created_at) ASC, created_at ASC, id ASC
    LIMIT ?
  `).all(id, limit);
  return rows.map(row => {
    const payload = parseJson(row.payload_json, {}) || {};
    return {
      ...payload,
      id: row.id,
      dedupeKey: row.id,
      sessionKey: row.session_key,
      conversationId: row.session_key,
      accountId: row.account_id,
      senderId: row.sender_id,
      role: row.role,
      direction: row.direction,
      messageType: row.message_type,
      type: row.message_type,
      text: row.text,
      mediaUrl: row.media_url,
      mediaPath: row.media_path,
      quotedMessageId: row.quoted_message_id,
      deliveryStatus: row.delivery_status,
      status: row.delivery_status,
      sentAt: row.sent_at || row.created_at,
      timestamp: row.sent_at || row.created_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

async function updateReceipt({ accountId, chatJid, messageId, status }) {
  const store = getStore();
  const found = findTarget({ accountId, chatJid, targetId: messageId });
  if (!found) return null;
  const payload = {
    ...found.payload, deliveryStatus: String(status ?? ''), status: String(status ?? ''), receiptUpdatedAt: now(),
    id: found.row.id, sessionKey: found.row.session_key, sentAt: found.row.sent_at
  };
  const projection = { messageId: found.row.id, status: payload.deliveryStatus };
  const platform = String(payload.platform || store.db.prepare('SELECT platform FROM r32_conversations WHERE session_key=?').get(found.row.session_key)?.platform || 'unknown').toLowerCase();
  const event = appendOperationalEvent({
    platform, sourceAccountId: accountId, eventType: 'message.receipt.updated',
    externalEventId: `${found.row.id}:${payload.deliveryStatus}`,
    idempotencyKey: ['receipt', platform, accountId, found.row.id, payload.deliveryStatus].join(':'), projection
  });
  try {
    store.transaction(() => store.upsertMessage(payload));
    recordOperationalApplied(event, projection, [{ table: 'r32_messages', id: found.row.id }]);
  } catch (cause) {
    recordOperationalFailure(event, cause, [{ table: 'r32_messages', id: found.row.id }]);
    throw cause;
  }
  eventBus.publish('message:receipt-persisted', { accountId, chatJid, messageId, status, conversationId: payload.conversationId || payload.sessionKey });
  return payload;
}

async function updateReceiptsThrough({ accountId, chatJid, watermark, status = 'read' }) {
  const store = getStore();
  const numeric = Number(watermark || 0);
  const cutoff = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric).toISOString() : String(watermark || now());
  const rows = store.db.prepare(`
    SELECT * FROM r32_messages
    WHERE account_id=? AND direction IN ('outbound','outgoing') AND sent_at<=?
    ORDER BY sent_at ASC
  `).all(String(accountId || ''), cutoff).filter(row => {
    const payload = parseJson(row.payload_json, {}) || {};
    return !chatJid || String(payload.chatJid || '') === String(chatJid);
  });
  if (!rows.length) return { count: 0, cutoff, status };
  const messageIds = rows.map(row => row.id);
  const firstPayload = parseJson(rows[0].payload_json, {}) || {};
  const platform = String(firstPayload.platform || store.db.prepare('SELECT platform FROM r32_conversations WHERE session_key=?').get(rows[0].session_key)?.platform || 'unknown').toLowerCase();
  const projection = { messageIds, status: String(status) };
  const event = appendOperationalEvent({
    platform, sourceAccountId: accountId, eventType: 'message.receipt.range.updated',
    externalEventId: `${cutoff}:${status}`,
    idempotencyKey: ['receipt-range', platform, accountId, chatJid || '', cutoff, status, messageIds.join(',')].join(':'), projection
  });
  try {
    store.transaction(() => {
      for (const row of rows) {
        const payload = parseJson(row.payload_json, {}) || {};
        store.upsertMessage({ ...payload, id: row.id, sessionKey: row.session_key, sentAt: row.sent_at, deliveryStatus: String(status), status: String(status), receiptUpdatedAt: now() });
      }
    });
    recordOperationalApplied(event, projection, messageIds.map(id => ({ table: 'r32_messages', id })));
  } catch (cause) {
    recordOperationalFailure(event, cause, messageIds.map(id => ({ table: 'r32_messages', id })));
    throw cause;
  }
  eventBus.publish('message:receipt-range-persisted', { accountId, chatJid, watermark: cutoff, status, count: rows.length });
  return { count: rows.length, cutoff, status };
}


async function updateConversationMetadata(conversationId, patch = {}) {
  const store = getStore();
  const current = getConversation(store, conversationId);
  if (!current) return null;
  const effectivePatch = { ...patch };
  const nextPresenceUpdatedAt = String(patch.presenceUpdatedAt || patch.presence_updated_at || '').trim();
  const currentPresenceUpdatedAt = String(current.presenceUpdatedAt || current.presence_updated_at || '').trim();
  const nextPresenceTime = Date.parse(nextPresenceUpdatedAt);
  const currentPresenceTime = Date.parse(currentPresenceUpdatedAt);
  if (Number.isFinite(nextPresenceTime) && Number.isFinite(currentPresenceTime) && nextPresenceTime < currentPresenceTime) {
    for (const field of [
      'online', 'presence', 'presenceState', 'presence_state', 'presenceUpdatedAt', 'presence_updated_at',
      'lastSeenAt', 'last_seen_at', 'lastSeenPrecision', 'last_seen_precision', 'presenceSupport'
    ]) delete effectivePatch[field];
  }
  const clearAvatar = effectivePatch.clearAvatar === true;
  const avatarUrl = clearAvatar ? '' : firstAvatar(effectivePatch, current);
  const avatarUpdatedAt = String(effectivePatch.avatarUpdatedAt || effectivePatch.avatar_updated_at || current.avatarUpdatedAt || current.avatar_updated_at || '').trim();
  const avatarStatus = String(effectivePatch.avatarStatus || effectivePatch.avatar_status || current.avatarStatus || current.avatar_status || '').trim();
  const next = {
    ...current,
    ...effectivePatch,
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    avatarUpdatedAt,
    avatar_updated_at: avatarUpdatedAt,
    avatarStatus,
    avatar_status: avatarStatus,
    sessionKey: current.sessionKey,
    updatedAt: now()
  };
  store.upsertConversation(next);
  store.db.prepare(`
    UPDATE r32_conversations
    SET avatar_url=?, avatar_updated_at=?, avatar_status=?, payload_json=?, updated_at=?
    WHERE session_key=?
  `).run(avatarUrl, avatarUpdatedAt, avatarStatus, JSON.stringify(next), next.updatedAt, current.sessionKey);
  if (next.contactId) {
    store.db.prepare(`
      UPDATE contacts
      SET avatar_url=?,
          avatar_updated_at=?,
          avatar_status=?,
          display_name=CASE WHEN ? <> '' THEN ? ELSE display_name END,
          payload_json=json_set(payload_json, '$.avatarUrl', ?, '$.avatar_url', ?, '$.avatarUpdatedAt', ?, '$.avatar_updated_at', ?, '$.avatarStatus', ?, '$.avatar_status', ?),
          updated_at=?
      WHERE id=?
    `).run(avatarUrl, avatarUpdatedAt, avatarStatus, next.title || next.contactName || '', next.title || next.contactName || '', avatarUrl, avatarUrl, avatarUpdatedAt, avatarUpdatedAt, avatarStatus, avatarStatus, next.updatedAt, next.contactId);
  }
  const saved = getConversation(store, conversationId);
  eventBus.publish('conversation:updated', { conversationId, conversation: saved, patch: { ...effectivePatch, avatarUrl } });
  return saved;
}

async function bindConversationAccount(conversationId, account = {}, externalConversationId = '') {
  const current = getConversation(getStore(), conversationId);
  if (!current) throw Object.assign(new Error('CONVERSATION_NOT_FOUND'), { code: 'CONVERSATION_NOT_FOUND', status: 404 });
  const platform = String(account.platform || '').toLowerCase();
  if (current.platform && platform && current.platform !== platform) throw Object.assign(new Error('跨平台账号不能绑定到当前会话'), { code: 'ACCOUNT_PLATFORM_MISMATCH', status: 409 });
  return updateConversationMetadata(conversationId, {
    accountId: account.id,
    adapterAccountId: account.adapterAccountId || '',
    platform: platform || current.platform,
    chatJid: externalConversationId || current.chatJid || current.externalId || '',
    accountName: account.displayName || account.name || '',
    accountBoundAt: now()
  });
}

function search(query, options = {}) {
  const store = getStore();
  return store.searchMessages(String(query || ''), options).map(row => {
    const full = store.getMessage(row.id) || row;
    const conversation = getConversation(store, row.sessionKey) || {};
    const translatedZh = String(
      full.translatedZh || full.translationZh || full.translationZH ||
      full.chineseTranslation || full.payload?.translatedZh || ''
    ).trim();
    return {
      ...row,
      text: String(full.text || row.text || '').trim(),
      translatedZh,
      sourceLanguage: String(full.sourceLanguage || full.language || '').trim(),
      translationStatus: String(full.translationStatus || '').trim(),
      contactId: String(conversation.contactId || '').trim(),
      contactName: String(conversation.title || conversation.contactName || conversation.phone || conversation.externalId || '').trim(),
      platform: String(conversation.platform || full.platform || '').trim().toLowerCase(),
      accountId: String(conversation.accountId || full.accountId || '').trim(),
      accountName: String(conversation.accountName || '').trim(),
      externalMessageId: String(full.externalMessageId || '').trim()
    };
  });
}

function read() {
  const conversations = listConversations({ limit: 5000 });
  const conversationMap = Object.fromEntries(conversations.map(row => [row.id, { ...row, messageKeys: [] }]));
  const messageMap = {};
  for (const conversation of conversations) {
    const rows = listMessages(conversation.id, { limit: 5000 });
    conversationMap[conversation.id].messageKeys = rows.map(row => row.dedupeKey || row.id);
    for (const row of rows) messageMap[row.dedupeKey || row.id] = clone(row);
  }
  return { schemaVersion: 3, messages: messageMap, conversations: conversationMap, contacts: {}, updatedAt: now() };
}

module.exports = { read, upsert, getMessageByDedupeKey, listPendingTelegramEnrichment, getExternalMessage, hasExternalMessage, collapseDuplicateUnsupportedMobileEchoes, applyReaction, revoke, markRead, updateReceipt, updateReceiptsThrough, updateConversationMetadata, bindConversationAccount, search, listConversations, listMessages, listMessagePage, listMessagesForExport, encodeCursor, decodeCursor, resolveMergedConversationKey: id => resolveMergedConversationKey(getStore(), id), getConversation: id => getConversation(getStore(), id), _identityLinkAuthority: identityLinkAuthority };
