'use strict';

const crypto = require('node:crypto');
const legacy = require('./durableExecutionAuthorityLegacy');
const { canonicalHash, canonicalSerialize } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');
const { STATES: LIFECYCLE_STATES } = require('./durableExecutionLifecycle');

const WP_B_AUTHORITY = 'DurableExecutionAuthorityV2';
const WP_B_SCHEMA_VERSION = 2;
const HASH_VERSION = 1;
const TERMINAL_STATES = new Set([
  LIFECYCLE_STATES.CANCELLED,
  LIFECYCLE_STATES.SUCCEEDED,
  LIFECYCLE_STATES.FAILED,
  LIFECYCLE_STATES.DEAD_LETTERED
]);
const STATE_VALUES = new Set(Object.values(LIFECYCLE_STATES));

function executionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (!result) throw executionError('WP_B_EXECUTION_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw executionError('WP_B_EXECUTION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw executionError('WP_B_EXECUTION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw executionError('WP_B_EXECUTION_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}

function normalizedTimestamp(value, field = 'authorityTimestamp') {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw executionError(
      'WP_B_EXECUTION_AUTHORITY_TIMESTAMP_INVALID',
      `${field} must be an explicit normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

function canonicalPlainData(value, field) {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(value == null ? {} : value)));
  } catch (error) {
    throw executionError('WP_B_EXECUTION_COMMAND_INVALID', `${field} must be canonical plain data`, {
      field,
      causeCode: String(error?.code || ''),
      causeMessage: String(error?.message || error)
    });
  }
}

function normalizeExecutionCommand(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw executionError('WP_B_EXECUTION_COMMAND_INVALID', 'Durable execution command must be an object');
  }
  const operationKind = requiredString(input.operationKind, 'operationKind', 128);
  const idempotencyKey = requiredString(input.idempotencyKey, 'idempotencyKey');
  const traceId = optionalString(input.traceId, 'traceId');
  const command = canonicalPlainData(input.command || {}, 'command');
  const commandContentSha256 = canonicalHash({
    schemaVersion: WP_B_SCHEMA_VERSION,
    operationKind,
    idempotencyKey,
    traceId,
    command
  });
  return deepFreeze({
    schemaVersion: WP_B_SCHEMA_VERSION,
    authority: WP_B_AUTHORITY,
    operationKind,
    idempotencyKey,
    traceId,
    commandContentSha256,
    contentHashVersion: HASH_VERSION,
    command
  });
}

function assertExecutionIdempotency(existing, command) {
  if (!existing) return null;
  const existingHash = String(existing.command_content_sha256 || '');
  const existingVersion = Number(existing.content_hash_version || 0);
  if (existingVersion !== HASH_VERSION || existingHash !== command.commandContentSha256) {
    throw executionError(
      'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT',
      'The durable execution idempotency key is already bound to different canonical content',
      {
        existingExecutionId: String(existing.execution_id || ''),
        operationKind: command.operationKind,
        idempotencyKey: command.idempotencyKey,
        existingCommandContentSha256: existingHash,
        incomingCommandContentSha256: command.commandContentSha256,
        existingContentHashVersion: existingVersion
      }
    );
  }
  return existing;
}

function normalizeCasFacts(input = {}) {
  const fromState = requiredString(input.fromState, 'fromState', 64);
  const targetState = requiredString(input.targetState, 'targetState', 64);
  if (!STATE_VALUES.has(fromState) || !STATE_VALUES.has(targetState)) {
    throw executionError('WP_B_EXECUTION_STATE_INVALID', 'CAS state is not registered', {
      fromState,
      targetState
    });
  }
  const ownerId = requiredString(input.ownerId, 'ownerId');
  return Object.freeze({
    executionId: requiredString(input.executionId, 'executionId'),
    fromState,
    targetState,
    stateVersion: safeInteger(input.stateVersion, 'stateVersion'),
    generation: safeInteger(input.generation, 'generation', 1),
    ownerId,
    claimId: requiredString(input.claimId, 'claimId'),
    hostId: optionalString(input.hostId, 'hostId') || ownerId,
    hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    authorityTimestamp: normalizedTimestamp(input.authorityTimestamp)
  });
}

function executeExecutionTransitionCas(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Execution transition CAS requires a SQLite database capability');
  }
  const facts = normalizeCasFacts(input);
  const completedAt = TERMINAL_STATES.has(facts.targetState) ? facts.authorityTimestamp : '';
  const result = db.prepare(`UPDATE durable_executions SET
      state=?,state_version=state_version+1,updated_at=?,
      completed_at=CASE WHEN ?<>'' THEN ? ELSE completed_at END
    WHERE execution_id=? AND state=? AND state_version=? AND generation=?
      AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
      AND lease_expires_at>=?
      AND EXISTS(
        SELECT 1 FROM authority_write_host_lease
        WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
          AND fencing_token=? AND state='ACTIVE'
      )`).run(
    facts.targetState,
    facts.authorityTimestamp,
    completedAt,
    completedAt,
    facts.executionId,
    facts.fromState,
    facts.stateVersion,
    facts.generation,
    facts.ownerId,
    facts.claimId,
    facts.hostGeneration,
    facts.fencingToken,
    facts.authorityTimestamp,
    facts.hostId,
    facts.hostGeneration,
    facts.fencingToken
  );
  if (Number(result.changes || 0) !== 1) {
    throw executionError('WP_B_EXECUTION_CAS_REJECTED', 'Durable execution transition CAS rejected', {
      executionId: facts.executionId,
      stateVersion: facts.stateVersion,
      generation: facts.generation,
      claimId: facts.claimId,
      hostGeneration: facts.hostGeneration,
      fencingToken: facts.fencingToken
    });
  }
  return deepFreeze({
    executionId: facts.executionId,
    fromState: facts.fromState,
    targetState: facts.targetState,
    stateVersion: facts.stateVersion + 1,
    generation: facts.generation,
    ownerId: facts.ownerId,
    claimId: facts.claimId,
    hostGeneration: facts.hostGeneration,
    fencingToken: facts.fencingToken,
    authorityTimestamp: facts.authorityTimestamp
  });
}

function schema23Applied(store) {
  try {
    const row = store.db.prepare(`SELECT status FROM r32_schema_migrations
      WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    return String(row?.status || '') === 'completed';
  } catch (_) {
    return false;
  }
}

function parseJson(value, fallback = {}) {
  try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; }
}

