'use strict';

const crypto = require('node:crypto');
const { canonicalHash, canonicalSerialize } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');
const {
  DurableExecutionAuthority,
  WP_B_STATES,
  executionError
} = require('./durableExecutionAuthority');

const AUTHORITY = 'DurableInternalOperationAuthority';
const SCHEMA_VERSION = 1;
const DEFAULT_LEASE_MS = 120000;
const TERMINAL_STATES = new Set([
  WP_B_STATES.SUCCEEDED,
  WP_B_STATES.FAILED,
  WP_B_STATES.CANCELLED,
  WP_B_STATES.DEAD_LETTERED
]);
const REFERENCE_PAYLOAD_KEYS = new Set([
  'status',
  'reasonCode',
  'receiptId',
  'providerRequestId',
  'messageId',
  'mediaId',
  'accountId',
  'modelId',
  'progress',
  'counts',
  'errorCode',
  'resultReference',
  'evidenceReference',
  'objectFingerprint'
]);
const OPERATION_KIND_RULES = Object.freeze([
  Object.freeze({
    operationKind: 'DELIVERY_RECEIPT_RECONCILIATION',
    expression: /(?:^|\.)(?:delivery\.receipt|receipt\.reconcile)(?:\.|$)/u
  }),
  Object.freeze({
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    expression: /(?:^|\.)(?:outbound\.message|message\.send)(?:\.|$)/u
  }),
  Object.freeze({
    operationKind: 'SESSION_RESTORE',
    expression: /(?:^|\.)(?:platform\.auth|session|login|account\.restore)(?:\.|$)/u
  }),
  Object.freeze({
    operationKind: 'MEDIA_TRANSFER',
    expression: /(?:^|\.)(?:avatar|media|transcription)(?:\.|$)/u
  }),
  Object.freeze({
    operationKind: 'HISTORY_SYNCHRONIZATION',
    expression: /(?:^|\.)(?:history|projection|sync)(?:\.|$)/u
  }),
  Object.freeze({
    operationKind: 'AI_PROVIDER_EXECUTION',
    expression: /(?:^|\.)(?:translation|openrouter|ai|model|provider)(?:\.|$)/u
  })
]);

function internalOperationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_FIELD_INVALID',
      `${field} is required and must be a bounded printable string`,
      { field, maximum }
    );
  }
  return result;
}

function optionalString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_FIELD_INVALID',
      `${field} must be a bounded printable string`,
      { field, maximum }
    );
  }
  return result;
}

