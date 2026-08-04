'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  acquireAuthorityWriteHost
} = require('../../../backend/services/authorityWriteHost');
const {
  SqliteConnectionBroker
} = require('../../../backend/lib/sqliteConnectionBroker');
const {
  DurableExecutionAuthority
} = require('../../../backend/services/durableExecutionAuthority');
const {
  DurableExecutionRecoveryAuthority
} = require('../../../backend/services/durableExecutionRecoveryAuthority');
const {
  ExternalActionOutboxAuthority
} = require('../../../backend/services/externalActionOutboxAuthorityCore');
const {
  ExternalActionDispatcher
} = require('../../../backend/services/externalActionDispatcher');
const { canonicalHash, canonicalSerialize } = require('../../../backend/services/canonicalSerialization');

function clean(value) { return String(value == null ? '' : value).trim(); }
function send(payload) { if (typeof process.send === 'function') process.send(payload); }
function errorPayload(error) {
  return {
    code: clean(error?.code) || 'WP_B_DISPATCHER_FIXTURE_FAILED',
    message: clean(error?.message || error),
    remoteOutcomeUnknown: error?.remoteOutcomeUnknown === true,
    retryable: error?.retryable === true
  };
}
function parsedOptions() {
  try { return JSON.parse(String(process.argv[4] || '{}')); } catch (_) { return {}; }
}

const dbPath = path.resolve(process.argv[2] || 'wp-b-dispatcher.db');
const instanceId = clean(process.argv[3]) || `wp-b-dispatcher-${process.pid}`;
const processOptions = parsedOptions();
const clockOffsetMs = Number(processOptions.clockOffsetMs || 0);
const hostClock = () => Date.now() + clockOffsetMs;
let host;
let broker;
let store;
let executionAuthority;
let recoveryAuthority;
let outboxAuthority;
let context = null;
let timestampSequence = 0;
const pendingParentRequests = new Map();
const pendingFaultContinues = new Map();

function timestamp(input) {
  if (clean(input)) return new Date(Date.parse(clean(input))).toISOString();
  const value = new Date(Date.parse('2026-08-04T03:00:00.000Z') + clockOffsetMs + (timestampSequence * 1000)).toISOString();
  timestampSequence += 1;
  return value;
}

