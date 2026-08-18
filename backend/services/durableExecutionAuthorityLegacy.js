'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');

const AUTHORITY = 'DurableExecutionAuthority';
const SCHEMA_VERSION = 1;
const STATES = Object.freeze({
  CREATED: 'CREATED',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  WAITING_REMOTE: 'WAITING_REMOTE',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  DEAD_LETTERED: 'DEAD_LETTERED'
});
const TERMINAL = new Set([STATES.CANCELLED, STATES.SUCCEEDED, STATES.FAILED, STATES.DEAD_LETTERED]);
const SAFE_KEYS = new Set([
  'platform', 'checkpoint', 'receiptId', 'providerRequestId', 'routeReceiptId',
  'deliveryReceiptId', 'learningReceiptId', 'reasonCode', 'reasonCodes', 'status',
  'progress', 'counts', 'attempt', 'retryable', 'nextAttemptAt', 'operationKind',
  'modelId', 'provider', 'messageKind', 'mediaState', 'syncState', 'page',
  'offset', 'total', 'completed', 'failed', 'warning', 'skipped',
  'accountId', 'sourceAccountId', 'streamKind', 'externalConversationId', 'mediaId',
  'messageId', 'attemptId', 'cursor', 'highWatermark', 'traceId'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultClock() { return new Date().toISOString(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function parse(value, fallback = {}) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function boundedAttempts(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 3;
}
function sanitize(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SAFE_KEYS.has(key)) continue;
      const safe = sanitize(item, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return undefined;
}
function eventRow(row = {}) {
  return {
    eventId: clean(row.event_id),
    executionId: clean(row.execution_id),
    sequence: Number(row.sequence || 0),
    eventType: clean(row.event_type),
    fromState: clean(row.from_state),
    toState: clean(row.to_state),
    generation: Number(row.generation || 0),
    ownerId: clean(row.owner_id),
    reasonCode: clean(row.reason_code),
    payload: parse(row.payload_json, {}),
    createdAt: clean(row.created_at)
  };
}
function executionRow(row = {}, history = []) {
  if (!row) return null;
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    executionId: clean(row.execution_id),
    traceId: clean(row.trace_id),
    operationKind: clean(row.operation_kind),
    idempotencyKey: clean(row.idempotency_key),
    state: clean(row.state),
    generation: Number(row.generation || 0),
    ownerId: clean(row.owner_id),
    leaseSequence: Number(row.lease_sequence || 0),
    lastHeartbeatAt: clean(row.last_heartbeat_at),
    cancellationRequestedAt: clean(row.cancellation_requested_at),
    cancellationActor: clean(row.cancellation_actor),
    retryCount: Number(row.retry_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextAttemptAt: clean(row.next_attempt_at),
    failureCode: clean(row.failure_code),
    metadata: parse(row.metadata_json, {}),
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    completedAt: clean(row.completed_at),
    history
  };
}

class DurableExecutionAuthority {
  constructor({ storeProvider = getStore, idFactory = defaultIdFactory, clock = defaultClock } = {}) {
    this.storeProvider = storeProvider;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  store() { return this.storeProvider(); }
  row(executionId, store = this.store()) {
    return store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(clean(executionId));
  }
  history(executionId, store = this.store()) {
    return store.db.prepare('SELECT * FROM durable_execution_events WHERE execution_id=? ORDER BY sequence ASC').all(clean(executionId)).map(eventRow);
  }
  get(executionId, store = this.store()) {
    const row = this.row(executionId, store);
    return row ? executionRow(row, this.history(executionId, store)) : null;
  }

  appendEvent(store, input = {}) {
    const executionId = clean(input.executionId);
    const sequence = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM durable_execution_events WHERE execution_id=?').get(executionId)?.next || 1);
    const eventId = clean(input.eventId) || this.idFactory('execution-event');
    const at = clean(input.createdAt) || this.clock();
    store.db.prepare(`
      INSERT INTO durable_execution_events(
        event_id,execution_id,sequence,event_type,from_state,to_state,generation,owner_id,reason_code,payload_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      eventId,
      executionId,
      sequence,
      clean(input.eventType) || 'transition',
      clean(input.fromState),
      clean(input.toState),
      Number(input.generation || 0),
      clean(input.ownerId),
      clean(input.reasonCode),
      JSON.stringify(sanitize(input.payload || {}) || {}),
      at
    );
    return eventRow(store.db.prepare('SELECT * FROM durable_execution_events WHERE event_id=?').get(eventId));
  }

  createExecution(input = {}) {
    const operationKind = clean(input.operationKind);
    const idempotencyKey = clean(input.idempotencyKey);
    if (!operationKind) throw Object.assign(new Error('Durable execution operation kind is required'), { code: 'DURABLE_EXECUTION_OPERATION_REQUIRED', status: 400 });
    if (!idempotencyKey) throw Object.assign(new Error('Durable execution idempotency key is required'), { code: 'DURABLE_EXECUTION_IDEMPOTENCY_REQUIRED', status: 400 });
    const store = this.store();
    return store.transaction(() => {
      const existing = store.db.prepare('SELECT * FROM durable_executions WHERE operation_kind=? AND idempotency_key=?').get(operationKind, idempotencyKey);
      if (existing) return this.get(existing.execution_id, store);
      const executionId = clean(input.executionId) || this.idFactory('execution');
      const at = this.clock();
      store.db.prepare(`
        INSERT INTO durable_executions(
          execution_id,trace_id,operation_kind,idempotency_key,state,generation,owner_id,lease_sequence,last_heartbeat_at,
          cancellation_requested_at,cancellation_actor,retry_count,max_attempts,next_attempt_at,failure_code,metadata_json,
          created_at,updated_at,completed_at
        ) VALUES(?,?,?,?,?,0,'',0,'','','',0,?,'','',?,?,?,'')
      `).run(
        executionId,
        clean(input.traceId),
        operationKind,
        idempotencyKey,
        STATES.CREATED,
        boundedAttempts(input.maxAttempts),
        JSON.stringify(sanitize(input.metadata || {}) || {}),
        at,
        at
      );
      this.appendEvent(store, {
        executionId,
        eventType: 'created',
        fromState: '',
        toState: STATES.CREATED,
        generation: 0,
        payload: { operationKind }
      });
      return this.get(executionId, store);
    });
  }

  assertGeneration(row, received) {
    const actual = Number(row.generation || 0);
    const expected = Number(received);
    if (!Number.isInteger(expected) || expected !== actual) {
      throw Object.assign(new Error('Durable execution stale generation rejected'), {
        code: 'DURABLE_EXECUTION_STALE_GENERATION', status: 409,
        executionId: clean(row.execution_id), expectedGeneration: actual, receivedGeneration: Number.isFinite(expected) ? expected : null
      });
    }
  }
  assertOwner(row, ownerId) {
    const current = clean(row.owner_id);
    const received = clean(ownerId);
    if (current && current !== received) {
      throw Object.assign(new Error('Durable execution owner mismatch'), {
        code: 'DURABLE_EXECUTION_OWNER_MISMATCH', status: 409,
        executionId: clean(row.execution_id), expectedOwnerId: current, receivedOwnerId: received
      });
    }
  }
  assertState(row, allowed, target) {
    if (!allowed.includes(clean(row.state))) {
      throw Object.assign(new Error(`Invalid durable execution transition ${clean(row.state)} -> ${target}`), {
        code: 'DURABLE_EXECUTION_TRANSITION_INVALID', status: 409,
        executionId: clean(row.execution_id), fromState: clean(row.state), toState: target
      });
    }
  }

  transition(input = {}) {
    const executionId = clean(input.executionId);
    const store = this.store();
    return store.transaction(() => {
      const row = this.row(executionId, store);
      if (!row) throw Object.assign(new Error('Durable execution not found'), { code: 'DURABLE_EXECUTION_NOT_FOUND', status: 404, executionId });
      this.assertState(row, input.allowedStates || [], input.targetState);
      if (input.expectedGeneration !== undefined) this.assertGeneration(row, input.expectedGeneration);
      if (input.requireOwner) this.assertOwner(row, input.ownerId);
      const fromState = clean(row.state);
      const generation = input.incrementGeneration ? Number(row.generation || 0) + 1 : Number(row.generation || 0);
      const ownerId = input.clearOwner ? '' : (input.ownerId !== undefined ? clean(input.ownerId) : clean(row.owner_id));
      const leaseSequence = input.incrementLease ? Number(row.lease_sequence || 0) + 1 : Number(row.lease_sequence || 0);
      const at = this.clock();
      const targetState = clean(input.targetState);
      const completedAt = TERMINAL.has(targetState) ? at : '';
      const retryCount = input.retryCount !== undefined ? Number(input.retryCount) : Number(row.retry_count || 0);
      const nextAttemptAt = input.nextAttemptAt !== undefined ? clean(input.nextAttemptAt) : clean(row.next_attempt_at);
      const failureCode = input.failureCode !== undefined ? clean(input.failureCode) : clean(row.failure_code);
      const cancellationRequestedAt = input.cancellationRequestedAt !== undefined ? clean(input.cancellationRequestedAt) : clean(row.cancellation_requested_at);
      const cancellationActor = input.cancellationActor !== undefined ? clean(input.cancellationActor) : clean(row.cancellation_actor);
      const heartbeatAt = input.heartbeat ? at : clean(row.last_heartbeat_at);
      store.db.prepare(`
        UPDATE durable_executions SET
          state=?,generation=?,owner_id=?,lease_sequence=?,last_heartbeat_at=?,
          cancellation_requested_at=?,cancellation_actor=?,retry_count=?,next_attempt_at=?,failure_code=?,
          updated_at=?,completed_at=?
        WHERE execution_id=?
      `).run(
        targetState,
        generation,
        ownerId,
        leaseSequence,
        heartbeatAt,
        cancellationRequestedAt,
        cancellationActor,
        retryCount,
        nextAttemptAt,
        failureCode,
        at,
        completedAt,
        executionId
      );
      this.appendEvent(store, {
        executionId,
        eventType: clean(input.eventType) || 'transition',
        fromState,
        toState: targetState,
        generation,
        ownerId,
        reasonCode: clean(input.reasonCode),
        payload: input.payload || {},
        createdAt: at
      });
      return this.get(executionId, store);
    });
  }

  schedule(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.CREATED],
      targetState: STATES.SCHEDULED,
      expectedGeneration: input.expectedGeneration,
      eventType: 'scheduled',
      reasonCode: input.reasonCode,
      payload: { operationKind: input.operationKind }
    });
  }

  claim(input = {}) {
    const ownerId = clean(input.ownerId);
    if (!ownerId) throw Object.assign(new Error('Durable execution owner is required'), { code: 'DURABLE_EXECUTION_OWNER_REQUIRED', status: 400 });
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.SCHEDULED, STATES.RETRY_SCHEDULED],
      targetState: STATES.RUNNING,
      expectedGeneration: input.expectedGeneration,
      incrementGeneration: true,
      ownerId,
      heartbeat: true,
      eventType: 'claimed',
      reasonCode: input.reasonCode,
      nextAttemptAt: '',
      failureCode: ''
    });
  }

  heartbeat(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.RUNNING, STATES.WAITING_REMOTE],
      targetState: this.row(input.executionId)?.state,
      expectedGeneration: input.generation,
      requireOwner: true,
      ownerId: input.ownerId,
      incrementLease: true,
      heartbeat: true,
      eventType: 'heartbeat',
      reasonCode: input.reasonCode,
      payload: input.progress || {}
    });
  }

  waitRemote(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.RUNNING],
      targetState: STATES.WAITING_REMOTE,
      expectedGeneration: input.generation,
      requireOwner: true,
      ownerId: input.ownerId,
      heartbeat: true,
      eventType: 'waiting-remote',
      reasonCode: input.reasonCode,
      payload: input.progress || {}
    });
  }

  succeed(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.RUNNING, STATES.WAITING_REMOTE],
      targetState: STATES.SUCCEEDED,
      expectedGeneration: input.generation,
      requireOwner: true,
      ownerId: input.ownerId,
      eventType: 'succeeded',
      reasonCode: input.reasonCode,
      payload: { receiptId: clean(input.receiptId), providerRequestId: clean(input.providerRequestId) }
    });
  }

  fail(input = {}) {
    const store = this.store();
    const row = this.row(input.executionId, store);
    if (!row) throw Object.assign(new Error('Durable execution not found'), { code: 'DURABLE_EXECUTION_NOT_FOUND', status: 404, executionId: clean(input.executionId) });
    this.assertGeneration(row, input.generation);
    this.assertOwner(row, input.ownerId);
    this.assertState(row, [STATES.RUNNING, STATES.WAITING_REMOTE], 'failure');
    const retryCount = Number(row.retry_count || 0) + 1;
    const retryable = input.retryable === true;
    const targetState = retryable
      ? (retryCount >= Number(row.max_attempts || 1) ? STATES.DEAD_LETTERED : STATES.RETRY_SCHEDULED)
      : STATES.FAILED;
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.RUNNING, STATES.WAITING_REMOTE],
      targetState,
      expectedGeneration: input.generation,
      requireOwner: true,
      ownerId: input.ownerId,
      clearOwner: targetState === STATES.RETRY_SCHEDULED || targetState === STATES.DEAD_LETTERED || targetState === STATES.FAILED,
      retryCount,
      nextAttemptAt: targetState === STATES.RETRY_SCHEDULED ? clean(input.nextAttemptAt) : '',
      failureCode: clean(input.reasonCode || input.failureCode),
      eventType: targetState === STATES.RETRY_SCHEDULED ? 'retry-scheduled' : (targetState === STATES.DEAD_LETTERED ? 'dead-lettered' : 'failed'),
      reasonCode: input.reasonCode || input.failureCode,
      payload: { retryable, nextAttemptAt: clean(input.nextAttemptAt), attempt: retryCount }
    });
  }

  requestCancel(input = {}) {
    const at = this.clock();
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.CREATED, STATES.SCHEDULED, STATES.RUNNING, STATES.WAITING_REMOTE, STATES.RETRY_SCHEDULED],
      targetState: STATES.CANCEL_REQUESTED,
      expectedGeneration: input.generation,
      requireOwner: Boolean(clean(this.row(input.executionId)?.owner_id)),
      ownerId: input.ownerId,
      cancellationRequestedAt: at,
      cancellationActor: clean(input.actor),
      eventType: 'cancel-requested',
      reasonCode: input.reasonCode,
      payload: { status: 'cancel-requested' }
    });
  }

  acknowledgeCancel(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.CANCEL_REQUESTED],
      targetState: STATES.CANCELLED,
      expectedGeneration: input.generation,
      requireOwner: Boolean(clean(this.row(input.executionId)?.owner_id)),
      ownerId: input.ownerId,
      clearOwner: true,
      eventType: 'cancelled',
      reasonCode: input.reasonCode,
      payload: { status: 'cancelled' }
    });
  }

  retry(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.FAILED],
      targetState: STATES.RETRY_SCHEDULED,
      expectedGeneration: input.expectedGeneration,
      clearOwner: true,
      nextAttemptAt: clean(input.nextAttemptAt),
      eventType: 'retry-scheduled',
      reasonCode: input.reasonCode,
      payload: { nextAttemptAt: clean(input.nextAttemptAt) }
    });
  }

  deadLetter(input = {}) {
    return this.transition({
      executionId: input.executionId,
      allowedStates: [STATES.CREATED, STATES.SCHEDULED, STATES.RUNNING, STATES.WAITING_REMOTE, STATES.RETRY_SCHEDULED, STATES.CANCEL_REQUESTED, STATES.FAILED],
      targetState: STATES.DEAD_LETTERED,
      expectedGeneration: input.expectedGeneration,
      ownerId: input.ownerId,
      requireOwner: Boolean(clean(this.row(input.executionId)?.owner_id)),
      clearOwner: true,
      failureCode: clean(input.reasonCode || input.failureCode),
      eventType: 'dead-lettered',
      reasonCode: input.reasonCode || input.failureCode,
      payload: { status: 'dead-lettered' }
    });
  }

  listActive(limit = 100) {
    const store = this.store();
    const bounded = Math.max(1, Math.min(1000, Number(limit || 100)));
    const placeholders = [STATES.CREATED, STATES.SCHEDULED, STATES.RUNNING, STATES.WAITING_REMOTE, STATES.RETRY_SCHEDULED, STATES.CANCEL_REQUESTED].map(() => '?').join(',');
    return store.db.prepare(`SELECT * FROM durable_executions WHERE state IN (${placeholders}) ORDER BY updated_at ASC LIMIT ?`)
      .all(STATES.CREATED, STATES.SCHEDULED, STATES.RUNNING, STATES.WAITING_REMOTE, STATES.RETRY_SCHEDULED, STATES.CANCEL_REQUESTED, bounded)
      .map(row => executionRow(row, this.history(row.execution_id, store)));
  }
}

const durableExecutionAuthority = new DurableExecutionAuthority();
module.exports = durableExecutionAuthority;
module.exports.DurableExecutionAuthority = DurableExecutionAuthority;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.STATES = STATES;
