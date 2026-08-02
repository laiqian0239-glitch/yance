'use strict';

const eventBus = require('./eventBus');
const { getStore } = require('../repositories/storeProvider');
const { canonicalSerialize, canonicalHash } = require('./canonicalSerialization');
const { CLASSIFICATIONS } = require('./dataClassificationRegistry');
const { createAuthorityCommandEnvelope } = require('./authorityCommandProtocol');
const { AuthorityTransactionCoordinator } = require('./authorityTransactionCoordinator');

const AUTHORITY = 'CanonicalEventLedgerAuthority';
const SCHEMA_VERSION = 1;
const REDACTION_VERSION = 'classification-v1';
const MAX_EVENT_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_REDACTION_DEPTH = 32;
const MAX_REDACTION_NODES = 10000;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const APPEND_INPUT_FIELDS = new Set([
  'commandId',
  'idempotencyKey',
  'aggregateType',
  'aggregateId',
  'expectedVersion',
  'actor',
  'traceId',
  'correlationId',
  'causationId',
  'eventId',
  'eventType',
  'externalEventId',
  'schemaVersion',
  'payloadClassification',
  'occurredAt',
  'receivedAt',
  'payload',
  'payloadSha256',
  'platform',
  'sourceAccountId',
  'generation',
  'redactionVersion',
  'retentionClass',
  'retentionDays',
  'retentionUntil',
  'ledgerSegmentId'
]);
const SECRET_KEY = /(?:token|secret|password|passwd|cookie|authorization|credential|qr(?:code)?|sessionkey|privatekey|clientsecret|accesstoken|refreshtoken)/i;
const BINARY_KEY = /(?:buffer|binary|blob|filebytes|media(?:data|bytes)|base64)/i;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|session(?:id|key)?|cookie|authorization)=([^&\s]+)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
]);

function authorityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, status: details.status || 400, ...details });
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function required(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result) throw authorityError('CANONICAL_EVENT_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw authorityError('CANONICAL_EVENT_FIELD_INVALID', `${field} is invalid`, {
      field,
      maximum,
      length: result.length
    });
  }
  return result;
}

function optional(value, field, maximum = 2048) {
  const result = clean(value);
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw authorityError('CANONICAL_EVENT_FIELD_INVALID', `${field} is invalid`, {
      field,
      maximum,
      length: result.length
    });
  }
  return result;
}

function timestamp(value, fallback, field) {
  const candidate = clean(value) || clean(fallback);
  const milliseconds = Date.parse(candidate);
  if (!candidate || !Number.isFinite(milliseconds)) {
    throw authorityError('CANONICAL_EVENT_TIMESTAMP_INVALID', `${field} is invalid`, { field });
  }
  return new Date(milliseconds).toISOString();
}

function canonical(value) {
  return canonicalSerialize(value);
}

function sha256(value) {
  return canonicalHash(value);
}