function parentRequest(type, payload = {}) {
  const correlationId = `${type}-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingParentRequests.delete(correlationId);
      reject(Object.assign(new Error('parent request timed out'), { code: 'WP_B_PARENT_REQUEST_TIMEOUT' }));
    }, 15_000);
    timer.unref?.();
    pendingParentRequests.set(correlationId, { resolve, reject, timer });
    send({ type, correlationId, ...payload });
  });
}

function faultBarrier(faultPoint) {
  const barrierId = `fault-${crypto.randomUUID()}`;
  return new Promise(resolve => {
    pendingFaultContinues.set(barrierId, resolve);
    send({ type: 'fault-point', faultPoint, barrierId, processId: process.pid });
  });
}

function initialize() {
  host = acquireAuthorityWriteHost({
    dbPath,
    instanceId,
    ownershipPid: process.pid,
    ownershipProcessIdentity: `wp-b-dispatcher-process:${process.pid}`,
    ownershipPidAlive: processOptions.forceTakeover === true ? (() => false) : undefined,
    ownershipStaleMs: Math.max(1000, Number(processOptions.ownershipStaleMs || 30_000)),
    clock: hostClock
  });
  broker = new SqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: host.capability,
    storeOptions: { authorityHeartbeatMs: 250 }
  });
  store = broker.open();
  executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  outboxAuthority = new ExternalActionOutboxAuthority({ storeProvider: () => store });
  recoveryAuthority = new DurableExecutionRecoveryAuthority({
    storeProvider: () => store,
    authorityWriteHostCapability: host.capability,
    clock: () => timestamp()
  });
}

function prepare(input = {}) {
  const token = host.tokenSnapshot();
  const suffix = clean(input.suffix) || crypto.randomUUID();
  const executionId = clean(input.executionId) || `fault-execution-${suffix}`;
  const intentId = clean(input.intentId) || `fault-intent-${suffix}`;
  const claimId = clean(input.claimId) || `fault-claim-${suffix}`;
  const idempotencyKey = clean(input.idempotencyKey) || `fault-idempotency-${suffix}`;
  const deadlineAt = clean(input.deadlineAt) || '2026-08-04T04:00:00.000Z';
  executionAuthority.createExecution({
    executionId,
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: `execution:${idempotencyKey}`,
    traceId: `trace:${suffix}`,
    command: { destinationReference: `destination:${suffix}`, contentReference: `content:${suffix}` },
    metadata: { platform: 'fault-matrix' },
    maxAttempts: 3,
    deadlineAt,
    authorityTimestamp: timestamp(input.authorityTimestamp)
  });
  const intent = outboxAuthority.createIntent({
    intentId,
    executionId,
    actionKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey,
    payload: { destinationReference: `destination:${suffix}`, contentReference: `content:${suffix}` },
    authorityTimestamp: timestamp()
  });
  let claimed = intent;
  if (input.claimIntent !== false) {
    const leaseStartedAt = timestamp(input.leaseStartedAt);
    const leaseExpiresAt = clean(input.leaseExpiresAt) || '2026-08-04T03:59:00.000Z';
    claimed = outboxAuthority.claimIntent({
      intentId,
      ownerId: token.instanceId,
      hostId: token.instanceId,
      claimId,
      stateVersion: intent.stateVersion,
      generation: intent.generation,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      leaseStartedAt,
      leaseExpiresAt
    });
  }
  context = Object.freeze({
    executionId,
    intentId,
    idempotencyKey,
    ownerId: input.claimIntent === false ? '' : token.instanceId,
    hostId: token.instanceId,
    claimId: input.claimIntent === false ? '' : claimId,
    stateVersion: claimed.stateVersion,
    generation: claimed.generation,
    hostGeneration: input.claimIntent === false ? 0 : token.hostGeneration,
    fencingToken: input.claimIntent === false ? 0 : token.fencingToken,
    leaseExpiresAt: claimed.leaseExpiresAt || ''
  });
  return Object.freeze({ processId: process.pid, ...context });
}

function inspect(input = {}) {
  const intentId = clean(input.intentId || context?.intentId);
  const executionId = clean(input.executionId || context?.executionId);
  const claim = intentId
    ? store.db.prepare('SELECT * FROM external_action_claims WHERE intent_id=?').get(intentId)
    : null;
  const attempt = intentId
    ? store.db.prepare('SELECT * FROM external_action_attempts WHERE intent_id=? ORDER BY attempt_sequence DESC LIMIT 1').get(intentId)
    : null;
  const execution = executionId
    ? store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(executionId)
    : null;
  return Object.freeze({
    processId: process.pid,
    executionId,
    intentId,
    attemptId: clean(attempt?.attempt_id),
    claimId: clean(claim?.claim_id || input.claimId),
    generation: Number(claim?.generation || execution?.generation || input.generation || 0),
    hostGeneration: Number(claim?.host_generation || execution?.host_generation || input.hostGeneration || 0),
    fencingToken: Number(claim?.fencing_token || execution?.fencing_token || input.fencingToken || 0),
    attemptCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_action_attempts WHERE intent_id=?').get(intentId).count || 0) : 0,
    receiptCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_action_receipts WHERE intent_id=?').get(intentId).count || 0) : 0,
    reconciliationCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_outcome_reconciliations WHERE intent_id=?').get(intentId).count || 0) : 0,
    checkpointCount: executionId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM durable_execution_checkpoints WHERE execution_id=?').get(executionId).count || 0) : 0,
    finalState: clean(execution?.state || claim?.state),
    claimState: clean(claim?.state),
    executionStateVersion: Number(execution?.state_version || 0)
  });
}

function startAttemptOnly(input = {}) {
  const facts = Object.freeze({ ...(context || {}), ...(input.context || {}) });
  const attempt = outboxAuthority.startAttempt({
    ...facts,
    attemptId: clean(input.attemptId) || `fault-attempt-${crypto.randomUUID()}`,
    request: { destinationReference: 'destination:fixture', contentReference: 'content:fixture' },
    authorityTimestamp: timestamp(input.authorityTimestamp)
  });
  context = Object.freeze({ ...facts, stateVersion: attempt.stateVersion, attemptId: attempt.attemptId });
  return attempt;
}

async function dispatch(input = {}) {
  const dispatchContext = Object.freeze({ ...(context || {}), ...(input.context || {}) });
  if (!dispatchContext.intentId) throw Object.assign(new Error('dispatcher context required'), { code: 'WP_B_DISPATCHER_CONTEXT_REQUIRED' });
  const faultPoint = clean(input.faultPoint);
  const remoteBehavior = clean(input.remoteBehavior || 'SUCCESS');
  const remoteDelayMs = Math.max(0, Math.min(5000, Number(input.remoteDelayMs || 0)));
  const adapter = Object.freeze({
    async perform(envelope) {
      if (faultPoint === 'AFTER_ATTEMPT_BEFORE_CALL') await faultBarrier(faultPoint);
      const remote = await parentRequest('remote-perform', {
        idempotencyKey: envelope.idempotencyKey,
        requestId: envelope.attemptId,
        behavior: remoteBehavior,
        delayMs: remoteDelayMs,
        authorityTimestamp: timestamp()
      });
      if (!remote.ok) {
        throw Object.assign(new Error(remote.error?.code || 'REMOTE_CALL_FAILED'), remote.error || {});
      }
      if (faultPoint === 'AFTER_REMOTE_SUCCESS_BEFORE_RECEIPT') await faultBarrier(faultPoint);
      return Object.freeze({
        providerReceiptId: clean(remote.result?.providerReceiptId),
        evidenceReference: `fake-remote:${clean(remote.result?.requestId)}`,
        result: { status: 'accepted', receiptId: clean(remote.result?.providerReceiptId) }
      });
    }
  });
  const externalActionDispatcher = new ExternalActionDispatcher({
    outboxAuthority,
    adapter,
    issueTimestamp: timestamp
  });
  return externalActionDispatcher.dispatch({
    ...dispatchContext,
    request: { destinationReference: 'destination:fixture', contentReference: 'content:fixture' }
  });
}

function releaseStartupClaim() {
  return Object.freeze({ released: host.releaseStartupClaimForTests(), token: host.tokenSnapshot() });
}

function reclaim(input = {}) {
  const expired = Object.freeze({ ...(input.context || context || {}) });
  const token = host.tokenSnapshot();
  const reclaimed = outboxAuthority.reclaimExpiredClaim({
    intentId: expired.intentId,
    stateVersion: expired.stateVersion,
    generation: expired.generation,
    expiredOwnerId: expired.ownerId,
    expiredClaimId: expired.claimId,
    expiredHostGeneration: expired.hostGeneration,
    expiredFencingToken: expired.fencingToken,
    hostId: token.instanceId,
    hostGeneration: token.hostGeneration,
    fencingToken: token.fencingToken,
    authorityTimestamp: timestamp(input.authorityTimestamp || '2026-08-04T03:30:00.000Z')
  });
  context = Object.freeze({
    ...expired,
    ownerId: '',
    claimId: '',
    stateVersion: reclaimed.stateVersion,
    generation: reclaimed.generation,
    hostGeneration: 0,
    fencingToken: 0,
    leaseExpiresAt: ''
  });
  return reclaimed;
}

function seedExecutionState(input = {}) {
  const executionId = clean(input.executionId || context?.executionId);
  const targetState = clean(input.state);
  const authorityTimestamp = timestamp(input.authorityTimestamp);
  if (!executionId || !targetState) throw Object.assign(new Error('execution state seed requires identity and state'), { code: 'WP_B_FIXTURE_STATE_REQUIRED' });
  return store.transaction(() => {
    const current = store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(executionId);
    if (!current) throw Object.assign(new Error('execution missing'), { code: 'WP_B_FIXTURE_EXECUTION_NOT_FOUND' });
    const withOwnership = input.withOwnership === true;
    const token = host.tokenSnapshot();
    const ownerId = withOwnership ? token.instanceId : '';
    const claimId = withOwnership ? (clean(input.claimId) || `execution-claim-${crypto.randomUUID()}`) : '';
    const hostGeneration = withOwnership ? token.hostGeneration : 0;
    const fencingToken = withOwnership ? token.fencingToken : 0;
    const leaseExpiresAt = withOwnership ? (clean(input.leaseExpiresAt) || '2026-08-04T03:59:00.000Z') : '';
    store.db.prepare(`UPDATE durable_executions SET
      state=?,state_version=state_version+1,generation=generation+1,
      owner_id=?,claim_id=?,host_generation=?,fencing_token=?,
      lease_started_at=?,lease_expires_at=?,deadline_at=?,next_attempt_at=?,updated_at=?
      WHERE execution_id=?`).run(
      targetState,
      ownerId,
      claimId,
      hostGeneration,
      fencingToken,
      withOwnership ? authorityTimestamp : '',
      leaseExpiresAt,
      clean(input.deadlineAt) || clean(current.deadline_at),
      clean(input.nextAttemptAt),
      authorityTimestamp,
      executionId
    );
    const sequence = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM durable_execution_events WHERE execution_id=?').get(executionId)?.next || 1);
    store.db.prepare(`INSERT INTO durable_execution_events(
      event_id,execution_id,sequence,event_type,from_state,to_state,generation,
      owner_id,reason_code,payload_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      `fixture-state-event-${crypto.randomUUID()}`,
      executionId,
      sequence,
      'fault-matrix-state-seed',
      clean(current.state),
      targetState,
      Number(current.generation || 0) + 1,
      ownerId,
      'PROCESS_FAULT_MATRIX',
      '{}',
      authorityTimestamp
    );
    return inspect({ executionId, intentId: clean(input.intentId || context?.intentId) });
  });
}