function normalizedTimestamp(value, field = 'authorityTimestamp') {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_TIMESTAMP_INVALID',
      `${field} must be a normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

function safeInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_INTEGER_INVALID',
      `${field} must be a safe integer between ${minimum} and ${maximum}`,
      { field, minimum, maximum }
    );
  }
  return result;
}

function internalOperationKindFor(operationType) {
  const normalized = requiredString(operationType, 'operationType', 256).toLowerCase();
  for (const rule of OPERATION_KIND_RULES) {
    if (rule.expression.test(normalized)) return rule.operationKind;
  }
  throw internalOperationError(
    'WP_B_INTERNAL_OPERATION_KIND_UNREGISTERED',
    'Internal operation type is not mapped to the sealed six operation kinds',
    { operationType: normalized }
  );
}

function sanitizeReferencePayload(value, field = 'payload', depth = 0) {
  if (depth > 4) {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_REFERENCE_PAYLOAD_INVALID',
      `${field} exceeds the maximum reference depth`,
      { field }
    );
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return optionalString(value, field, 2048);
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_REFERENCE_PAYLOAD_INVALID',
        `${field} exceeds the maximum array length`,
        { field }
      );
    }
    return value.map((item, index) => sanitizeReferencePayload(item, `${field}[${index}]`, depth + 1));
  }
  if (typeof value !== 'object') {
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_REFERENCE_PAYLOAD_INVALID',
      `${field} must contain canonical reference data`,
      { field }
    );
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!REFERENCE_PAYLOAD_KEYS.has(key)) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_REFERENCE_PAYLOAD_KEY_FORBIDDEN',
        `Reference payload key ${key} is forbidden`,
        { field, key }
      );
    }
    output[key] = sanitizeReferencePayload(item, `${field}.${key}`, depth + 1);
  }
  return output;
}

function canonicalReferencePayload(value, field = 'payload') {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(sanitizeReferencePayload(value || {}, field))));
  } catch (error) {
    if (String(error?.code || '').startsWith('WP_B_INTERNAL_OPERATION_')) throw error;
    throw internalOperationError(
      'WP_B_INTERNAL_OPERATION_REFERENCE_PAYLOAD_INVALID',
      `${field} must be canonical reference data`,
      { field, causeCode: String(error?.code || error?.name || 'UNKNOWN') }
    );
  }
}

function canonicalFailurePayload(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
  const errorCode = optionalString(source.errorCode ?? source.code, 'failurePayload.errorCode', 256);
  delete source.code;
  if (errorCode) source.errorCode = errorCode;
  return canonicalReferencePayload(source, 'failurePayload');
}

function validateToken(value) {
  const token = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return deepFreeze({
    instanceId: requiredString(token.instanceId, 'token.instanceId'),
    hostGeneration: safeInteger(token.hostGeneration, 'token.hostGeneration', 1),
    fencingToken: safeInteger(token.fencingToken, 'token.fencingToken', 1)
  });
}

function eventProgress(history = [], terminalState = '') {
  let progress = 0;
  for (const event of history) {
    const value = Number(event?.payload?.progress);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 100) progress = value;
  }
  return TERMINAL_STATES.has(terminalState) && terminalState === WP_B_STATES.SUCCEEDED
    ? 100
    : progress;
}

function latestPayload(history = [], eventTypes = []) {
  const allowed = new Set(eventTypes);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (allowed.has(history[index]?.eventType)) return history[index]?.payload || {};
  }
  return {};
}

function operationSnapshot(execution) {
  if (!execution) return null;
  const metadata = execution.metadata || {};
  const progress = eventProgress(execution.history, execution.state);
  const terminalPayload = latestPayload(execution.history, [
    'internal-operation-succeeded',
    'internal-operation-failed',
    'internal-operation-cancelled'
  ]);
  return deepFreeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    operationId: execution.executionId,
    executionId: execution.executionId,
    operationType: String(metadata.internalOperationType || ''),
    operationKind: execution.operationKind,
    scopeKey: String(metadata.scopeKey || ''),
    objectFingerprint: String(metadata.objectFingerprint || ''),
    state: execution.state,
    stateVersion: execution.stateVersion,
    generation: execution.generation,
    ownerId: execution.ownerId,
    claimId: execution.claimId,
    hostGeneration: execution.hostGeneration,
    fencingToken: execution.fencingToken,
    leaseStartedAt: execution.leaseStartedAt,
    leaseExpiresAt: execution.leaseExpiresAt,
    heartbeatSequence: execution.heartbeatSequence,
    lastHeartbeatAt: execution.lastHeartbeatAt,
    deadlineAt: execution.deadlineAt,
    retryCount: execution.retryCount,
    maxAttempts: execution.maxAttempts,
    nextAttemptAt: execution.nextAttemptAt,
    failureCode: execution.failureCode,
    progress,
    result: execution.state === WP_B_STATES.SUCCEEDED ? terminalPayload : {},
    error: execution.state === WP_B_STATES.FAILED ? terminalPayload : {},
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    completedAt: execution.completedAt,
    history: execution.history
  });
}

class DurableInternalOperationAuthority {
  constructor({
    storeProvider,
    tokenProvider,
    clock = () => new Date().toISOString(),
    idFactory = prefix => `${prefix}-${crypto.randomUUID()}`,
    leaseMs = DEFAULT_LEASE_MS
  } = {}) {
    if (typeof storeProvider !== 'function') throw new TypeError('Durable internal operation storeProvider is required');
    if (typeof tokenProvider !== 'function') throw new TypeError('Durable internal operation tokenProvider is required');
    if (typeof clock !== 'function') throw new TypeError('Durable internal operation clock is required');
    if (typeof idFactory !== 'function') throw new TypeError('Durable internal operation idFactory is required');
    this.storeProvider = storeProvider;
    this.tokenProvider = tokenProvider;
    this.clock = clock;
    this.idFactory = idFactory;
    this.leaseMs = safeInteger(leaseMs, 'leaseMs', 1000, 24 * 60 * 60 * 1000);
    this.executionAuthority = new DurableExecutionAuthority({ storeProvider, idFactory, clock });
  }

  store() {
    const store = this.storeProvider();
    if (!store?.db || typeof store.db.prepare !== 'function' || typeof store.transaction !== 'function') {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_STORE_REQUIRED',
        'Durable internal operation requires a transactional Schema 23 store'
      );
    }
    if (!this.executionAuthority.schema23Applied(store)) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_SCHEMA_23_REQUIRED',
        'Schema 23 must be applied before internal operation use'
      );
    }
    return store;
  }

  token() {
    return validateToken(this.tokenProvider());
  }

  timestamp() {
    return normalizedTimestamp(this.clock());
  }

  read(operationId) {
    this.store();
    return operationSnapshot(this.executionAuthority.get(requiredString(operationId, 'operationId')));
  }

  latest({ operationType = '', scopeKey = '' } = {}) {
    const store = this.store();
    const normalizedOperationType = requiredString(operationType, 'operationType', 256).toLowerCase();
    const normalizedScopeKey = requiredString(scopeKey, 'scopeKey');
    const row = store.db.prepare(`SELECT execution_id FROM durable_executions
      WHERE json_extract(metadata_json,'$.internalOperationType')=?
        AND json_extract(metadata_json,'$.scopeKey')=?
      ORDER BY created_at DESC,execution_id DESC LIMIT 1`).get(
      normalizedOperationType,
      normalizedScopeKey
    );
    return row ? this.read(row.execution_id) : null;
  }

  create(input = {}) {
    const store = this.store();
    const operationId = requiredString(input.operationId || this.idFactory('internal-operation'), 'operationId');
    const operationType = requiredString(input.operationType, 'operationType', 256).toLowerCase();
    const operationKind = internalOperationKindFor(operationType);
    const scopeKey = requiredString(input.scopeKey, 'scopeKey');
    const objectFingerprint = requiredString(input.objectFingerprint, 'objectFingerprint');
    const metadataPatch = canonicalReferencePayload(input.metadata || {}, 'metadata');
    const metadata = deepFreeze({
      internalOperationType: operationType,
      scopeKey,
      objectFingerprint,
      progress: Number.isSafeInteger(Number(metadataPatch.progress)) ? Number(metadataPatch.progress) : 0
    });
    const idempotencyKey = `internal-operation:${operationType}:${scopeKey}:${objectFingerprint}`;
    const existingRow = store.db.prepare(`SELECT execution_id FROM durable_executions
      WHERE operation_kind=? AND idempotency_key=?`).get(operationKind, idempotencyKey);
    const authorityTimestamp = this.timestamp();
    let execution = this.executionAuthority.createExecution({
      executionId: operationId,
      traceId: optionalString(input.traceId, 'traceId'),
      operationKind,
      idempotencyKey,
      command: {
        schemaVersion: SCHEMA_VERSION,
        internalOperationType: operationType,
        scopeKey,
        objectFingerprint
      },
      metadata,
      deadlineAt: optionalString(input.deadlineAt, 'deadlineAt'),
      authorityTimestamp,
      maxAttempts: safeInteger(input.maxAttempts ?? 1, 'maxAttempts', 1, 100)
    });
    if (execution.state === WP_B_STATES.CREATED) {
      const token = this.token();
      execution = this.executionAuthority.schedule({
        executionId: execution.executionId,
        stateVersion: execution.stateVersion,
        generation: execution.generation,
        hostId: token.instanceId,
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken,
        authorityTimestamp: this.timestamp(),
        eventType: 'internal-operation-scheduled',
        operationKind
      });
    }
    return deepFreeze({
      created: !existingRow,
      reason: existingRow ? 'IDEMPOTENT_EXISTING_OPERATION' : 'CREATED_AND_SCHEDULED',
      operation: operationSnapshot(execution)
    });
  }

  start(operationId, patch = {}) {
    this.store();
    const current = this.executionAuthority.get(requiredString(operationId, 'operationId'));
    if (!current) {
      throw internalOperationError('WP_B_INTERNAL_OPERATION_NOT_FOUND', 'Internal operation does not exist', { operationId });
    }
    if (current.state !== WP_B_STATES.SCHEDULED) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_START_STATE_INVALID',
        'Only a scheduled internal operation can start',
        { operationId: current.executionId, state: current.state }
      );
    }
    const token = this.token();
    const leaseStartedAt = this.timestamp();
    const leaseExpiresAt = new Date(Date.parse(leaseStartedAt) + this.leaseMs).toISOString();
    const claimed = this.executionAuthority.claim({
      executionId: current.executionId,
      stateVersion: current.stateVersion,
      generation: current.generation,
      ownerId: token.instanceId,
      claimId: this.idFactory('internal-operation-claim'),
      hostId: token.instanceId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      leaseStartedAt,
      leaseExpiresAt,
      reasonCode: 'INTERNAL_OPERATION_START'
    });
    const progress = patch.progress == null ? 0 : safeInteger(patch.progress, 'progress', 0, 100);
    const running = this.executionAuthority.transition({
      executionId: claimed.executionId,
      allowedStates: [WP_B_STATES.CLAIMED],
      targetState: WP_B_STATES.RUNNING,
      stateVersion: claimed.stateVersion,
      generation: claimed.generation,
      ownerId: claimed.ownerId,
      claimId: claimed.claimId,
      hostId: token.instanceId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      authorityTimestamp: this.timestamp(),
      eventType: 'internal-operation-started',
      reasonCode: 'INTERNAL_OPERATION_STARTED',
      payload: { progress }
    });
    return deepFreeze({ updated: true, operation: operationSnapshot(running) });
  }

  progress(operationId, progressValue) {
    const store = this.store();
    const current = this.executionAuthority.get(requiredString(operationId, 'operationId'));
    if (!current) {
      throw internalOperationError('WP_B_INTERNAL_OPERATION_NOT_FOUND', 'Internal operation does not exist', { operationId });
    }
    if (current.state !== WP_B_STATES.RUNNING) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_PROGRESS_STATE_INVALID',
        'Progress is accepted only for a running internal operation',
        { operationId: current.executionId, state: current.state }
      );
    }
    const progress = safeInteger(progressValue, 'progress', 0, 100);
    const token = this.token();
    const authorityTimestamp = this.timestamp();
    store.transaction(() => {
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
        FROM durable_execution_events WHERE execution_id=?`).get(current.executionId)?.next || 1);
      const eventId = this.idFactory('internal-operation-event');
      const result = store.db.prepare(`INSERT INTO durable_execution_events(
          event_id,execution_id,sequence,event_type,from_state,to_state,generation,
          owner_id,reason_code,payload_json,created_at
        )
        SELECT ?,execution_id,?,'internal-operation-progress',state,state,generation,
          owner_id,'INTERNAL_OPERATION_PROGRESS',?,?
        FROM durable_executions
        WHERE execution_id=? AND state='RUNNING' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        eventId,
        sequence,
        canonicalSerialize({ progress }),
        authorityTimestamp,
        current.executionId,
        current.stateVersion,
        current.generation,
        current.ownerId,
        current.claimId,
        current.hostGeneration,
        current.fencingToken,
        authorityTimestamp,
        token.instanceId,
        token.hostGeneration,
        token.fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw internalOperationError(
          'WP_B_INTERNAL_OPERATION_OBSERVATION_CAS_REJECTED',
          'Internal operation progress observation was rejected by current claim or Host fencing',
          {
            operationId: current.executionId,
            stateVersion: current.stateVersion,
            generation: current.generation,
            claimId: current.claimId,
            hostGeneration: current.hostGeneration,
            fencingToken: current.fencingToken
          }
        );
      }
    });
    return deepFreeze({ updated: true, operation: this.read(current.executionId) });
  }

  heartbeat(operationId) {
    const store = this.store();
    const current = this.executionAuthority.get(requiredString(operationId, 'operationId'));
    if (!current) {
      throw internalOperationError('WP_B_INTERNAL_OPERATION_NOT_FOUND', 'Internal operation does not exist', { operationId });
    }
    if (current.state !== WP_B_STATES.RUNNING && current.state !== WP_B_STATES.WAITING_REMOTE) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_HEARTBEAT_STATE_INVALID',
        'Heartbeat is accepted only for a running or remote-waiting internal operation',
        { operationId: current.executionId, state: current.state }
      );
    }
    const token = this.token();
    const heartbeatAt = this.timestamp();
    const leaseExpiresAt = new Date(Date.parse(heartbeatAt) + this.leaseMs).toISOString();
    store.transaction(() => {
      const result = store.db.prepare(`UPDATE durable_executions SET
          state_version=state_version+1,heartbeat_sequence=heartbeat_sequence+1,
          last_heartbeat_at=?,lease_expires_at=?,updated_at=?
        WHERE execution_id=? AND state=? AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        heartbeatAt,
        leaseExpiresAt,
        heartbeatAt,
        current.executionId,
        current.state,
        current.stateVersion,
        current.generation,
        token.instanceId,
        current.claimId,
        token.hostGeneration,
        token.fencingToken,
        heartbeatAt,
        token.instanceId,
        token.hostGeneration,
        token.fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw internalOperationError(
          'WP_B_INTERNAL_OPERATION_HEARTBEAT_CAS_REJECTED',
          'Internal operation heartbeat was rejected by current claim, lease, or Host fencing',
          {
            operationId: current.executionId,
            stateVersion: current.stateVersion,
            generation: current.generation,
            claimId: current.claimId,
            hostGeneration: current.hostGeneration,
            fencingToken: current.fencingToken
          }
        );
      }
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
        FROM durable_execution_events WHERE execution_id=?`).get(current.executionId)?.next || 1);
      store.db.prepare(`INSERT INTO durable_execution_events(
          event_id,execution_id,sequence,event_type,from_state,to_state,generation,
          owner_id,reason_code,payload_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        this.idFactory('internal-operation-event'),
        current.executionId,
        sequence,
        'internal-operation-heartbeat',
        current.state,
        current.state,
        current.generation,
        token.instanceId,
        'INTERNAL_OPERATION_HEARTBEAT',
        canonicalSerialize({ status: 'heartbeat' }),
        heartbeatAt
      );
    });
    return deepFreeze({ updated: true, operation: this.read(current.executionId) });
  }

  terminal(operationId, targetState, payload = {}, options = {}) {
    this.store();
    const current = this.executionAuthority.get(requiredString(operationId, 'operationId'));
    if (!current) {
      throw internalOperationError('WP_B_INTERNAL_OPERATION_NOT_FOUND', 'Internal operation does not exist', { operationId });
    }
    if (current.state !== WP_B_STATES.RUNNING && current.state !== WP_B_STATES.CANCEL_REQUESTED) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_TERMINAL_STATE_INVALID',
        'Internal operation terminal transition requires RUNNING or CANCEL_REQUESTED',
        { operationId: current.executionId, state: current.state, targetState }
      );
    }
    if (options.generation != null && safeInteger(options.generation, 'generation', 1) !== current.generation) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_GENERATION_STALE',
        'Internal operation generation is stale',
        { expectedGeneration: options.generation, actualGeneration: current.generation }
      );
    }
    const expectedFingerprint = optionalString(options.objectFingerprint, 'objectFingerprint');
    if (expectedFingerprint && expectedFingerprint !== String(current.metadata?.objectFingerprint || '')) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_OBJECT_FINGERPRINT_STALE',
        'Internal operation object fingerprint is stale',
        { expectedFingerprint, actualFingerprint: String(current.metadata?.objectFingerprint || '') }
      );
    }
    const token = this.token();
    const eventType = targetState === WP_B_STATES.SUCCEEDED
      ? 'internal-operation-succeeded'
      : targetState === WP_B_STATES.CANCELLED
        ? 'internal-operation-cancelled'
        : 'internal-operation-failed';
    const transitioned = this.executionAuthority.transition({
      executionId: current.executionId,
      allowedStates: [current.state],
      targetState,
      stateVersion: current.stateVersion,
      generation: current.generation,
      ownerId: current.ownerId,
      claimId: current.claimId,
      hostId: token.instanceId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      authorityTimestamp: this.timestamp(),
      eventType,
      reasonCode: optionalString(options.reasonCode, 'reasonCode', 256),
      payload: canonicalReferencePayload(payload, 'terminalPayload')
    });
    return deepFreeze({ updated: true, operation: operationSnapshot(transitioned) });
  }

  succeed(operationId, result = {}, options = {}) {
    return this.terminal(operationId, WP_B_STATES.SUCCEEDED, result, options);
  }

  fail(operationId, error = {}, options = {}) {
    const retryable = options.retryable === true;
    const failurePayload = canonicalFailurePayload(error);
    if (!retryable) {
      const result = this.terminal(operationId, WP_B_STATES.FAILED, failurePayload, options);
      return deepFreeze({ ...result, retryable: false });
    }

    const store = this.store();
    const current = this.executionAuthority.get(requiredString(operationId, 'operationId'));
    if (!current) {
      throw internalOperationError('WP_B_INTERNAL_OPERATION_NOT_FOUND', 'Internal operation does not exist', { operationId });
    }
    if (current.state !== WP_B_STATES.RUNNING && current.state !== WP_B_STATES.WAITING_REMOTE) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_RETRY_STATE_INVALID',
        'Retryable failure requires a running or remote-waiting internal operation',
        { operationId: current.executionId, state: current.state }
      );
    }
    if (options.generation != null && safeInteger(options.generation, 'generation', 1) !== current.generation) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_GENERATION_STALE',
        'Internal operation generation is stale',
        { expectedGeneration: options.generation, actualGeneration: current.generation }
      );
    }
    const expectedFingerprint = optionalString(options.objectFingerprint, 'objectFingerprint');
    if (expectedFingerprint && expectedFingerprint !== String(current.metadata?.objectFingerprint || '')) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_OBJECT_FINGERPRINT_STALE',
        'Internal operation object fingerprint is stale',
        { expectedFingerprint, actualFingerprint: String(current.metadata?.objectFingerprint || '') }
      );
    }
    const persistedMaxAttempts = safeInteger(current.maxAttempts || 1, 'persistedMaxAttempts', 1, 100);
    if (options.maxAttempts != null
        && safeInteger(options.maxAttempts, 'maxAttempts', 1, 100) !== persistedMaxAttempts) {
      throw internalOperationError(
        'WP_B_INTERNAL_OPERATION_MAX_ATTEMPTS_MISMATCH',
        'Retry policy must match the persisted Schema 23 execution',
        { expectedMaxAttempts: persistedMaxAttempts, receivedMaxAttempts: Number(options.maxAttempts) }
      );
    }
    const retryCount = safeInteger(Number(current.retryCount || 0) + 1, 'retryCount', 1, 100);
    const retryDelayMs = safeInteger(
      options.retryDelayMs ?? 0,
      'retryDelayMs',
      0,
      7 * 24 * 60 * 60 * 1000
    );
    const authorityTimestamp = this.timestamp();
    const nextAttemptAt = new Date(Date.parse(authorityTimestamp) + retryDelayMs).toISOString();
    const targetState = retryCount >= persistedMaxAttempts
      ? WP_B_STATES.DEAD_LETTERED
      : WP_B_STATES.RETRY_SCHEDULED;
    const scheduledNextAttemptAt = targetState === WP_B_STATES.RETRY_SCHEDULED ? nextAttemptAt : '';
    const completedAt = targetState === WP_B_STATES.DEAD_LETTERED ? authorityTimestamp : '';
    const failureCode = optionalString(
      failurePayload.errorCode || options.reasonCode || 'INTERNAL_OPERATION_FAILED',
      'failureCode',
      256
    );
    const token = this.token();

    store.transaction(() => {
      const result = store.db.prepare(`UPDATE durable_executions SET
          state=?,state_version=state_version+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',last_heartbeat_at='',
          retry_count=?,next_attempt_at=?,failure_code=?,updated_at=?,
          completed_at=CASE WHEN ?<>'' THEN ? ELSE '' END
        WHERE execution_id=? AND state=? AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        retryCount,
        scheduledNextAttemptAt,
        failureCode,
        authorityTimestamp,
        completedAt,
        completedAt,
        current.executionId,
        current.state,
        current.stateVersion,
        current.generation,
        token.instanceId,
        current.claimId,
        token.hostGeneration,
        token.fencingToken,
        authorityTimestamp,
        token.instanceId,
        token.hostGeneration,
        token.fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw internalOperationError(
          'WP_B_INTERNAL_OPERATION_RETRY_CAS_REJECTED',
          'Internal operation retry scheduling was rejected by current claim, lease, or Host fencing',
          {
            operationId: current.executionId,
            stateVersion: current.stateVersion,
            generation: current.generation,
            claimId: current.claimId,
            hostGeneration: current.hostGeneration,
            fencingToken: current.fencingToken
          }
        );
      }
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
        FROM durable_execution_events WHERE execution_id=?`).get(current.executionId)?.next || 1);
      store.db.prepare(`INSERT INTO durable_execution_events(
          event_id,execution_id,sequence,event_type,from_state,to_state,generation,
          owner_id,reason_code,payload_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        this.idFactory('internal-operation-event'),
        current.executionId,
        sequence,
        targetState === WP_B_STATES.RETRY_SCHEDULED
          ? 'internal-operation-retry-scheduled'
          : 'internal-operation-dead-lettered',
        current.state,
        targetState,
        current.generation,
        '',
        failureCode,
        canonicalSerialize({
          errorCode: failureCode,
          retryable: targetState === WP_B_STATES.RETRY_SCHEDULED,
          nextAttemptAt: scheduledNextAttemptAt,
          attempt: retryCount
        }),
        authorityTimestamp
      );
    });

    return deepFreeze({
      updated: true,
      retryable: targetState === WP_B_STATES.RETRY_SCHEDULED,
      operation: this.read(current.executionId)
    });
  }

  cancel(operationId, receipt = {}, options = {}) {
    const normalizedReceipt = typeof receipt === 'string'
      ? { reasonCode: optionalString(receipt, 'cancelReasonCode', 256) || 'CANCELLED' }
      : receipt;
    return this.terminal(operationId, WP_B_STATES.CANCELLED, normalizedReceipt, options);
  }

  snapshot({ operationType = '', state = '', limit = 100 } = {}) {
    const store = this.store();
    const bounded = safeInteger(limit, 'limit', 1, 1000);
    const rows = store.db.prepare(`SELECT execution_id FROM durable_executions
      WHERE (?='' OR json_extract(metadata_json,'$.internalOperationType')=?)
        AND (?='' OR state=?)
      ORDER BY updated_at DESC,execution_id ASC LIMIT ?`).all(
      optionalString(operationType, 'operationType', 256),
      optionalString(operationType, 'operationType', 256),
      optionalString(state, 'state', 64),
      optionalString(state, 'state', 64),
      bounded
    );
    return deepFreeze(rows.map(row => this.read(row.execution_id)));
  }
}

function currentRuntimeInternalOperationAuthority() {
  const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
  const authority = AppRuntimeFactory.current()?.composition?.authorities?.durableInternalOperationAuthority;
  if (!authority || typeof authority.create !== 'function' || typeof authority.read !== 'function') {
    throw internalOperationError(
      'WP_B_RUNTIME_INTERNAL_OPERATION_AUTHORITY_REQUIRED',
      'The current AppRuntime has not composed DurableInternalOperationAuthority'
    );
  }
  return authority;
}

module.exports = Object.freeze({
  AUTHORITY,
  DurableInternalOperationAuthority,
  OPERATION_KIND_RULES,
  REFERENCE_PAYLOAD_KEYS: Object.freeze([...REFERENCE_PAYLOAD_KEYS].sort()),
  SCHEMA_VERSION,
  canonicalReferencePayload,
  currentRuntimeInternalOperationAuthority,
  internalOperationError,
  internalOperationKindFor,
  operationSnapshot
});