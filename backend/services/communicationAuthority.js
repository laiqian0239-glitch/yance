'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const channelAdapterContract = require('./channelAdapterContract');
const defaultDurableExecutionAuthority = require('./durableExecutionAuthority');
const defaultOutboxAuthority = require('./externalActionOutboxAuthority');
const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('./durableOperationRegistry');

const AUTHORITY = 'CommunicationAuthority';
const SCHEMA_VERSION = 1;
const CONTENT_KINDS = new Set(['text', 'image', 'video', 'audio', 'file', 'sticker', 'gif', 'unsupported']);
const MEDIA_STATES = new Set(['REMOTE_DISCOVERED', 'FETCH_SCHEDULED', 'FETCHING', 'AVAILABLE', 'EXPIRED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT']);
const MEDIA_TRANSITIONS = Object.freeze({
  REMOTE_DISCOVERED: new Set(['FETCH_SCHEDULED', 'FETCHING', 'FAILED_RETRYABLE', 'FAILED_PERMANENT']),
  FETCH_SCHEDULED: new Set(['FETCHING', 'FAILED_RETRYABLE', 'FAILED_PERMANENT']),
  FETCHING: new Set(['AVAILABLE', 'FAILED_RETRYABLE', 'FAILED_PERMANENT']),
  AVAILABLE: new Set(['EXPIRED']),
  EXPIRED: new Set(['FETCH_SCHEDULED', 'FETCHING', 'FAILED_PERMANENT']),
  FAILED_RETRYABLE: new Set(['FETCH_SCHEDULED', 'FETCHING', 'FAILED_PERMANENT']),
  FAILED_PERMANENT: new Set([])
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultClock() { return new Date().toISOString(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function parse(value, fallback = {}) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function stableId(prefix, parts) {
  return `${prefix}-${crypto.createHash('sha256').update(parts.map(clean).join('\u001f')).digest('hex').slice(0, 32)}`;
}
function communicationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function requiredString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result) throw communicationError('WP_B_COMMUNICATION_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw communicationError('WP_B_COMMUNICATION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}
function normalizedTimestamp(value, field) {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw communicationError('WP_B_COMMUNICATION_AUTHORITY_TIMESTAMP_INVALID', `${field} must be normalized UTC ISO-8601`, { field });
  }
  return source;
}
function issueAuthorityTimestamp(issuer, purpose) {
  if (typeof issuer !== 'function') {
    throw new TypeError('CommunicationAuthority requires an authority timestamp issuer');
  }
  return normalizedTimestamp(issuer(purpose), purpose);
}
function assertDirection(value) {
  const direction = clean(value).toLowerCase();
  if (!['inbound', 'outbound', 'system'].includes(direction)) {
    throw Object.assign(new Error(`Unsupported message direction: ${direction}`), { code: 'CANONICAL_MESSAGE_DIRECTION_INVALID', status: 400, direction });
  }
  return direction;
}
function normalizeRawEventRef(value = {}) {
  channelAdapterContract.assertPlainData(value);
  return {
    eventId: clean(value.eventId),
    payloadSha256: clean(value.payloadSha256),
    redactionVersion: clean(value.redactionVersion || 'v1')
  };
}
function normalizeContent(value = {}) {
  channelAdapterContract.assertPlainData(value);
  const kind = clean(value.kind).toLowerCase();
  if (!CONTENT_KINDS.has(kind)) return { kind: 'unsupported', platformType: kind || 'unknown', rawSummary: clean(value.rawSummary) };
  if (kind === 'text') {
    const text = String(value.text == null ? '' : value.text);
    if (!text.trim()) return { kind: 'unsupported', platformType: 'empty-text', rawSummary: '' };
    return { kind, text };
  }
  if (['image', 'video'].includes(kind)) return { kind, mediaId: clean(value.mediaId), caption: String(value.caption == null ? '' : value.caption) };
  if (kind === 'audio') return { kind, mediaId: clean(value.mediaId), durationMs: Number(value.durationMs || 0) };
  if (kind === 'file') return { kind, mediaId: clean(value.mediaId), filename: clean(value.filename) };
  if (kind === 'sticker') return { kind, mediaId: clean(value.mediaId), nativeReference: clean(value.nativeReference), animated: value.animated === true };
  if (kind === 'gif') return { kind, mediaId: clean(value.mediaId), nativeReference: clean(value.nativeReference) };
  return { kind: 'unsupported', platformType: clean(value.platformType || 'unknown'), rawSummary: clean(value.rawSummary) };
}
function renderProjection(content = {}) {
  if (content.kind === 'text') return { kind: 'text', text: content.text };
  if (content.kind === 'image') return { kind: 'image', mediaId: content.mediaId, caption: content.caption || '', fallbackText: content.caption || '[图片]' };
  if (content.kind === 'video') return { kind: 'video', mediaId: content.mediaId, caption: content.caption || '', fallbackText: content.caption || '[视频]' };
  if (content.kind === 'audio') return { kind: 'audio', mediaId: content.mediaId, durationMs: content.durationMs || 0, fallbackText: '[语音]' };
  if (content.kind === 'file') return { kind: 'file', mediaId: content.mediaId, filename: content.filename || '', fallbackText: content.filename || '[文件]' };
  if (content.kind === 'sticker') return { kind: 'sticker', mediaId: content.mediaId || '', nativeReference: content.nativeReference || '', animated: content.animated === true, fallbackText: content.animated ? '[动态贴纸]' : '[贴纸]' };
  if (content.kind === 'gif') return { kind: 'gif', mediaId: content.mediaId || '', nativeReference: content.nativeReference || '', fallbackText: '[GIF 动图]' };
  return { kind: 'unsupported', platformType: content.platformType || 'unknown', fallbackText: `暂不支持的消息类型：${content.platformType || 'unknown'}` };
}
function messageRow(row = {}) {
  if (!row) return null;
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    messageId: clean(row.message_id), traceId: clean(row.trace_id), platform: clean(row.platform), sourceAccountId: clean(row.source_account_id),
    externalConversationId: clean(row.external_conversation_id), externalMessageId: clean(row.external_message_id), direction: clean(row.direction),
    senderExternalId: clean(row.sender_external_id), occurredAt: clean(row.occurred_at), contentKind: clean(row.content_kind),
    rawEventRef: parse(row.raw_event_ref_json, {}), normalizedContent: parse(row.normalized_content_json, {}), renderProjection: parse(row.render_projection_json, {}),
    idempotencyKey: clean(row.idempotency_key), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at)
  };
}
function mediaRow(row = {}) {
  if (!row) return null;
  return {
    authority: AUTHORITY, schemaVersion: SCHEMA_VERSION,
    mediaId: clean(row.media_id), traceId: clean(row.trace_id), platform: clean(row.platform), sourceAccountId: clean(row.source_account_id),
    externalReference: clean(row.external_reference), mediaKind: clean(row.media_kind), mimeType: clean(row.mime_type), animated: Number(row.animated || 0) === 1,
    state: clean(row.state), version: Number(row.version || 0), localPath: clean(row.local_path), thumbnailPath: clean(row.thumbnail_path), sha256: clean(row.sha256),
    failureCode: clean(row.failure_code), nextRetryAt: clean(row.next_retry_at), metadata: parse(row.metadata_json, {}), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at)
  };
}
function checkpointRow(row = {}, scope = {}) {
  if (!row) return {
    authority: AUTHORITY, schemaVersion: SCHEMA_VERSION,
    checkpointId: stableId('checkpoint', [scope.platform, scope.sourceAccountId, scope.streamKind, scope.externalConversationId]),
    platform: clean(scope.platform), sourceAccountId: clean(scope.sourceAccountId), streamKind: clean(scope.streamKind), externalConversationId: clean(scope.externalConversationId),
    version: 0, cursor: '', highWatermark: '', gapClosed: true, updatedAt: ''
  };
  return {
    authority: AUTHORITY, schemaVersion: SCHEMA_VERSION,
    checkpointId: clean(row.checkpoint_id), platform: clean(row.platform), sourceAccountId: clean(row.source_account_id), streamKind: clean(row.stream_kind),
    externalConversationId: clean(row.external_conversation_id), version: Number(row.version || 0), cursor: clean(row.cursor), highWatermark: clean(row.high_watermark),
    gapClosed: Number(row.gap_closed || 0) === 1, updatedAt: clean(row.updated_at)
  };
}