function recoverExecution(input = {}) {
  return recoveryAuthority.recoverExecution(
    clean(input.executionId || context?.executionId),
    { authorityTimestamp: timestamp(input.authorityTimestamp) }
  );
}

function recordReconciliation(input = {}) {
  const facts = Object.freeze({ ...(context || {}), ...(input.context || {}) });
  const attemptId = clean(input.attemptId || facts.attemptId || inspect(facts).attemptId);
  const outcome = clean(input.outcome);
  const authorityTimestamp = timestamp(input.authorityTimestamp);
  const remoteReceiptId = clean(input.remoteReceiptId);
  const reconciliation = outboxAuthority.recordReconciliation({
    intentId: facts.intentId,
    attemptId,
    observationOutcome: outcome,
    evidenceReference: clean(input.evidenceReference) || `fault-matrix:${outcome.toLowerCase()}`,
    remoteReceiptId,
    observation: { provider: 'fake-remote', status: clean(input.status || outcome) },
    observedAt: authorityTimestamp,
    authorityTimestamp
  });
  let receipt = null;
  if (input.recordLateResult === true) {
    receipt = outboxAuthority.recordLateResult({
      intentId: facts.intentId,
      attemptId,
      providerReceiptId: remoteReceiptId,
      evidenceReference: `fault-matrix:late-result:${clean(reconciliation.reconciliationId)}`,
      result: { status: 'accepted', receiptId: remoteReceiptId },
      authorityTimestamp: timestamp()
    });
  }
  return Object.freeze({ reconciliation, receipt });
}

