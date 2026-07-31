'use strict';

const eventBus = require('./eventBus');

const crypto = require('crypto');
const { stableId } = require('../lib/r32SqliteStore');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'DomainEventLogAuthority';
const SCHEMA_VERSION = 1;
const REDACTION_VERSION = 'round12-v2';
const SECRET_KEY = /(token|secret|password|passwd|cookie|authorization|credential|qr(?:code)?|sessionkey|privatekey|clientsecret|accesstoken|refreshtoken)/i;
const LARGE_BINARY_KEY = /(buffer|binary|blob|filebytes|media(?:data|bytes)|base64)/i;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_REDACTION_DEPTH = 32;
const MAX_REDACTION_NODES = 10000;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SECRET_VALUE_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|session(?:id|key)?|cookie|authorization)=([^&\s]+)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function boundedIdentifier(value, field, maximum, pattern = null) {
  const result = clean(value);
  if (result.length > maximum) throw error('DOMAIN_EVENT_IDENTIFIER_TOO_LONG', `领域事件字段 ${field} 超过最大长度。`, 413, { field, length: result.length, maximum });
  if (/[\u0000-\u001f\u007f]/u.test(result) || (pattern && result && !pattern.test(result))) {
    throw error('DOMAIN_EVENT_IDENTIFIER_INVALID', `领域事件字段 ${field} 格式无效。`, 400, { field });
  }
  return result;
}
function now() { return new Date().toISOString(); }
function normalizedTimestamp(value, fallback, field) {
  const candidate = clean(value) || clean(fallback);
  const milliseconds = Date.parse(candidate);
  if (!candidate || !Number.isFinite(milliseconds)) throw error('DOMAIN_EVENT_TIMESTAMP_INVALID', `领域事件时间字段 ${field} 无效。`, 400, { field });
  return new Date(milliseconds).toISOString();
}
function canonical(value, state = null, depth = 0) {
  const context = state || { seen: new WeakSet() };
  if (depth > MAX_REDACTION_DEPTH) return JSON.stringify('[MAX_DEPTH]');
  if (value == null) return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : '[NON_FINITE_NUMBER]');
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return JSON.stringify('[NON_JSON_VALUE]');
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return canonical({ redacted: true, reason: 'binary-not-canonicalized', bytes: Number(value.byteLength || value.length || 0) }, context, depth + 1);
  if (Array.isArray(value)) {
    if (context.seen.has(value)) return JSON.stringify('[CIRCULAR]');
    context.seen.add(value);
    const output = `[${value.map(item => canonical(item, context, depth + 1)).join(',')}]`;
    context.seen.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    if (context.seen.has(value)) return JSON.stringify('[CIRCULAR]');
    context.seen.add(value);
    const entries = [];
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const item = descriptor?.get || descriptor?.set ? '[ACCESSOR_FORBIDDEN]' : descriptor?.value;
      entries.push(`${JSON.stringify(key)}:${canonical(item, context, depth + 1)}`);
    }
    const output = `{${entries.join(',')}}`;
    context.seen.delete(value);
    return output;
  }
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
function error(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function redactSecretValues(value, path, report) {
  let output = value;
  let changed = false;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, match => {
      changed = true;
      if (/^Bearer\s/i.test(match)) return 'Bearer [REDACTED]';
      const equals = match.indexOf('=');
      return equals >= 0 ? `${match.slice(0, equals + 1)}[REDACTED]` : '[REDACTED_JWT]';
    });
  }
  if (changed) report.push({ path: path || '$', reason: 'secret-value' });
  return output;
}
function sanitizeScalar(value, path = '', report = []) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { redacted: true, reason: 'binary-not-stored', bytes: Number(value.byteLength || value.length || 0) };
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_TEXT_BYTES) return { redacted: true, reason: 'oversized-text', bytes, sha256: sha256(value) };
    return redactSecretValues(value, path, report);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    report.push({ path: path || '$', reason: 'non-finite-number' });
    return '[REDACTED_NON_FINITE_NUMBER]';
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    report.push({ path: path || '$', reason: 'non-json-value' });
    return '[REDACTED_NON_JSON_VALUE]';
  }
  return value;
}
function redactPayload(value, keyPath = [], report = [], state = null, depth = 0) {
  const context = state || { seen: new WeakSet(), nodes: 0 };
  const path = keyPath.join('.') || '$';
  context.nodes += 1;
  if (context.nodes > MAX_REDACTION_NODES) {
    report.push({ path, reason: 'node-limit' });
    return '[REDACTED_NODE_LIMIT]';
  }
  if (depth > MAX_REDACTION_DEPTH) {
    report.push({ path, reason: 'depth-limit' });
    return '[REDACTED_DEPTH_LIMIT]';
  }
  if (value == null || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return sanitizeScalar(value, path, report);
  if (value instanceof Date) return value.toISOString();
  if (context.seen.has(value)) {
    report.push({ path, reason: 'circular-reference' });
    return '[REDACTED_CIRCULAR]';
  }
  context.seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map((item, index) => redactPayload(item, [...keyPath, String(index)], report, context, depth + 1));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      context.seen.delete(value);
      report.push({ path, reason: 'non-plain-object' });
      return '[REDACTED_NON_PLAIN_OBJECT]';
    }
    output = Object.create(null);
    for (const key of Object.getOwnPropertyNames(value)) {
      const itemPath = [...keyPath, key].join('.');
      if (FORBIDDEN_OBJECT_KEYS.has(key)) {
        report.push({ path: itemPath, reason: 'forbidden-object-key' });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get || descriptor?.set) {
        output[key] = '[REDACTED_ACCESSOR]';
        report.push({ path: itemPath, reason: 'accessor' });
        continue;
      }
      const item = descriptor?.value;
      if (SECRET_KEY.test(key)) {
        output[key] = '[REDACTED]';
        report.push({ path: itemPath, reason: 'secret-key' });
        continue;
      }
      if (LARGE_BINARY_KEY.test(key) && (Buffer.isBuffer(item) || item instanceof Uint8Array || typeof item === 'string')) {
        const bytes = Buffer.isBuffer(item) || item instanceof Uint8Array ? Number(item.byteLength || item.length || 0) : Buffer.byteLength(item, 'utf8');
        output[key] = { redacted: true, reason: 'binary-or-base64-not-stored', bytes, sha256: sha256(item) };
        report.push({ path: itemPath, reason: 'binary-or-base64' });
        continue;
      }
      output[key] = redactPayload(item, [...keyPath, key], report, context, depth + 1);
    }
  }
  context.seen.delete(value);
  return output;
}
function publicEvent(row) {
  if (!row) return null;
  return {
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
  };
}