class CommunicationAuthority {
  constructor({
    storeProvider = getStore,
    idFactory = defaultIdFactory,
    clock = defaultClock,
    durableExecutionAuthority = defaultDurableExecutionAuthority,
    outboxAuthority = defaultOutboxAuthority,
    issueTimestamp = clock
  } = {}) {
    this.storeProvider = storeProvider;
    this.idFactory = idFactory;
    this.clock = clock;
    this.durableExecutionAuthority = durableExecutionAuthority;
    this.outboxAuthority = outboxAuthority;
    this.issueTimestamp = issueTimestamp;
  }

  store() { return this.storeProvider(); }

  prepareOutboundMessageSend(input = {}) {
    const idempotencyKey = requiredString(input.idempotencyKey, 'idempotencyKey');
    const command = assertReferenceOnlyEnvelope(input.command);
    if (!this.durableExecutionAuthority || typeof this.durableExecutionAuthority.createExecution !== 'function') {
      throw new TypeError('CommunicationAuthority requires DurableExecutionAuthority.createExecution');
    }
    if (!this.outboxAuthority || typeof this.outboxAuthority.createIntent !== 'function') {
      throw new TypeError('CommunicationAuthority requires ExternalActionOutboxAuthority.createIntent');
    }
    const execution = this.durableExecutionAuthority.createExecution({
      operationKind: OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
      idempotencyKey,
      traceId: clean(input.traceId),
      command,
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
      authorityTimestamp: issueAuthorityTimestamp(this.issueTimestamp, 'outbound-message-execution')
    });
    const executionId = requiredString(execution?.executionId, 'execution.executionId');
    const intent = this.outboxAuthority.createIntent({
      executionId,
      actionKind: OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
      idempotencyKey,
      payload: command,
      authorityTimestamp: issueAuthorityTimestamp(this.issueTimestamp, 'outbound-message-intent')
    });
    return Object.freeze({
      executionId,
      intentId: requiredString(intent?.intentId, 'intent.intentId'),
      operationKind: OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
      idempotencyKey
    });
  }