function appendCheckpoints(input = {}) {
  const executionId = clean(input.executionId || context?.executionId);
  const count = Math.max(1, Math.min(20, Number(input.count || 1)));
  return store.transaction(() => {
    const execution = store.db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get(executionId);
    if (!execution) throw Object.assign(new Error('execution missing'), { code: 'WP_B_FIXTURE_EXECUTION_NOT_FOUND' });
    let sequence = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0) AS current FROM durable_execution_checkpoints WHERE execution_id=?').get(executionId)?.current || 0);
    for (let index = 0; index < count; index += 1) {
      sequence += 1;
      const authorityTimestamp = timestamp();
      const snapshot = {
        executionId,
        sequence,
        state: clean(execution.state),
        stateVersion: Number(execution.state_version || 0),
        generation: Number(execution.generation || 0)
      };
      const encoded = canonicalSerialize(snapshot);
      store.db.prepare(`INSERT INTO durable_execution_checkpoints(
        checkpoint_id,execution_id,sequence,state,state_version,generation,
        owner_id,claim_id,host_generation,fencing_token,snapshot_json,snapshot_sha256,
        authority_timestamp,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        `fault-checkpoint-${crypto.randomUUID()}`,
        executionId,
        sequence,
        snapshot.state,
        snapshot.stateVersion,
        snapshot.generation,
        clean(execution.owner_id),
        clean(execution.claim_id),
        Number(execution.host_generation || 0),
        Number(execution.fencing_token || 0),
        encoded,
        canonicalHash(snapshot),
        authorityTimestamp,
        authorityTimestamp
      );
    }
    return Object.freeze({ executionId, checkpointCount: sequence });
  });
}

async function handle(message = {}) {
  const correlationId = clean(message.correlationId);
  try {
    let result;
    if (message.type === 'prepare') result = prepare(message);
    else if (message.type === 'start-attempt') result = startAttemptOnly(message);
    else if (message.type === 'dispatch') result = await dispatch(message);
    else if (message.type === 'inspect') result = inspect(message);
    else if (message.type === 'release-startup-claim') result = releaseStartupClaim();
    else if (message.type === 'reclaim') result = reclaim(message);
    else if (message.type === 'seed-execution-state') result = seedExecutionState(message);
    else if (message.type === 'recover-execution') result = recoverExecution(message);
    else if (message.type === 'record-reconciliation') result = recordReconciliation(message);
    else if (message.type === 'append-checkpoints') result = appendCheckpoints(message);
    else if (message.type === 'token') result = Object.freeze({ processId: process.pid, ...host.tokenSnapshot() });
    else if (message.type === 'continue') {
      const resolve = pendingFaultContinues.get(clean(message.barrierId));
      if (resolve) { pendingFaultContinues.delete(clean(message.barrierId)); resolve(true); }
      result = { continued: Boolean(resolve) };
    } else if (message.type === 'shutdown') {
      result = { closed: true, processId: process.pid };
      send({ type: 'response', correlationId, ok: true, result });
      try { broker?.close(); } catch (_) {}
      try { host?.close(); } catch (_) {}
      process.disconnect?.();
      return;
    } else throw Object.assign(new Error('invalid dispatcher command'), { code: 'WP_B_DISPATCHER_COMMAND_INVALID' });
    send({ type: 'response', correlationId, ok: true, result });
  } catch (error) {
    send({ type: 'response', correlationId, ok: false, error: errorPayload(error) });
  }
}

process.on('message', message => {
  if (message?.type === 'parent-response') {
    const pending = pendingParentRequests.get(clean(message.correlationId));
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingParentRequests.delete(clean(message.correlationId));
    pending.resolve(message);
    return;
  }
  handle(message).catch(error => send({ type: 'fatal', processId: process.pid, error: errorPayload(error) }));
});
process.on('disconnect', () => { try { broker?.close(); } catch (_) {} try { host?.close(); } catch (_) {} process.exit(0); });

try {
  initialize();
  send({
    type: 'ready',
    processId: process.pid,
    dbPath,
    instanceId,
    authority: 'AuthorityWriteHost',
    store: 'r32SqliteStore',
    token: host.tokenSnapshot()
  });
} catch (error) {
  send({ type: 'fatal', processId: process.pid, error: errorPayload(error) });
  setTimeout(() => process.exit(1), 10).unref?.();
}

module.exports = Object.freeze({ inspect, prepare });