class DomainEventLogService {
  constructor(options = {}) { this.repository = options.repository || defaultRepository; this.events = options.eventBus || eventBus; }

  append(input = {}) {
    const platform = boundedIdentifier(input.platform, 'platform', 32, /^[a-z0-9_-]+$/i).toLowerCase();
    const sourceAccountId = boundedIdentifier(input.sourceAccountId, 'sourceAccountId', 512);
    const eventType = boundedIdentifier(input.eventType, 'eventType', 128, /^[a-z0-9_.:-]+$/i);
    if (!platform || !sourceAccountId || !eventType) throw error('DOMAIN_EVENT_SCOPE_INCOMPLETE', '领域事件必须包含平台、来源账号和事件类型。');
    const externalEventId = boundedIdentifier(input.externalEventId, 'externalEventId', 1024);
    const explicitIdempotencyKey = boundedIdentifier(input.idempotencyKey, 'idempotencyKey', 2048);
    if (!explicitIdempotencyKey && !externalEventId) throw error('DOMAIN_EVENT_EXTERNAL_ID_OR_IDEMPOTENCY_REQUIRED', '领域事件缺少平台事件 ID；调用方必须提供显式幂等键。');
    const idempotencyKey = explicitIdempotencyKey || [platform, sourceAccountId, eventType, externalEventId].join(':');

    const schemaVersion = input.schemaVersion == null ? SCHEMA_VERSION : Number(input.schemaVersion);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw error('DOMAIN_EVENT_SCHEMA_VERSION_INVALID', '领域事件 schemaVersion 必须是正整数。', 400, { schemaVersion: input.schemaVersion });
    }
    if (schemaVersion !== SCHEMA_VERSION) {
      throw error('DOMAIN_EVENT_SCHEMA_VERSION_UNSUPPORTED', `当前仅支持领域事件 Schema ${SCHEMA_VERSION}。`, 409, { schemaVersion, supportedSchemaVersion: SCHEMA_VERSION });
    }

