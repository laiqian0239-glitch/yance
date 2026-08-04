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
  ExternalActionOutboxAuthority
} = require('../../../backend/services/externalActionOutboxAuthorityCore');
const {
  ExternalActionDispatcher
} = require('../../../backend/services/externalActionDispatcher');

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

const dbPath = path.resolve(process.argv[2] || 'wp-b-dispatcher.db');
const instanceId = clean(process.argv[3]) || `wp-b-dispatcher-${process.pid}`;
let host;
let broker;
let store;
let executionAuthority;
let outboxAuthority;
let context = null;
let timestampSequence = 0;
const pendingParentRequests = new Map();
const pendingFaultContinues = new Map();

function timestamp() {
  const value = new Date(Date.parse('2026-08-04T03:00:00.000Z') + (timestampSequence * 1000)).toISOString();
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
    ownershipProcessIdentity: `wp-b-dispatcher-process:${process.pid}`
  });
  broker = new SqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: host.capability,
    storeOptions: { authorityHeartbeatMs: 250 }
  });
  store = broker.open();
  executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  outboxAuthority = new ExternalActionOutboxAuthority({ storeProvider: () => store });
}

function prepare(input = {}) {
  const token = host.tokenSnapshot();
  const suffix = clean(input.suffix) || crypto.randomUUID();
  const executionId = clean(input.executionId) || `fault-execution-${suffix}`;
  const intentId = clean(input.intentId) || `fault-intent-${suffix}`;
  const claimId = clean(input.claimId) || `fault-claim-${suffix}`;
  const idempotencyKey = clean(input.idempotencyKey) || `fault-idempotency-${suffix}`;
  executionAuthority.createExecution({
    executionId,
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: `execution:${idempotencyKey}`,
    traceId: `trace:${suffix}`,
    command: { destinationReference: `destination:${suffix}`, contentReference: `content:${suffix}` },
    metadata: { platform: 'fault-matrix' },
    maxAttempts: 3,
    deadlineAt: '2026-08-04T04:00:00.000Z',
    authorityTimestamp: timestamp()
  });
  const intent = outboxAuthority.createIntent({
    intentId,
    executionId,
    actionKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey,
    payload: { destinationReference: `destination:${suffix}`, contentReference: `content:${suffix}` },
    authorityTimestamp: timestamp()
  });
  const claimed = outboxAuthority.claimIntent({
    intentId,
    ownerId: token.instanceId,
    hostId: token.instanceId,
    claimId,
    stateVersion: intent.stateVersion,
    generation: intent.generation,
    hostGeneration: token.hostGeneration,
    fencingToken: token.fencingToken,
    leaseStartedAt: timestamp(),
    leaseExpiresAt: '2026-08-04T03:59:00.000Z'
  });
  context = Object.freeze({
    executionId,
    intentId,
    idempotencyKey,
    ownerId: token.instanceId,
    hostId: token.instanceId,
    claimId,
    stateVersion: claimed.stateVersion,
    generation: claimed.generation,
    hostGeneration: token.hostGeneration,
    fencingToken: token.fencingToken,
    leaseExpiresAt: claimed.leaseExpiresAt
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
    ? store.db.prepare(`SELECT * FROM external_action_attempts WHERE intent_id=? ORDER BY attempt_sequence DESC LIMIT 1`).get(intentId)
    : null;
  return Object.freeze({
    processId: process.pid,
    executionId,
    intentId,
    attemptId: clean(attempt?.attempt_id),
    claimId: clean(claim?.claim_id || input.claimId),
    generation: Number(claim?.generation || input.generation || 0),
    hostGeneration: Number(claim?.host_generation || input.hostGeneration || 0),
    fencingToken: Number(claim?.fencing_token || input.fencingToken || 0),
    attemptCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_action_attempts WHERE intent_id=?').get(intentId).count || 0) : 0,
    receiptCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_action_receipts WHERE intent_id=?').get(intentId).count || 0) : 0,
    reconciliationCount: intentId ? Number(store.db.prepare('SELECT COUNT(*) AS count FROM external_outcome_reconciliations WHERE intent_id=?').get(intentId).count || 0) : 0,
    finalState: clean(claim?.state || store.db.prepare('SELECT state FROM durable_executions WHERE execution_id=?').get(executionId)?.state)
  });
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

async function handle(message = {}) {
  const correlationId = clean(message.correlationId);
  try {
    let result;
    if (message.type === 'prepare') result = prepare(message);
    else if (message.type === 'dispatch') result = await dispatch(message);
    else if (message.type === 'inspect') result = inspect(message);
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
  send({ type: 'ready', processId: process.pid, dbPath, instanceId, authority: 'AuthorityWriteHost', store: 'r32SqliteStore' });
} catch (error) {
  send({ type: 'fatal', processId: process.pid, error: errorPayload(error) });
  setTimeout(() => process.exit(1), 10).unref?.();
}

module.exports = Object.freeze({ inspect, prepare });