function assertAppendInputShape(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw authorityError('CANONICAL_EVENT_INPUT_INVALID', 'Canonical event append input must be a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw authorityError('CANONICAL_EVENT_INPUT_INVALID', 'Canonical event append input must be a plain object');
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw authorityError(
      'CANONICAL_EVENT_INPUT_SYMBOL_KEY_FORBIDDEN',
      'Canonical event append input cannot contain symbol-keyed state'
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const normalized = {};
  for (const field of Object.getOwnPropertyNames(input)) {
    if (FORBIDDEN_OBJECT_KEYS.has(field)) {
      throw authorityError('CANONICAL_EVENT_INPUT_FORBIDDEN_KEY', 'Canonical event input contains a prototype mutation key', {
        field
      });
    }
    if (!APPEND_INPUT_FIELDS.has(field)) {
      throw authorityError('CANONICAL_EVENT_INPUT_FIELD_UNREGISTERED', `Canonical event input field ${field} is not registered`, {
        field
      });
    }
    const descriptor = descriptors[field];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw authorityError('CANONICAL_EVENT_INPUT_ACCESSOR_FORBIDDEN', 'Canonical event input cannot contain accessors', {
        field
      });
    }
    normalized[field] = descriptor.value;
  }
  return Object.freeze(normalized);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function redactString(value, path, report) {
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
  if (changed) report.push(Object.freeze({ path, reason: 'secret-value' }));
  return output;
}

function redactPayload(value, keyPath = [], report = [], state = null, depth = 0) {
  const context = state || { seen: new WeakSet(), nodes: 0 };
  const path = keyPath.length ? `$.${keyPath.join('.')}` : '$';
  context.nodes += 1;
  if (context.nodes > MAX_REDACTION_NODES) {
    report.push(Object.freeze({ path, reason: 'node-limit' }));
    return '[REDACTED_NODE_LIMIT]';
  }
  if (depth > MAX_REDACTION_DEPTH) {
    report.push(Object.freeze({ path, reason: 'depth-limit' }));
    return '[REDACTED_DEPTH_LIMIT]';
  }
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value, path, report);
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    report.push(Object.freeze({ path, reason: 'non-finite-number' }));
    return '[REDACTED_NON_FINITE_NUMBER]';
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    report.push(Object.freeze({ path, reason: 'non-json-value' }));
    return '[REDACTED_NON_JSON_VALUE]';
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes = Number(value.byteLength || value.length || 0);
    report.push(Object.freeze({ path, reason: 'inline-binary' }));
    return Object.freeze({ redacted: true, reason: 'binary-not-stored', bytes });
  }
  if (context.seen.has(value)) {
    report.push(Object.freeze({ path, reason: 'cycle' }));
    return '[REDACTED_CIRCULAR]';
  }
  context.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => redactPayload(item, [...keyPath, String(index)], report, context, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      report.push(Object.freeze({ path, reason: 'non-plain-object' }));
      return '[REDACTED_NON_PLAIN_OBJECT]';
    }
    if (Object.getOwnPropertySymbols(value).length) {
      report.push(Object.freeze({ path, reason: 'symbol-key' }));
      return '[REDACTED_SYMBOL_KEYED_OBJECT]';
    }
    const output = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const itemPath = [...keyPath, key];
      const printablePath = `$.${itemPath.join('.')}`;
      if (FORBIDDEN_OBJECT_KEYS.has(key)) {
        report.push(Object.freeze({ path: printablePath, reason: 'forbidden-key' }));
        continue;
      }
      const descriptor = descriptors[key];
      if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
        output[key] = '[REDACTED_ACCESSOR]';
        report.push(Object.freeze({ path: printablePath, reason: 'accessor' }));
        continue;
      }
      if (SECRET_KEY.test(key)) {
        output[key] = '[REDACTED]';
        report.push(Object.freeze({ path: printablePath, reason: 'secret-key' }));
        continue;
      }
      if (BINARY_KEY.test(key) && (typeof descriptor.value === 'string'
        || Buffer.isBuffer(descriptor.value)
        || ArrayBuffer.isView(descriptor.value)
        || descriptor.value instanceof ArrayBuffer)) {
        const bytes = typeof descriptor.value === 'string'
          ? Buffer.byteLength(descriptor.value, 'utf8')
          : Number(descriptor.value.byteLength || descriptor.value.length || 0);
        output[key] = Object.freeze({ redacted: true, reason: 'binary-or-base64-not-stored', bytes });
        report.push(Object.freeze({ path: printablePath, reason: 'binary-or-base64' }));
        continue;
      }
      output[key] = redactPayload(descriptor.value, itemPath, report, context, depth + 1);
    }
    return output;
  } finally {
    context.seen.delete(value);
  }
}

function normalizePayload(value, classification, report) {
  const normalized = classification === CLASSIFICATIONS.BUSINESS_CONTENT
    ? redactPayload(value ?? {}, [], report)
    : JSON.parse(canonicalSerialize(value ?? {}));
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw authorityError('CANONICAL_EVENT_PAYLOAD_INVALID', 'Canonical event payload must be a plain object');
  }
  return normalized;
}

function deterministicId(prefix, value) {
  return `${prefix}:${canonicalHash(value).slice(0, 48)}`;
}

