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

function milestoneTwoOperationNotAuthorized(operation) {
  throw executionError(
    'WP_B_M2_OPERATION_NOT_YET_AUTHORIZED',
    `Schema 23 operation ${operation} is reserved for WP-B Milestone 2`,
    {
      operation,
      workPackage: 'WP-B',
      milestone: 'M2',
      status: 409
    }
  );
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

function normalizeAllowedStates(input = {}) {
  const source = Array.isArray(input.allowedStates)
    ? input.allowedStates
    : input.fromState == null
      ? []
      : [input.fromState];
  if (source.length < 1 || source.length > STATE_VALUES.size) {
    throw executionError(
      'WP_B_EXECUTION_ALLOWED_STATES_INVALID',
      'allowedStates must contain at least one registered lifecycle state'
    );
  }
  const unique = [];
  const seen = new Set();
  for (const value of source) {
    const state = requiredString(value, 'allowedStates', 64);
    if (!STATE_VALUES.has(state)) {
      throw executionError('WP_B_EXECUTION_STATE_INVALID', 'Allowed CAS state is not registered', { state });
    }
    if (!seen.has(state)) {
      unique.push(state);
      seen.add(state);
    }
  }
  return Object.freeze(unique);
}

function normalizeTransitionCommand(input = {}) {
  const targetState = requiredString(input.targetState, 'targetState', 64);
  if (!STATE_VALUES.has(targetState)) {
    throw executionError('WP_B_EXECUTION_STATE_INVALID', 'Target CAS state is not registered', { targetState });
  }
  const ownerId = requiredString(input.ownerId, 'ownerId');
  return deepFreeze({
    executionId: requiredString(input.executionId, 'executionId'),
    allowedStates: normalizeAllowedStates(input),
    targetState,
    stateVersion: safeInteger(
      input.expectedStateVersion ?? input.stateVersion,
      'expectedStateVersion'
    ),
    generation: safeInteger(input.generation, 'generation', 1),
    ownerId,
    claimId: requiredString(input.claimId, 'claimId'),
    hostId: requiredString(input.hostId, 'hostId'),
    hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    authorityTimestamp: normalizedTimestamp(input.authorityTimestamp),
    eventId: optionalString(input.eventId, 'eventId') || `execution-event-${crypto.randomUUID()}`,
    eventType: optionalString(input.eventType, 'eventType', 128) || 'transition',
    reasonCode: optionalString(input.reasonCode, 'reasonCode', 256),
    payload: canonicalPlainData(input.payload || {}, 'payload')
  });
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
    hostId: requiredString(input.hostId, 'hostId'),
    hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    authorityTimestamp: normalizedTimestamp(input.authorityTimestamp)
  });
}

function normalizeUnownedCasFacts(input = {}) {
  const fromState = requiredString(input.fromState, 'fromState', 64);
  const targetState = requiredString(input.targetState, 'targetState', 64);
  if (!STATE_VALUES.has(fromState) || !STATE_VALUES.has(targetState)) {
    throw executionError('WP_B_EXECUTION_STATE_INVALID', 'Unowned CAS state is not registered', {
      fromState,
      targetState
    });
  }
  return Object.freeze({
    executionId: requiredString(input.executionId, 'executionId'),
    fromState,
    targetState,
    stateVersion: safeInteger(input.stateVersion, 'stateVersion'),
    generation: safeInteger(input.generation, 'generation'),
    hostId: requiredString(input.hostId, 'hostId'),
    hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    authorityTimestamp: normalizedTimestamp(input.authorityTimestamp)
  });
}