  readOutboundMessageState(input = {}) {
    const intentId = requiredString(input.intentId || input.attemptId, 'intentId');
    if (!this.outboxAuthority || typeof this.outboxAuthority.intent !== 'function') {
      throw new TypeError('CommunicationAuthority requires ExternalActionOutboxAuthority.intent');
    }
    return this.outboxAuthority.intent(intentId);
  }

  assertAccount(platform, sourceAccountId, store = this.store()) {
    const row = store.db.prepare('SELECT id,platform,state FROM r32_accounts WHERE id=?').get(clean(sourceAccountId));
    if (!row) throw Object.assign(new Error('Channel account is not persisted'), { code: 'COMMUNICATION_ACCOUNT_NOT_FOUND', status: 409, platform: clean(platform), sourceAccountId: clean(sourceAccountId) });
    if (clean(row.platform) !== clean(platform)) throw Object.assign(new Error('Channel account platform scope mismatch'), { code: 'COMMUNICATION_ACCOUNT_SCOPE_MISMATCH', status: 409, platform: clean(platform), sourceAccountId: clean(sourceAccountId) });
    return row;
  }

  ingestMessage(input = {}) {
    const platform = clean(input.platform).toLowerCase();
    const sourceAccountId = clean(input.sourceAccountId);
    const externalConversationId = clean(input.externalConversationId);
    const externalMessageId = clean(input.externalMessageId);
    if (!platform || !sourceAccountId || !externalConversationId || !externalMessageId) {
      throw Object.assign(new Error('Canonical message scope is incomplete'), { code: 'CANONICAL_MESSAGE_SCOPE_INCOMPLETE', status: 400 });
    }
    const store = this.store();
    this.assertAccount(platform, sourceAccountId, store);
    const idempotencyKey = `${platform}:${sourceAccountId}:${externalConversationId}:${externalMessageId}`;
    const existing = store.db.prepare('SELECT * FROM communication_canonical_messages WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) return messageRow(existing);
    const content = normalizeContent(input.content || {});
    const render = renderProjection(content);
    const rawRef = normalizeRawEventRef(input.rawEventRef || {});
    const messageId = clean(input.messageId) || stableId('message', [platform, sourceAccountId, externalConversationId, externalMessageId]);
    const at = this.clock();
    store.db.prepare(`
      INSERT INTO communication_canonical_messages(
        message_id,trace_id,platform,source_account_id,external_conversation_id,external_message_id,direction,sender_external_id,
        occurred_at,content_kind,raw_event_ref_json,normalized_content_json,render_projection_json,idempotency_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      messageId, clean(input.traceId), platform, sourceAccountId, externalConversationId, externalMessageId, assertDirection(input.direction), clean(input.senderExternalId),
      clean(input.occurredAt), content.kind, JSON.stringify(rawRef), JSON.stringify(content), JSON.stringify(render), idempotencyKey, at, at
    );
    return messageRow(store.db.prepare('SELECT * FROM communication_canonical_messages WHERE message_id=?').get(messageId));
  }

  getMessage(messageId) {
    return messageRow(this.store().db.prepare('SELECT * FROM communication_canonical_messages WHERE message_id=?').get(clean(messageId)));
  }

  registerMedia(input = {}) {
    const platform = clean(input.platform).toLowerCase();
    const sourceAccountId = clean(input.sourceAccountId);
    const externalReference = clean(input.externalReference);
    const mediaKind = clean(input.mediaKind).toLowerCase();
    if (!platform || !sourceAccountId || !externalReference || !mediaKind) throw Object.assign(new Error('Media asset scope is incomplete'), { code: 'MEDIA_ASSET_SCOPE_INCOMPLETE', status: 400 });
    const store = this.store();
    this.assertAccount(platform, sourceAccountId, store);
    const existing = store.db.prepare('SELECT * FROM communication_media_assets WHERE platform=? AND source_account_id=? AND external_reference=? AND media_kind=?').get(platform, sourceAccountId, externalReference, mediaKind);
    if (existing) return mediaRow(existing);
    const mediaId = clean(input.mediaId) || stableId('media', [platform, sourceAccountId, externalReference, mediaKind]);
    const at = this.clock();
    channelAdapterContract.assertPlainData(input.metadata || {});
    store.db.prepare(`
      INSERT INTO communication_media_assets(
        media_id,trace_id,platform,source_account_id,external_reference,media_kind,mime_type,animated,state,version,
        local_path,thumbnail_path,sha256,failure_code,next_retry_at,metadata_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?, 'REMOTE_DISCOVERED',1,'','','','','',?,?,?)
    `).run(mediaId, clean(input.traceId), platform, sourceAccountId, externalReference, mediaKind, clean(input.mimeType), input.animated === true ? 1 : 0, JSON.stringify(input.metadata || {}), at, at);
    return mediaRow(store.db.prepare('SELECT * FROM communication_media_assets WHERE media_id=?').get(mediaId));
  }

  transitionMedia(input = {}) {
    const store = this.store();
    return store.transaction(() => {
      const row = store.db.prepare('SELECT * FROM communication_media_assets WHERE media_id=?').get(clean(input.mediaId));
      if (!row) throw Object.assign(new Error('Media asset not found'), { code: 'MEDIA_ASSET_NOT_FOUND', status: 404, mediaId: clean(input.mediaId) });
      const expectedVersion = Number(input.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(row.version || 0)) {
        throw Object.assign(new Error('Media asset stale version rejected'), { code: 'MEDIA_ASSET_STALE_VERSION', status: 409, expectedVersion: Number(row.version || 0), receivedVersion: Number.isFinite(expectedVersion) ? expectedVersion : null });
      }
      const state = clean(input.state).toUpperCase();
      if (!MEDIA_STATES.has(state) || !MEDIA_TRANSITIONS[clean(row.state)]?.has(state)) {
        throw Object.assign(new Error(`Invalid media transition ${clean(row.state)} -> ${state}`), { code: 'MEDIA_ASSET_TRANSITION_INVALID', status: 409, fromState: clean(row.state), toState: state });
      }
      if (state === 'AVAILABLE' && !clean(input.localPath)) throw Object.assign(new Error('Available media requires local path'), { code: 'MEDIA_ASSET_LOCAL_PATH_REQUIRED', status: 409 });
      const at = this.clock();
      store.db.prepare(`UPDATE communication_media_assets SET state=?,version=version+1,local_path=?,thumbnail_path=?,sha256=?,failure_code=?,next_retry_at=?,updated_at=? WHERE media_id=?`)
        .run(state, clean(input.localPath || row.local_path), clean(input.thumbnailPath || row.thumbnail_path), clean(input.sha256 || row.sha256), clean(input.failureCode), clean(input.nextRetryAt), at, clean(input.mediaId));
      return mediaRow(store.db.prepare('SELECT * FROM communication_media_assets WHERE media_id=?').get(clean(input.mediaId)));
    });
  }

  getSyncCheckpoint(input = {}) {
    const scope = { platform: clean(input.platform).toLowerCase(), sourceAccountId: clean(input.sourceAccountId), streamKind: clean(input.streamKind), externalConversationId: clean(input.externalConversationId) };
    const row = this.store().db.prepare(`SELECT * FROM communication_sync_checkpoints WHERE platform=? AND source_account_id=? AND stream_kind=? AND external_conversation_id=?`)
      .get(scope.platform, scope.sourceAccountId, scope.streamKind, scope.externalConversationId);
    return checkpointRow(row, scope);
  }

  commitSyncCheckpoint(input = {}) {
    if (input.gapClosed !== true) throw Object.assign(new Error('Sync checkpoint cannot advance before gap closure'), { code: 'SYNC_GAP_NOT_CLOSED', status: 409 });
    const platform = clean(input.platform).toLowerCase();
    const sourceAccountId = clean(input.sourceAccountId);
    const streamKind = clean(input.streamKind);
    const externalConversationId = clean(input.externalConversationId);
    const store = this.store();
    this.assertAccount(platform, sourceAccountId, store);
    return store.transaction(() => {
      const current = store.db.prepare(`SELECT * FROM communication_sync_checkpoints WHERE platform=? AND source_account_id=? AND stream_kind=? AND external_conversation_id=?`)
        .get(platform, sourceAccountId, streamKind, externalConversationId);
      const version = Number(current?.version || 0);
      const expectedVersion = Number(input.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== version) throw Object.assign(new Error('Sync checkpoint stale version rejected'), { code: 'SYNC_CHECKPOINT_STALE_VERSION', status: 409, expectedVersion: version, receivedVersion: Number.isFinite(expectedVersion) ? expectedVersion : null });
      const checkpointId = clean(current?.checkpoint_id) || stableId('checkpoint', [platform, sourceAccountId, streamKind, externalConversationId]);
      const at = this.clock();
      store.db.prepare(`INSERT INTO communication_sync_checkpoints(checkpoint_id,platform,source_account_id,stream_kind,external_conversation_id,version,cursor,high_watermark,gap_closed,updated_at)
        VALUES(?,?,?,?,?,?,?,?,1,?)
        ON CONFLICT(platform,source_account_id,stream_kind,external_conversation_id) DO UPDATE SET
          version=excluded.version,cursor=excluded.cursor,high_watermark=excluded.high_watermark,gap_closed=1,updated_at=excluded.updated_at`)
        .run(checkpointId, platform, sourceAccountId, streamKind, externalConversationId, version + 1, clean(input.cursor), clean(input.highWatermark), at);
      return this.getSyncCheckpoint({ platform, sourceAccountId, streamKind, externalConversationId });
    });
  }
}

const communicationAuthority = new CommunicationAuthority();
module.exports = communicationAuthority;
module.exports.CommunicationAuthority = CommunicationAuthority;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.normalizeContent = normalizeContent;
module.exports.renderProjection = renderProjection;