    const receivedAt = normalizedTimestamp(input.receivedAt, now(), 'receivedAt');
    const occurredAt = normalizedTimestamp(input.occurredAt, receivedAt, 'occurredAt');
    const report = [];
    const sanitized = redactPayload(input.payload ?? {}, [], report);
    const payload = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
      ? { ...sanitized, _eventSecurity: { redactionVersion: REDACTION_VERSION, redactedFields: report.length } }
      : { value: sanitized, _eventSecurity: { redactionVersion: REDACTION_VERSION, redactedFields: report.length } };
    const payloadCanonical = canonical(payload);
    const payloadBytes = Buffer.byteLength(payloadCanonical, 'utf8');
    if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
      throw error('DOMAIN_EVENT_PAYLOAD_TOO_LARGE', '脱敏后的领域事件仍超过最大持久化大小。', 413, { payloadBytes, maximum: MAX_EVENT_PAYLOAD_BYTES });
    }
    const payloadSha256 = sha256(payloadCanonical);

    const compareExisting = (existing, conflictCode, conflictMessage) => {
      if (!existing) return null;
      const same = clean(existing.platform) === platform
        && clean(existing.source_account_id) === sourceAccountId
        && clean(existing.external_event_id) === externalEventId
        && clean(existing.event_type) === eventType
        && clean(existing.payload_sha256) === payloadSha256
        && Number(existing.schema_version || 0) === schemaVersion;
      if (!same || clean(existing.idempotency_key) !== idempotencyKey) {
        throw error(conflictCode, conflictMessage, 409, {
          eventId: clean(existing.event_id),
          idempotencyKey,
          existingIdempotencyKey: clean(existing.idempotency_key),
          externalEventId,
          existingPayloadSha256: clean(existing.payload_sha256),
          incomingPayloadSha256: payloadSha256
        });
      }
      const result = { authority: AUTHORITY, created: false, event: publicEvent(existing), redactions: report };
      this.events.publish('domain-event:appended', { eventId: result.event.eventId, created: false, eventType: result.event.eventType });
      return result;
    };

    const existing = this.repository.getDomainEventByIdempotency(idempotencyKey);
    const replay = compareExisting(existing, 'DOMAIN_EVENT_IDEMPOTENCY_CONFLICT', '相同幂等键对应了不同的平台事件内容，已阻止静默覆盖。');
    if (replay) return replay;

    if (externalEventId) {
      const externalExisting = this.repository.getDomainEventByExternalIdentity(platform, sourceAccountId, eventType, externalEventId);
      const externalReplay = compareExisting(externalExisting, 'DOMAIN_EVENT_EXTERNAL_ID_CONFLICT', '相同平台外部事件 ID 已被另一领域事件占用，已阻止重复落库。');
      if (externalReplay) return externalReplay;
    }

    const eventId = boundedIdentifier(input.eventId, 'eventId', 1024) || stableId('domain-event', [idempotencyKey]);
    const existingEventId = this.repository.getDomainEvent(eventId);
    if (existingEventId && clean(existingEventId.idempotency_key) !== idempotencyKey) {
      throw error('DOMAIN_EVENT_ID_CONFLICT', '领域事件 ID 已被其他幂等事件占用。', 409, { eventId, idempotencyKey, existingIdempotencyKey: clean(existingEventId.idempotency_key) });
    }
    const retentionDaysNumber = input.retentionDays == null ? 30 : Number(input.retentionDays);
    if (!Number.isInteger(retentionDaysNumber) || retentionDaysNumber < 1 || retentionDaysNumber > 365) {
      throw error('DOMAIN_EVENT_RETENTION_INVALID', '领域事件保留天数必须是 1–365 的整数。', 400, { retentionDays: input.retentionDays });
    }
    const receivedMs = Date.parse(receivedAt);
    const maxRetentionMs = receivedMs + 365 * 86400000;
    const retentionUntil = input.retentionUntil
      ? normalizedTimestamp(input.retentionUntil, '', 'retentionUntil')
      : new Date(receivedMs + retentionDaysNumber * 86400000).toISOString();
    const retentionMs = Date.parse(retentionUntil);
    if (!(retentionMs > receivedMs) || retentionMs > maxRetentionMs) {
      throw error('DOMAIN_EVENT_RETENTION_WINDOW_INVALID', '领域事件 retentionUntil 必须晚于 receivedAt 且不得超过 365 天。', 400, { receivedAt, retentionUntil });
    }

    let row;
    try {
      row = this.repository.insertDomainEvent({
        eventId, schemaVersion, platform, sourceAccountId, externalEventId, eventType,
        idempotencyKey, correlationId: boundedIdentifier(input.correlationId, 'correlationId', 1024), causationId: boundedIdentifier(input.causationId, 'causationId', 1024), occurredAt, receivedAt,
        redactionVersion: REDACTION_VERSION, payload, payloadSha256, retentionUntil, replayState: 'available'
      });
    } catch (cause) {
      // A concurrent writer can win after the pre-check. Re-read both unique
      // authorities so the caller receives a deterministic conflict instead of
      // a raw SQLite constraint error.
      const byIdempotency = this.repository.getDomainEventByIdempotency(idempotencyKey);
      const idempotentReplay = compareExisting(byIdempotency, 'DOMAIN_EVENT_IDEMPOTENCY_CONFLICT', '相同幂等键对应了不同的平台事件内容，已阻止静默覆盖。');
      if (idempotentReplay) return idempotentReplay;
      const byExternal = externalEventId
        ? this.repository.getDomainEventByExternalIdentity(platform, sourceAccountId, eventType, externalEventId)
        : null;
      const externalReplay = compareExisting(byExternal, 'DOMAIN_EVENT_EXTERNAL_ID_CONFLICT', '相同平台外部事件 ID 已被另一领域事件占用，已阻止重复落库。');
      if (externalReplay) return externalReplay;
      throw cause;
    }
    const result = { authority: AUTHORITY, created: row?.event_id === eventId, event: publicEvent(row), redactions: report };
    this.events.publish('domain-event:appended', { eventId: result.event.eventId, created: result.created, eventType: result.event.eventType });
    return result;
  }

  recordShadowProjection(input = {}) {
    const eventId = clean(input.eventId);
    const event = this.repository.getDomainEvent(eventId);
    if (!event) throw error('DOMAIN_EVENT_NOT_FOUND', '无法为不存在的领域事件记录投影。', 404);
    const expectedHash = sha256(input.expectedProjection ?? null);
    const actualHash = sha256(input.actualProjection ?? null);
    const matches = expectedHash === actualHash;
    const receipt = this.repository.upsertProjectionReceipt({
      projectorName: clean(input.projectorName) || 'unknown-projector',
      projectorVersion: clean(input.projectorVersion) || 'v1', eventId,
      projectionStatus: matches ? 'shadow-match' : 'shadow-mismatch',
      projectionHash: actualHash, targetRefs: input.targetRefs || [],
      failureCode: matches ? '' : 'SHADOW_PROJECTION_MISMATCH',
      failureReason: matches ? '' : `expected=${expectedHash};actual=${actualHash}`,
      attempt: Number(input.attempt || 1), projectedAt: clean(input.projectedAt) || now()
    });
    return { authority: AUTHORITY, matches, expectedHash, actualHash, receipt };
  }


  recordAppliedProjection(input = {}) {
    const eventId = clean(input.eventId);
    const event = this.repository.getDomainEvent(eventId);
    if (!event) throw error('DOMAIN_EVENT_NOT_FOUND', '无法为不存在的领域事件记录权威投影。', 404);
    const projectionHash = sha256(input.projection ?? null);
    const receipt = this.repository.upsertProjectionReceipt({
      projectorName: clean(input.projectorName) || 'production-message-projector',
      projectorVersion: clean(input.projectorVersion) || 'v1',
      eventId,
      projectionStatus: 'applied',
      projectionHash,
      targetRefs: input.targetRefs || [],
      failureCode: '',
      failureReason: '',
      attempt: Number(input.attempt || 1),
      projectedAt: clean(input.projectedAt) || now()
    });
    this.repository.updateDomainReplayState(eventId, 'replayed');
    return { authority: AUTHORITY, applied: true, projectionHash, receipt };
  }

  convergence(input = {}) {
    const projectorName = clean(input.projectorName) || 'message-projection';
    const projectorVersion = clean(input.projectorVersion) || 'round12-v2';
    return { authority: AUTHORITY, ...this.repository.projectionConvergence({ projectorName, projectorVersion }) };
  }

  assertConverged(input = {}) {
    const status = this.convergence(input);
    if (!status.converged) {
      throw error('DOMAIN_EVENT_PROJECTION_NOT_CONVERGED', '领域事件投影仍存在差异或失败，禁止声明切换完成。', 409, status);
    }
    return status;
  }


  recordProjectionFailure(input = {}) {
    const eventId = clean(input.eventId);
    if (!this.repository.getDomainEvent(eventId)) throw error('DOMAIN_EVENT_NOT_FOUND', '无法为不存在的领域事件记录投影失败。', 404);
    const receipt = this.repository.upsertProjectionReceipt({
      projectorName: clean(input.projectorName) || 'production-message-projector',
      projectorVersion: clean(input.projectorVersion) || 'v1',
      eventId,
      projectionStatus: 'failed',
      projectionHash: '',
      targetRefs: input.targetRefs || [],
      failureCode: clean(input.failureCode || input.error?.code) || 'DOMAIN_EVENT_PROJECTION_FAILED',
      failureReason: clean(input.failureReason || input.error?.message),
      attempt: Number(input.attempt || 1),
      projectedAt: clean(input.projectedAt) || now()
    });
    return { authority: AUTHORITY, failed: true, receipt };
  }

  async replay(input = {}) {
    const eventId = clean(input.eventId);
    const projectorName = clean(input.projectorName) || 'replay-projector';
    const projectorVersion = clean(input.projectorVersion) || 'v1';
    const eventRow = this.repository.getDomainEvent(eventId);
    if (!eventRow) throw error('DOMAIN_EVENT_NOT_FOUND', '待重放的领域事件不存在。', 404);
    if (typeof input.projector !== 'function') throw error('DOMAIN_EVENT_PROJECTOR_REQUIRED', '重放必须提供投影器。');
    const retentionMs = Date.parse(clean(eventRow.retention_until));
    if (Number.isFinite(retentionMs) && retentionMs <= Date.now()) {
      this.repository.updateDomainReplayState(eventId, 'expired');
      throw error('DOMAIN_EVENT_EXPIRED', '领域事件已超过保留期，不能继续重放。', 409, { eventId, retentionUntil: clean(eventRow.retention_until) });
    }
    const replayState = clean(eventRow.replay_state) || 'available';
    if (replayState === 'expired') throw error('DOMAIN_EVENT_EXPIRED', '领域事件已过期，不能重放。', 409, { eventId });
    const previous = this.repository.getProjectionReceipt?.(projectorName, projectorVersion, eventId) || null;
    if (previous?.projection_status === 'applied' && input.forceReapply !== true) {
      return { authority: AUTHORITY, applied: false, idempotentReplay: true, receipt: previous };
    }
    if ((replayState === 'quarantined' || previous?.projection_status === 'failed') && input.allowQuarantined !== true) {
      throw error('DOMAIN_EVENT_QUARANTINED', '领域事件上次投影失败，必须经过明确人工确认才能再次重放。', 409, {
        eventId, projectorName, projectorVersion, previousFailureCode: clean(previous?.failure_code)
      });
    }
    if ((input.forceReapply === true || input.allowQuarantined === true) && (!clean(input.actor) || !clean(input.reason))) {
      throw error('DOMAIN_EVENT_REPLAY_OVERRIDE_AUDIT_REQUIRED', '强制或隔离事件重放必须记录操作者和原因。', 409, { eventId });
    }
    const attempt = Math.max(Number(input.attempt || 0), Number(previous?.attempt || 0) + 1, 1);
    try {
      const result = await input.projector(publicEvent(eventRow));
      const projectionHash = sha256(result ?? null);
      const receipt = this.repository.upsertProjectionReceipt({
        projectorName, projectorVersion, eventId, projectionStatus: 'applied', projectionHash,
        targetRefs: result?.targetRefs || [], attempt, projectedAt: now()
      });
      this.repository.updateDomainReplayState(eventId, 'replayed');
      return { authority: AUTHORITY, applied: true, result, receipt, override: input.forceReapply === true || input.allowQuarantined === true, actor: clean(input.actor), reason: clean(input.reason) };
    } catch (cause) {
      const receipt = this.repository.upsertProjectionReceipt({
        projectorName, projectorVersion, eventId, projectionStatus: 'failed', projectionHash: '', targetRefs: [],
        failureCode: clean(cause.code) || 'DOMAIN_EVENT_REPLAY_FAILED', failureReason: clean(cause.message),
        attempt, projectedAt: now()
      });
      this.repository.updateDomainReplayState(eventId, 'quarantined');
      throw Object.assign(cause, { code: cause.code || 'DOMAIN_EVENT_REPLAY_FAILED', receipt });
    }
  }
}

const singleton = new DomainEventLogService();
module.exports = { AUTHORITY, SCHEMA_VERSION, REDACTION_VERSION, MAX_REDACTION_DEPTH, MAX_REDACTION_NODES, MAX_EVENT_PAYLOAD_BYTES, DomainEventLogService, singleton, redactPayload, canonical, sha256 };