function normalizeClaimFacts(input = {}) {
  const fromState = requiredString(input.fromState, 'fromState', 64);
  if (fromState !== LIFECYCLE_STATES.SCHEDULED) {
    throw executionError('WP_B_EXECUTION_CLAIM_STATE_INVALID', 'Only a scheduled execution can be claimed', {
      fromState
    });
  }
  const ownerId = requiredString(input.ownerId, 'ownerId');
  const leaseStartedAt = normalizedTimestamp(input.leaseStartedAt, 'leaseStartedAt');
  const leaseExpiresAt = normalizedTimestamp(input.leaseExpiresAt, 'leaseExpiresAt');
  if (Date.parse(leaseExpiresAt) <= Date.parse(leaseStartedAt)) {
    throw executionError(
      'WP_B_EXECUTION_CLAIM_LEASE_INVALID',
      'First-claim lease expiry must be later than its start',
      { leaseStartedAt, leaseExpiresAt }
    );
  }
  return Object.freeze({
    executionId: requiredString(input.executionId, 'executionId'),
    fromState,
    targetState: LIFECYCLE_STATES.CLAIMED,
    stateVersion: safeInteger(input.stateVersion, 'stateVersion'),
    generation: safeInteger(input.generation, 'generation'),
    ownerId,
    claimId: requiredString(input.claimId, 'claimId'),
    hostId: requiredString(input.hostId, 'hostId'),
    hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    leaseStartedAt,
    leaseExpiresAt
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

function executeUnownedExecutionTransitionCas(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Unowned execution transition CAS requires a SQLite database capability');
  }
  const facts = normalizeUnownedCasFacts(input);
  const result = db.prepare(`UPDATE durable_executions SET
      state=?,state_version=state_version+1,updated_at=?
    WHERE execution_id=? AND state=? AND state_version=? AND generation=?
      AND owner_id='' AND claim_id='' AND host_generation=0 AND fencing_token=0
      AND EXISTS(
        SELECT 1 FROM authority_write_host_lease
        WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
          AND fencing_token=? AND state='ACTIVE'
      )`).run(
    facts.targetState,
    facts.authorityTimestamp,
    facts.executionId,
    facts.fromState,
    facts.stateVersion,
    facts.generation,
    facts.hostId,
    facts.hostGeneration,
    facts.fencingToken
  );
  if (Number(result.changes || 0) !== 1) {
    throw executionError(
      'WP_B_EXECUTION_UNOWNED_CAS_REJECTED',
      'Unowned durable execution transition CAS rejected',
      {
        executionId: facts.executionId,
        fromState: facts.fromState,
        targetState: facts.targetState,
        stateVersion: facts.stateVersion,
        generation: facts.generation,
        hostGeneration: facts.hostGeneration,
        fencingToken: facts.fencingToken
      }
    );
  }
  return deepFreeze({
    executionId: facts.executionId,
    fromState: facts.fromState,
    targetState: facts.targetState,
    stateVersion: facts.stateVersion + 1,
    generation: facts.generation,
    authorityTimestamp: facts.authorityTimestamp
  });
}

function executeExecutionClaimCas(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Execution claim CAS requires a SQLite database capability');
  }
  const facts = normalizeClaimFacts(input);
  const result = db.prepare(`UPDATE durable_executions SET
      state=?,state_version=state_version+1,generation=generation+1,
      owner_id=?,claim_id=?,lease_sequence=lease_sequence+1,
      host_generation=?,fencing_token=?,lease_started_at=?,lease_expires_at=?,
      heartbeat_sequence=0,last_heartbeat_at=?,updated_at=?
    WHERE execution_id=? AND state=? AND state_version=? AND generation=?
      AND owner_id='' AND claim_id='' AND host_generation=0 AND fencing_token=0
      AND EXISTS(
        SELECT 1 FROM authority_write_host_lease
        WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
          AND fencing_token=? AND state='ACTIVE'
      )`).run(
    facts.targetState,
    facts.ownerId,
    facts.claimId,
    facts.hostGeneration,
    facts.fencingToken,
    facts.leaseStartedAt,
    facts.leaseExpiresAt,
    facts.leaseStartedAt,
    facts.leaseStartedAt,
    facts.executionId,
    facts.fromState,
    facts.stateVersion,
    facts.generation,
    facts.hostId,
    facts.hostGeneration,
    facts.fencingToken
  );
  if (Number(result.changes || 0) !== 1) {
    throw executionError('WP_B_EXECUTION_CLAIM_CAS_REJECTED', 'Durable execution first-claim CAS rejected', {
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
    generation: facts.generation + 1,
    ownerId: facts.ownerId,
    claimId: facts.claimId,
    hostGeneration: facts.hostGeneration,
    fencingToken: facts.fencingToken,
    leaseStartedAt: facts.leaseStartedAt,
    leaseExpiresAt: facts.leaseExpiresAt
  });
}

function isMissingSchema23MigrationTable(error) {
  return /no such table:\s*(?:main\.)?r32_schema_migrations\b/iu.test(
    String(error?.message || '')
  );
}

function schema23Applied(store) {
  try {
    const row = store.db.prepare(`SELECT status FROM r32_schema_migrations
      WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    return String(row?.status || '') === 'completed';
  } catch (error) {
    if (isMissingSchema23MigrationTable(error)) return false;
    throw error;
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

function appendV2Event(store, input = {}) {
  const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
    FROM durable_execution_events WHERE execution_id=?`).get(input.executionId)?.next || 1);
  store.db.prepare(`INSERT INTO durable_execution_events(
      event_id,execution_id,sequence,event_type,from_state,to_state,generation,
      owner_id,reason_code,payload_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    optionalString(input.eventId, 'eventId') || `execution-event-${crypto.randomUUID()}`,
    input.executionId,
    sequence,
    optionalString(input.eventType, 'eventType', 128) || 'transition',
    input.fromState,
    input.toState,
    input.generation,
    optionalString(input.ownerId, 'ownerId'),
    optionalString(input.reasonCode, 'reasonCode', 256),
    canonicalSerialize(canonicalPlainData(input.payload || {}, 'payload')),
    normalizedTimestamp(input.authorityTimestamp)
  );
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
      const metadataJson = canonicalSerialize(canonicalPlainData(input.metadata || {}, 'metadata'));
      const deadlineAt = optionalString(input.deadlineAt, 'deadlineAt');
      const values = [
        executionId,
        command.traceId,
        command.operationKind,
        command.idempotencyKey,
        command.commandContentSha256,
        HASH_VERSION,
        LIFECYCLE_STATES.CREATED,
        0,
        0,
        '',
        '',
        0,
        0,
        0,
        '',
        '',
        0,
        '',
        deadlineAt,
        '',
        '',
        0,
        maxAttempts,
        '',
        '',
        '',
        metadataJson,
        authorityTimestamp,
        authorityTimestamp,
        ''
      ];
      store.db.prepare(`INSERT INTO durable_executions(
        execution_id,trace_id,operation_kind,idempotency_key,command_content_sha256,
        content_hash_version,state,state_version,generation,owner_id,claim_id,lease_sequence,
        host_generation,fencing_token,lease_started_at,lease_expires_at,heartbeat_sequence,
        last_heartbeat_at,deadline_at,cancellation_requested_at,cancellation_actor,retry_count,
        max_attempts,next_attempt_at,failure_code,terminal_receipt_id,metadata_json,created_at,
        updated_at,completed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
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

  schedule(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.schedule(input);
    return store.transaction(() => {
      const result = executeUnownedExecutionTransitionCas(store.db, {
        executionId: input.executionId,
        fromState: LIFECYCLE_STATES.CREATED,
        targetState: LIFECYCLE_STATES.SCHEDULED,
        stateVersion: input.expectedStateVersion ?? input.stateVersion,
        generation: input.generation ?? input.expectedGeneration,
        hostId: input.hostId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken,
        authorityTimestamp: input.authorityTimestamp
      });
      appendV2Event(store, {
        eventId: input.eventId,
        executionId: result.executionId,
        eventType: 'scheduled',
        fromState: result.fromState,
        toState: result.targetState,
        generation: result.generation,
        ownerId: '',
        reasonCode: input.reasonCode,
        payload: { operationKind: optionalString(input.operationKind, 'operationKind', 128) },
        authorityTimestamp: result.authorityTimestamp
      });
      return this.get(result.executionId, store);
    });
  }

  claim(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.claim(input);
    return store.transaction(() => {
      const result = executeExecutionClaimCas(store.db, {
        executionId: input.executionId,
        fromState: LIFECYCLE_STATES.SCHEDULED,
        stateVersion: input.expectedStateVersion ?? input.stateVersion,
        generation: input.generation ?? input.expectedGeneration,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostId: input.hostId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken,
        leaseStartedAt: input.leaseStartedAt ?? input.authorityTimestamp,
        leaseExpiresAt: input.leaseExpiresAt
      });
      appendV2Event(store, {
        eventId: input.eventId,
        executionId: result.executionId,
        eventType: 'claimed',
        fromState: result.fromState,
        toState: result.targetState,
        generation: result.generation,
        ownerId: result.ownerId,
        reasonCode: input.reasonCode,
        payload: { claimId: result.claimId },
        authorityTimestamp: result.leaseStartedAt
      });
      return this.get(result.executionId, store);
    });
  }

  heartbeat(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.heartbeat(input);
    return milestoneTwoOperationNotAuthorized('heartbeat');
  }

  waitRemote(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.waitRemote(input);
    return milestoneTwoOperationNotAuthorized('waitRemote');
  }

  succeed(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.succeed(input);
    return milestoneTwoOperationNotAuthorized('succeed');
  }

  fail(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.fail(input);
    return milestoneTwoOperationNotAuthorized('fail');
  }

  requestCancel(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.requestCancel(input);
    return milestoneTwoOperationNotAuthorized('requestCancel');
  }

  acknowledgeCancel(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.acknowledgeCancel(input);
    return milestoneTwoOperationNotAuthorized('acknowledgeCancel');
  }

  retry(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.retry(input);
    return milestoneTwoOperationNotAuthorized('retry');
  }

  deadLetter(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.deadLetter(input);
    return milestoneTwoOperationNotAuthorized('deadLetter');
  }

  settleExternalAttempt(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return milestoneTwoOperationNotAuthorized('settleExternalAttempt');
    const executionId = requiredString(input.executionId, 'executionId');
    const outcome = requiredString(input.outcome, 'outcome', 32).toUpperCase();
    if (!['SUCCESS', 'FAILURE', 'UNKNOWN'].includes(outcome)) {
      throw executionError('WP_B_EXECUTION_SETTLEMENT_OUTCOME_INVALID', 'External attempt settlement outcome is invalid', { outcome });
    }
    const receiptId = requiredString(input.receiptId, 'receiptId');
    const stateVersion = safeInteger(input.stateVersion, 'stateVersion');
    const generation = safeInteger(input.generation, 'generation', 1);
    const ownerId = requiredString(input.ownerId, 'ownerId');
    const claimId = requiredString(input.claimId, 'claimId');
    const hostId = requiredString(input.hostId || ownerId, 'hostId');
    const hostGeneration = safeInteger(input.hostGeneration, 'hostGeneration', 1);
    const fencingToken = safeInteger(input.fencingToken, 'fencingToken', 1);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp);
    const retryable = input.retryable === true;
    const retryDelayMs = Math.min(
      7 * 24 * 60 * 60 * 1000,
      safeInteger(input.retryDelayMs ?? 0, 'retryDelayMs')
    );
    const suppliedFailureCode = optionalString(input.failureCode, 'failureCode', 256);
    const receiptType = outcome === 'SUCCESS' ? 'SUCCESS' : outcome === 'FAILURE' ? 'FAILURE' : 'UNKNOWN';

    return store.transaction(() => {
      const row = store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(executionId);
      if (!row) {
        throw executionError('WP_B_EXECUTION_NOT_FOUND', 'Durable execution does not exist', { executionId });
      }
      if (String(row.state || '') !== LIFECYCLE_STATES.WAITING_REMOTE) {
        throw executionError(
          'WP_B_EXECUTION_SETTLEMENT_STATE_INVALID',
          'External attempt settlement requires WAITING_REMOTE',
          { executionId, state: String(row.state || '') }
        );
      }
      const persistedRetryCount = safeInteger(row.retry_count || 0, 'persistedRetryCount');
      const persistedMaxAttempts = safeInteger(row.max_attempts || 1, 'persistedMaxAttempts', 1);
      let targetState = LIFECYCLE_STATES.SUCCEEDED;
      let retryCount = persistedRetryCount;
      let nextAttemptAt = '';
      let failureCode = '';
      if (outcome === 'UNKNOWN') {
        targetState = LIFECYCLE_STATES.UNCERTAIN_REMOTE_OUTCOME;
        failureCode = 'UNCERTAIN_REMOTE_OUTCOME';
      } else if (outcome === 'FAILURE') {
        failureCode = suppliedFailureCode || 'EXTERNAL_ACTION_FAILED';
        if (retryable) {
          retryCount = persistedRetryCount + 1;
          if (retryCount >= persistedMaxAttempts) {
            targetState = LIFECYCLE_STATES.DEAD_LETTERED;
          } else {
            targetState = LIFECYCLE_STATES.RETRY_SCHEDULED;
            nextAttemptAt = new Date(Date.parse(authorityTimestamp) + retryDelayMs).toISOString();
          }
        } else {
          targetState = LIFECYCLE_STATES.FAILED;
        }
      }
      const completedAt = TERMINAL_STATES.has(targetState) ? authorityTimestamp : '';
      const terminalReceiptId = TERMINAL_STATES.has(targetState) ? receiptId : '';
      const result = store.db.prepare(`UPDATE durable_executions SET
          state=?,state_version=state_version+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',last_heartbeat_at='',
          retry_count=?,next_attempt_at=?,failure_code=?,
          terminal_receipt_id=CASE WHEN ?<>'' THEN ? ELSE terminal_receipt_id END,
          updated_at=?,completed_at=CASE WHEN ?<>'' THEN ? ELSE '' END
        WHERE execution_id=? AND state='WAITING_REMOTE' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM external_action_receipts r
            JOIN external_action_intents i ON i.intent_id=r.intent_id
            WHERE r.receipt_id=? AND i.execution_id=? AND r.receipt_type=?
          )
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        retryCount,
        nextAttemptAt,
        failureCode,
        terminalReceiptId,
        terminalReceiptId,
        authorityTimestamp,
        completedAt,
        completedAt,
        executionId,
        stateVersion,
        generation,
        ownerId,
        claimId,
        hostGeneration,
        fencingToken,
        authorityTimestamp,
        receiptId,
        executionId,
        receiptType,
        hostId,
        hostGeneration,
        fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw executionError(
          'WP_B_EXECUTION_SETTLEMENT_CAS_REJECTED',
          'Receipt-bound external attempt settlement CAS rejected',
          { executionId, outcome, receiptId, stateVersion, generation, claimId, hostGeneration, fencingToken }
        );
      }
      appendV2Event(store, {
        executionId,
        eventType: outcome === 'SUCCESS'
          ? 'external-action-succeeded'
          : outcome === 'UNKNOWN'
            ? 'external-action-uncertain'
            : targetState === LIFECYCLE_STATES.RETRY_SCHEDULED
              ? 'external-action-retry-scheduled'
              : targetState === LIFECYCLE_STATES.DEAD_LETTERED
                ? 'external-action-dead-lettered'
                : 'external-action-failed',
        fromState: LIFECYCLE_STATES.WAITING_REMOTE,
        toState: targetState,
        generation,
        ownerId,
        reasonCode: outcome === 'SUCCESS'
          ? 'EXTERNAL_ACTION_RECEIPT_COMMITTED'
          : failureCode,
        payload: {
          receiptId,
          outcome,
          retryable: targetState === LIFECYCLE_STATES.RETRY_SCHEDULED,
          nextAttemptAt
        },
        authorityTimestamp
      });
      return this.get(executionId, store);
    });
  }

  transition(input = {}) {
    const store = this.store();
    if (!schema23Applied(store)) return super.transition(input);
    const command = normalizeTransitionCommand(input);
    return store.transaction(() => {
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
        FROM durable_execution_events WHERE execution_id=?`).get(command.executionId)?.next || 1);
      const statePlaceholders = command.allowedStates.map(() => '?').join(',');
      const eventInsert = store.db.prepare(`INSERT INTO durable_execution_events(
          event_id,execution_id,sequence,event_type,from_state,to_state,generation,
          owner_id,reason_code,payload_json,created_at
        )
        SELECT ?,execution_id,?,?,state,?,generation,owner_id,?,?,?
        FROM durable_executions
        WHERE execution_id=? AND state IN (${statePlaceholders}) AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        command.eventId,
        sequence,
        command.eventType,
        command.targetState,
        command.reasonCode,
        canonicalSerialize(command.payload),
        command.authorityTimestamp,
        command.executionId,
        ...command.allowedStates,
        command.stateVersion,
        command.generation,
        command.ownerId,
        command.claimId,
        command.hostGeneration,
        command.fencingToken,
        command.authorityTimestamp,
        command.hostId,
        command.hostGeneration,
        command.fencingToken
      );
      if (Number(eventInsert.changes || 0) !== 1) {
        throw executionError('WP_B_EXECUTION_CAS_REJECTED', 'Durable execution transition event CAS rejected', {
          executionId: command.executionId,
          allowedStates: command.allowedStates,
          stateVersion: command.stateVersion,
          generation: command.generation,
          claimId: command.claimId,
          hostGeneration: command.hostGeneration,
          fencingToken: command.fencingToken
        });
      }
      const eventRow = store.db.prepare(
        'SELECT from_state FROM durable_execution_events WHERE event_id=?'
      ).get(command.eventId);
      const fromState = requiredString(eventRow?.from_state, 'event.fromState', 64);
      executeExecutionTransitionCas(store.db, {
        executionId: command.executionId,
        fromState,
        targetState: command.targetState,
        stateVersion: command.stateVersion,
        generation: command.generation,
        ownerId: command.ownerId,
        claimId: command.claimId,
        hostId: command.hostId,
        hostGeneration: command.hostGeneration,
        fencingToken: command.fencingToken,
        authorityTimestamp: command.authorityTimestamp
      });
      return this.get(command.executionId, store);
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
module.exports.executeExecutionClaimCas = executeExecutionClaimCas;
module.exports.executeExecutionTransitionCas = executeExecutionTransitionCas;
module.exports.executeUnownedExecutionTransitionCas = executeUnownedExecutionTransitionCas;
module.exports.executionError = executionError;
module.exports.isMissingSchema23MigrationTable = isMissingSchema23MigrationTable;
module.exports.milestoneTwoOperationNotAuthorized = milestoneTwoOperationNotAuthorized;
module.exports.normalizeExecutionCommand = normalizeExecutionCommand;
module.exports.normalizeTransitionCommand = normalizeTransitionCommand;
module.exports.schema23Applied = schema23Applied;