function executionSnapshotV2(row, history = []) {
  if (!row) return null;
  return deepFreeze({
    authority: WP_B_AUTHORITY,
    schemaVersion: WP_B_SCHEMA_VERSION,
    executionId: String(row.execution_id || ''),
    traceId: String(row.trace_id || ''),
    operationKind: String(row.operation_kind || ''),
    idempotencyKey: String(row.idempotency_key || ''),
    commandContentSha256: String(row.command_content_sha256 || ''),
    contentHashVersion: Number(row.content_hash_version || 0),
    state: String(row.state || ''),
    stateVersion: Number(row.state_version || 0),
    generation: Number(row.generation || 0),
    ownerId: String(row.owner_id || ''),
    claimId: String(row.claim_id || ''),
    hostGeneration: Number(row.host_generation || 0),
    fencingToken: Number(row.fencing_token || 0),
    leaseStartedAt: String(row.lease_started_at || ''),
    leaseExpiresAt: String(row.lease_expires_at || ''),
    heartbeatSequence: Number(row.heartbeat_sequence || 0),
    lastHeartbeatAt: String(row.last_heartbeat_at || ''),
    deadlineAt: String(row.deadline_at || ''),
    terminalReceiptId: String(row.terminal_receipt_id || ''),
    retryCount: Number(row.retry_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextAttemptAt: String(row.next_attempt_at || ''),
    failureCode: String(row.failure_code || ''),
    metadata: canonicalPlainData(parseJson(row.metadata_json, {}), 'persistedExecution.metadata'),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    completedAt: String(row.completed_at || ''),
    history
  });
}

class DurableExecutionAuthority extends legacy.DurableExecutionAuthority {
  schema23Applied(store = this.store()) {
    return schema23Applied(store);
  }

  get(executionId, store = this.store()) {
    if (!schema23Applied(store)) return super.get(executionId, store);
    const id = requiredString(executionId, 'executionId');
    const row = store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(id);
    return executionSnapshotV2(row, row ? this.history(id, store) : []);
  }

  createExecution(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.createExecution(input);
    const command = normalizeExecutionCommand(input);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp);
    const maxAttempts = Math.max(1, Math.min(100, safeInteger(input.maxAttempts ?? 3, 'maxAttempts', 1)));
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM durable_executions
        WHERE operation_kind=? AND idempotency_key=?`).get(command.operationKind, command.idempotencyKey);
      if (existing) {
        assertExecutionIdempotency(existing, command);
        return this.get(existing.execution_id, store);
      }
      const executionId = optionalString(input.executionId, 'executionId')
        || `execution-${crypto.randomUUID()}`;
      store.db.prepare(`INSERT INTO durable_executions(
        execution_id,trace_id,operation_kind,idempotency_key,command_content_sha256,
        content_hash_version,state,state_version,generation,owner_id,claim_id,lease_sequence,
        host_generation,fencing_token,lease_started_at,lease_expires_at,heartbeat_sequence,
        last_heartbeat_at,deadline_at,cancellation_requested_at,cancellation_actor,retry_count,
        max_attempts,next_attempt_at,failure_code,terminal_receipt_id,metadata_json,created_at,
        updated_at,completed_at
      ) VALUES(?,?,?,?,?,?,?,0,0,'','',0,0,0,'','',0,'',?,'','',0,?,'','','','',?,?,?,'')`).run(
        executionId,
        command.traceId,
        command.operationKind,
        command.idempotencyKey,
        command.commandContentSha256,
        HASH_VERSION,
        LIFECYCLE_STATES.CREATED,
        optionalString(input.deadlineAt, 'deadlineAt'),
        maxAttempts,
        canonicalSerialize(canonicalPlainData(input.metadata || {}, 'metadata')),
        authorityTimestamp,
        authorityTimestamp
      );
      store.db.prepare(`INSERT INTO durable_execution_events(
        event_id,execution_id,sequence,event_type,from_state,to_state,generation,
        owner_id,reason_code,payload_json,created_at
      ) VALUES(?,?,1,'created','',?,0,'','',?,?)`).run(
        `execution-event-${crypto.randomUUID()}`,
        executionId,
        LIFECYCLE_STATES.CREATED,
        canonicalSerialize({ commandContentSha256: command.commandContentSha256 }),
        authorityTimestamp
      );
      return this.get(executionId, store);
    });
  }

  transition(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.transition(input);
    return store.transaction(() => {
      const result = executeExecutionTransitionCas(store.db, input);
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
        FROM durable_execution_events WHERE execution_id=?`).get(result.executionId)?.next || 1);
      store.db.prepare(`INSERT INTO durable_execution_events(
        event_id,execution_id,sequence,event_type,from_state,to_state,generation,
        owner_id,reason_code,payload_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        optionalString(input.eventId, 'eventId') || `execution-event-${crypto.randomUUID()}`,
        result.executionId,
        sequence,
        optionalString(input.eventType, 'eventType', 128) || 'transition',
        result.fromState,
        result.targetState,
        result.generation,
        result.ownerId,
        optionalString(input.reasonCode, 'reasonCode', 256),
        canonicalSerialize(canonicalPlainData(input.payload || {}, 'payload')),
        result.authorityTimestamp
      );
      return this.get(result.executionId, store);
    });
  }
}

const durableExecutionAuthority = new DurableExecutionAuthority();
module.exports = durableExecutionAuthority;
module.exports.DurableExecutionAuthority = DurableExecutionAuthority;
module.exports.AUTHORITY = legacy.AUTHORITY;
module.exports.WP_B_AUTHORITY = WP_B_AUTHORITY;
module.exports.SCHEMA_VERSION = legacy.SCHEMA_VERSION;
module.exports.WP_B_SCHEMA_VERSION = WP_B_SCHEMA_VERSION;
module.exports.STATES = legacy.STATES;
module.exports.WP_B_STATES = LIFECYCLE_STATES;
module.exports.assertExecutionIdempotency = assertExecutionIdempotency;
module.exports.executeExecutionTransitionCas = executeExecutionTransitionCas;
module.exports.executionError = executionError;
module.exports.normalizeExecutionCommand = normalizeExecutionCommand;
module.exports.schema23Applied = schema23Applied;