function parseJson(value, fallback = null) {
  try {
    return value == null || value === '' ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function installLedgerGuards(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new TypeError('CanonicalEventLedgerAuthority requires a SQLite database');
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS acv2_canonical_event_headers_update_forbidden
    BEFORE UPDATE ON canonical_event_headers
    BEGIN
      SELECT RAISE(ABORT, 'canonical_event_headers is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS acv2_canonical_event_headers_delete_forbidden
    BEFORE DELETE ON canonical_event_headers
    BEGIN
      SELECT RAISE(ABORT, 'canonical_event_headers is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS acv2_authority_payload_store_update_forbidden
    BEFORE UPDATE ON authority_payload_store
    BEGIN
      SELECT RAISE(ABORT, 'authority_payload_store active payload is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS acv2_authority_payload_store_delete_forbidden
    BEFORE DELETE ON authority_payload_store
    BEGIN
      SELECT RAISE(ABORT, 'authority_payload_store active payload is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS acv2_legacy_domain_event_append_forbidden
    BEFORE INSERT ON domain_events
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_EVENT_LEDGER_APPEND_REQUIRED');
    END;
  `);
}

function publicEvent(row, payload) {
  if (!row) return null;
  return Object.freeze({
    ledgerSequence: Number(row.ledger_sequence || 0),
    eventId: clean(row.event_id),
    eventType: clean(row.event_type),
    aggregateType: clean(row.aggregate_type),
    aggregateId: clean(row.aggregate_id),
    aggregateVersion: Number(row.aggregate_version || 0),
    commandId: clean(row.command_id),
    idempotencyKey: clean(row.idempotency_key),
    traceId: clean(row.trace_id),
    correlationId: clean(row.correlation_id),
    causationId: clean(row.causation_id),
    platform: clean(row.platform),
    sourceAccountId: clean(row.source_account_id),
    generation: Number(row.generation || 0),
    occurredAt: clean(row.occurred_at),
    recordedAt: clean(row.recorded_at),
    payloadId: clean(row.payload_id),
    payloadSha256: clean(row.payload_sha256),
    payloadClassification: clean(row.classification),
    redactionVersion: clean(row.redaction_version),
    schemaVersion: Number(row.schema_version || 0),
    canonicalizationVersion: Number(row.canonicalization_version || 0),
    writerAuthority: clean(row.writer_authority),
    hostGeneration: Number(row.host_generation || 0),
    fencingToken: Number(row.fencing_token || 0),
    ledgerSegmentId: clean(row.ledger_segment_id),
    payload: deepFreeze(payload)
  });
}

class CanonicalEventLedgerAuthority {
  constructor(options = {}) {
    if (!options.coordinator || typeof options.coordinator.execute !== 'function') {
      throw new TypeError('CanonicalEventLedgerAuthority requires AuthorityTransactionCoordinator');
    }
    if (!options.store || !options.store.db) {
      throw new TypeError('CanonicalEventLedgerAuthority requires the current AuthorityWriteHost store');
    }
    this.coordinator = options.coordinator;
    this.store = options.store;
    this.db = options.store.db;
    this.clock = typeof options.clock === 'function' ? options.clock : (() => Date.now());
    this.evidenceRecorder = typeof options.evidenceRecorder === 'function' ? options.evidenceRecorder : (() => {});
    this.compatibilityRepository = options.compatibilityRepository || null;
    installLedgerGuards(this.db);
  }

  readEvent(eventIdInput) {
    const eventId = required(eventIdInput, 'eventId', 1024);
    const row = this.db.prepare(`
      SELECT h.*, p.classification, p.canonical_json, p.payload_sha256 AS stored_payload_sha256
      FROM canonical_event_headers h
      JOIN authority_payload_store p ON p.payload_id=h.payload_id
      WHERE h.event_id=?
    `).get(eventId);
    if (!row) return null;
    const payload = parseJson(row.canonical_json, null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw authorityError('CANONICAL_EVENT_PAYLOAD_CORRUPT', 'Canonical event payload is not replayable', { eventId });
    }
    const computedHash = canonicalHash(payload);
    const headerHash = clean(row.payload_sha256).toLowerCase();
    const storedHash = clean(row.stored_payload_sha256).toLowerCase();
    if (computedHash !== headerHash || computedHash !== storedHash) {
      throw authorityError('CANONICAL_EVENT_PAYLOAD_HASH_MISMATCH', 'Canonical event payload hash does not match committed header', {
        eventId,
        computedHash,
        headerHash,
        storedHash
      });
    }
    return publicEvent(row, payload);
  }

  append(input = {}) {
    const source = assertAppendInputShape(input);
    const occurredAt = timestamp(source.occurredAt, new Date(Number(this.clock())).toISOString(), 'occurredAt');
    const platform = optional(source.platform, 'platform', 64).toLowerCase();
    const sourceAccountId = optional(source.sourceAccountId, 'sourceAccountId', 1024);
    const eventType = required(source.eventType, 'eventType', 256);
    const externalEventId = optional(source.externalEventId, 'externalEventId', 1024);
    if (externalEventId && (!platform || !sourceAccountId)) {
      throw authorityError(
        'CANONICAL_EVENT_EXTERNAL_SCOPE_INCOMPLETE',
        'externalEventId requires platform and sourceAccountId'
      );
    }
    const externalIdentity = externalEventId
      ? Object.freeze({ platform, sourceAccountId, eventType, externalEventId })
      : null;
    const idempotencyKey = optional(source.idempotencyKey, 'idempotencyKey', 2048)
      || (externalIdentity
        ? `${platform}:${sourceAccountId}:${eventType}:${externalEventId}`
        : '');
    if (!idempotencyKey) {
      throw authorityError(
        'CANONICAL_EVENT_IDEMPOTENCY_REQUIRED',
        'Canonical event append requires idempotencyKey or scoped externalEventId'
      );
    }

    const report = [];
    const payloadClassification = optional(source.payloadClassification, 'payloadClassification', 64)
      || CLASSIFICATIONS.BUSINESS_CONTENT;
    if (!Object.values(CLASSIFICATIONS).includes(payloadClassification)) {
      throw authorityError('CANONICAL_EVENT_CLASSIFICATION_INVALID', 'payloadClassification is not registered', {
        payloadClassification
      });
    }
    const payload = normalizePayload(source.payload, payloadClassification, report);
    const payloadCanonical = canonicalSerialize(payload);
    if (Buffer.byteLength(payloadCanonical, 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
      throw authorityError('CANONICAL_EVENT_PAYLOAD_TOO_LARGE', 'Canonical event payload exceeds maximum size', {
        maximum: MAX_EVENT_PAYLOAD_BYTES
      });
    }
    const payloadSha256 = canonicalHash(payload);
    const callerHash = optional(source.payloadSha256, 'payloadSha256', 64).toLowerCase();
    if (callerHash && callerHash !== payloadSha256) {
      throw authorityError('CANONICAL_EVENT_PAYLOAD_HASH_MISMATCH', 'Caller payload hash does not match canonical payload', {
        expectedPayloadSha256: payloadSha256,
        receivedPayloadSha256: callerHash
      });
    }

    const aggregateType = optional(source.aggregateType, 'aggregateType', 128) || 'DomainEvent';
    const provisionalAggregateId = optional(source.aggregateId, 'aggregateId', 1024)
      || deterministicId('aggregate', externalIdentity || { authority: AUTHORITY, idempotencyKey });
    const eventId = optional(source.eventId, 'eventId', 1024)
      || deterministicId('event', { authority: AUTHORITY, idempotencyKey });
    const commandId = optional(source.commandId, 'commandId', 512)
      || deterministicId('command', { authority: AUTHORITY, idempotencyKey });
    const traceId = optional(source.traceId, 'traceId', 512)
      || deterministicId('trace', { authority: AUTHORITY, idempotencyKey });
    const expectedVersion = source.expectedVersion == null ? 0 : Number(source.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw authorityError('CANONICAL_EVENT_EXPECTED_VERSION_INVALID', 'expectedVersion must be a non-negative safe integer', {
        expectedVersion: source.expectedVersion
      });
    }
    const schemaVersion = source.schemaVersion == null ? SCHEMA_VERSION : Number(source.schemaVersion);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw authorityError('CANONICAL_EVENT_SCHEMA_VERSION_INVALID', 'schemaVersion must be a positive safe integer', {
        schemaVersion: source.schemaVersion
      });
    }
    const generation = source.generation == null ? 0 : Number(source.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw authorityError('CANONICAL_EVENT_GENERATION_INVALID', 'generation must be a non-negative safe integer', {
        generation: source.generation
      });
    }

    const command = createAuthorityCommandEnvelope({
      commandId,
      authorityScope: AUTHORITY,
      commandType: 'canonical-event.append',
      idempotencyKey,
      aggregateType,
      aggregateId: provisionalAggregateId,
      expectedVersion,
      actor: source.actor || { actorType: 'system', actorId: 'canonical-event-ledger' },
      traceId,
      correlationId: optional(source.correlationId, 'correlationId', 512),
      causationId: optional(source.causationId, 'causationId', 512),
      payload: {
        eventId,
        eventType,
        externalEventId,
        payloadSha256,
        payloadClassification,
        platform,
        sourceAccountId,
        schemaVersion
      }
    });

    const projectionStateHash = canonicalHash({
      eventId,
      eventType,
      aggregateType,
      aggregateId: provisionalAggregateId,
      payloadSha256,
      schemaVersion
    });
    const receipt = this.coordinator.execute({
      command,
      event: {
        eventId,
        eventType,
        schemaVersion,
        payloadClassification,
        occurredAt,
        payload,
        platform,
        sourceAccountId,
        generation,
        redactionVersion: optional(source.redactionVersion, 'redactionVersion', 128) || REDACTION_VERSION,
        retentionClass: optional(source.retentionClass, 'retentionClass', 128) || 'ACTIVE_REPLAY',
        ledgerSegmentId: optional(source.ledgerSegmentId, 'ledgerSegmentId', 512) || 'segment-active-v1'
      },
      projector: {
        projectorId: 'canonical-event-ledger',
        projectorVersion: 'a4-v1',
        apply: () => ({
          stateHash: projectionStateHash,
          result: { eventId, payloadSha256, externalEventId }
        })
      }
    });

    const event = this.readEvent(receipt.eventId);
    if (!event) {
      throw authorityError('CANONICAL_EVENT_COMMIT_INCOMPLETE', 'Committed canonical event cannot be read back', {
        eventId: receipt.eventId
      });
    }
    if (!receipt.replayed) {
      try {
        this.evidenceRecorder(Object.freeze({
          authority: AUTHORITY,
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          ledgerSequence: event.ledgerSequence,
          payloadSha256: event.payloadSha256,
          payloadClassification: event.payloadClassification,
          commandId: event.commandId,
          idempotencyKey: event.idempotencyKey,
          traceId: event.traceId,
          hostGeneration: event.hostGeneration,
          fencingToken: event.fencingToken,
          committedAt: receipt.committedAt,
          redactedFieldCount: report.length
        }));
      } catch (_) {}
    }
    return Object.freeze({
      authority: AUTHORITY,
      created: !receipt.replayed,
      event,
      receipt,
      redactions: Object.freeze([...report])
    });
  }

  requireCompatibilityRepository() {
    if (!this.compatibilityRepository) {
      throw authorityError(
        'CANONICAL_EVENT_COMPATIBILITY_REPOSITORY_REQUIRED',
        'Compatibility projection operations require the platform repository'
      );
    }
    return this.compatibilityRepository;
  }

  recordShadowProjection(input = {}) {
    const eventId = required(input.eventId, 'eventId', 1024);
    if (!this.readEvent(eventId)) throw authorityError('CANONICAL_EVENT_NOT_FOUND', 'Canonical event does not exist', { eventId });
    const repository = this.requireCompatibilityRepository();
    const expectedHash = canonicalHash(input.expectedProjection ?? null);
    const actualHash = canonicalHash(input.actualProjection ?? null);
    const matches = expectedHash === actualHash;
    const receipt = repository.upsertProjectionReceipt({
      projectorName: optional(input.projectorName, 'projectorName', 256) || 'unknown-projector',
      projectorVersion: optional(input.projectorVersion, 'projectorVersion', 128) || 'v1',
      eventId,
      projectionStatus: matches ? 'shadow-match' : 'shadow-mismatch',
      projectionHash: actualHash,
      targetRefs: input.targetRefs || [],
      failureCode: matches ? '' : 'SHADOW_PROJECTION_MISMATCH',
      failureReason: matches ? '' : `expected=${expectedHash};actual=${actualHash}`,
      attempt: Number(input.attempt || 1),
      projectedAt: optional(input.projectedAt, 'projectedAt', 64) || new Date(Number(this.clock())).toISOString()
    });
    return Object.freeze({ authority: AUTHORITY, matches, expectedHash, actualHash, receipt });
  }

  recordAppliedProjection(input = {}) {
    const eventId = required(input.eventId, 'eventId', 1024);
    if (!this.readEvent(eventId)) throw authorityError('CANONICAL_EVENT_NOT_FOUND', 'Canonical event does not exist', { eventId });
    const repository = this.requireCompatibilityRepository();
    const projectionHash = canonicalHash(input.projection ?? null);
    const receipt = repository.upsertProjectionReceipt({
      projectorName: optional(input.projectorName, 'projectorName', 256) || 'production-message-projector',
      projectorVersion: optional(input.projectorVersion, 'projectorVersion', 128) || 'v1',
      eventId,
      projectionStatus: 'applied',
      projectionHash,
      targetRefs: input.targetRefs || [],
      failureCode: '',
      failureReason: '',
      attempt: Number(input.attempt || 1),
      projectedAt: optional(input.projectedAt, 'projectedAt', 64) || new Date(Number(this.clock())).toISOString()
    });
    return Object.freeze({ authority: AUTHORITY, applied: true, projectionHash, receipt });
  }

  convergence(input = {}) {
    const repository = this.requireCompatibilityRepository();
    const status = repository.projectionConvergence({
      projectorName: optional(input.projectorName, 'projectorName', 256) || 'message-projection',
      projectorVersion: optional(input.projectorVersion, 'projectorVersion', 128) || 'a4-v1'
    });
    return Object.freeze({ authority: AUTHORITY, ...status });
  }

  assertConverged(input = {}) {
    const status = this.convergence(input);
    if (!status.converged) {
      throw authorityError('CANONICAL_EVENT_PROJECTION_NOT_CONVERGED', 'Canonical event projection is not converged', {
        status: 409,
        ...status
      });
    }
    return status;
  }

  recordProjectionFailure(input = {}) {
    const eventId = required(input.eventId, 'eventId', 1024);
    if (!this.readEvent(eventId)) throw authorityError('CANONICAL_EVENT_NOT_FOUND', 'Canonical event does not exist', { eventId });
    const repository = this.requireCompatibilityRepository();
    const receipt = repository.upsertProjectionReceipt({
      projectorName: optional(input.projectorName, 'projectorName', 256) || 'production-message-projector',
      projectorVersion: optional(input.projectorVersion, 'projectorVersion', 128) || 'v1',
      eventId,
      projectionStatus: 'failed',
      projectionHash: '',
      targetRefs: input.targetRefs || [],
      failureCode: optional(input.failureCode || input.error?.code, 'failureCode', 256) || 'CANONICAL_EVENT_PROJECTION_FAILED',
      failureReason: optional(input.failureReason || input.error?.message, 'failureReason', 2048),
      attempt: Number(input.attempt || 1),
      projectedAt: optional(input.projectedAt, 'projectedAt', 64) || new Date(Number(this.clock())).toISOString()
    });
    return Object.freeze({ authority: AUTHORITY, failed: true, receipt });
  }

  async replay(input = {}) {
    const eventId = required(input.eventId, 'eventId', 1024);
    const event = this.readEvent(eventId);
    if (!event) throw authorityError('CANONICAL_EVENT_NOT_FOUND', 'Canonical event does not exist', { eventId });
    if (typeof input.projector !== 'function') {
      throw authorityError('CANONICAL_EVENT_PROJECTOR_REQUIRED', 'Replay requires a projector function');
    }
    const repository = this.compatibilityRepository;
    const projectorName = optional(input.projectorName, 'projectorName', 256) || 'replay-projector';
    const projectorVersion = optional(input.projectorVersion, 'projectorVersion', 128) || 'v1';
    const previous = repository?.getProjectionReceipt?.(projectorName, projectorVersion, eventId) || null;
    if (previous?.projection_status === 'applied' && input.forceReapply !== true) {
      return Object.freeze({ authority: AUTHORITY, applied: false, idempotentReplay: true, receipt: previous });
    }
    try {
      const result = await input.projector(event);
      const projectionHash = canonicalHash(result ?? null);
      const receipt = repository?.upsertProjectionReceipt?.({
        projectorName,
        projectorVersion,
        eventId,
        projectionStatus: 'applied',
        projectionHash,
        targetRefs: result?.targetRefs || [],
        failureCode: '',
        failureReason: '',
        attempt: Math.max(Number(input.attempt || 1), 1),
        projectedAt: new Date(Number(this.clock())).toISOString()
      }) || null;
      return Object.freeze({ authority: AUTHORITY, applied: true, eventId, result, projectionHash, receipt });
    } catch (cause) {
      const receipt = repository?.upsertProjectionReceipt?.({
        projectorName,
        projectorVersion,
        eventId,
        projectionStatus: 'failed',
        projectionHash: '',
        targetRefs: [],
        failureCode: optional(cause?.code, 'failureCode', 256) || 'CANONICAL_EVENT_REPLAY_FAILED',
        failureReason: optional(cause?.message, 'failureReason', 2048),
        attempt: Math.max(Number(input.attempt || 1), 1),
        projectedAt: new Date(Number(this.clock())).toISOString()
      }) || null;
      throw Object.assign(cause, { code: cause?.code || 'CANONICAL_EVENT_REPLAY_FAILED', receipt });
    }
  }
}

function createCanonicalEventLedgerAuthority(options = {}) {
  if (options.canonicalAuthority) return options.canonicalAuthority;
  const compatibilityRepository = options.repository || options.compatibilityRepository || null;
  const store = options.store
    || (compatibilityRepository && typeof compatibilityRepository.store === 'function'
      ? compatibilityRepository.store()
      : getStore());
  const coordinator = options.coordinator || new AuthorityTransactionCoordinator({
    store,
    eventBus: options.eventBus || eventBus,
    clock: options.clock
  });
  return new CanonicalEventLedgerAuthority({
    coordinator,
    store,
    clock: options.clock,
    evidenceRecorder: options.evidenceRecorder,
    compatibilityRepository
  });
}

let configuredSingleton = null;
function resolveSingleton() {
  if (!configuredSingleton) configuredSingleton = createCanonicalEventLedgerAuthority();
  return configuredSingleton;
}
function configureSingleton(authority) {
  if (!(authority instanceof CanonicalEventLedgerAuthority)) {
    throw new TypeError('configureSingleton requires CanonicalEventLedgerAuthority');
  }
  configuredSingleton = authority;
  return configuredSingleton;
}
const singleton = Object.freeze({
  append: input => resolveSingleton().append(input),
  readEvent: eventId => resolveSingleton().readEvent(eventId),
  recordShadowProjection: input => resolveSingleton().recordShadowProjection(input),
  recordAppliedProjection: input => resolveSingleton().recordAppliedProjection(input),
  convergence: input => resolveSingleton().convergence(input),
  assertConverged: input => resolveSingleton().assertConverged(input),
  recordProjectionFailure: input => resolveSingleton().recordProjectionFailure(input),
  replay: input => resolveSingleton().replay(input)
});

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  REDACTION_VERSION,
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_REDACTION_DEPTH,
  MAX_REDACTION_NODES,
  CanonicalEventLedgerAuthority,
  createCanonicalEventLedgerAuthority,
  configureSingleton,
  singleton,
  redactPayload,
  canonical,
  sha256,
  authorityError,
  installLedgerGuards
};
