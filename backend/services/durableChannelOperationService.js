'use strict';

const crypto = require('node:crypto');
const durableExecutionAuthority = require('./durableExecutionAuthority');
const evidenceAuthority = require('./evidenceAuthority');

const AUTHORITY = 'DurableChannelOperationService';
const SCHEMA_VERSION = 1;
const OPERATION_KINDS = Object.freeze(['channel-history-sync', 'media-fetch', 'message-delivery', 'delivery-reconcile']);
const TERMINAL = new Set(['CANCELLED', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function defaultClock() { return new Date().toISOString(); }
function requireKind(value) {
  const kind = clean(value);
  if (!OPERATION_KINDS.includes(kind)) throw Object.assign(new Error(`Unsupported durable channel operation: ${kind || 'unknown'}`), { code: 'DURABLE_CHANNEL_OPERATION_UNSUPPORTED', status: 400, operationKind: kind });
  return kind;
}

class DurableChannelOperationService {
  constructor({ durableExecutionAuthority: durable = durableExecutionAuthority, evidenceAuthority: evidence = evidenceAuthority, idFactory = defaultIdFactory, clock = defaultClock } = {}) {
    this.durable = durable;
    this.evidence = evidence;
    this.idFactory = idFactory;
    this.clock = clock;
    this.handlers = new Map();
  }

  registerHandler(operationKind, handler) {
    const kind = requireKind(operationKind);
    if (typeof handler !== 'function') throw Object.assign(new Error('Durable channel handler must be a function'), { code: 'DURABLE_CHANNEL_HANDLER_REQUIRED', status: 400, operationKind: kind });
    this.handlers.set(kind, handler);
    return this;
  }

  enqueue(input = {}) {
    const operationKind = requireKind(input.operationKind);
    const traceId = clean(input.traceId) || this.idFactory('channel-trace');
    this.evidence.startTrace({ traceId, traceType: 'channel-operation', task: operationKind, executionMode: 'durable', platform: input.metadata?.platform, status: 'queued' });
    let execution = this.durable.createExecution({
      executionId: clean(input.executionId), traceId, operationKind, idempotencyKey: clean(input.idempotencyKey),
      maxAttempts: input.maxAttempts, metadata: { ...(input.metadata || {}), operationKind, traceId }
    });
    if (execution.state === 'CREATED') execution = this.durable.schedule({ executionId: execution.executionId, expectedGeneration: execution.generation, operationKind });
    this.evidence.appendObservation({
      traceId, idempotencyKey: `channel-enqueued:${execution.executionId}`, kind: 'event', stage: 'channel-operation-enqueued', status: execution.state,
      executionId: execution.executionId, evidence: { operationKind, platform: input.metadata?.platform, status: execution.state }
    });
    return execution;
  }

  async execute(executionId, options = {}) {
    let execution = this.durable.get(executionId);
    if (!execution) throw Object.assign(new Error('Durable channel execution not found'), { code: 'DURABLE_EXECUTION_NOT_FOUND', status: 404, executionId: clean(executionId) });
    if (TERMINAL.has(execution.state)) return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, execution, result: null, replayedTerminal: true };
    if (execution.state === 'CANCEL_REQUESTED') {
      execution = this.durable.acknowledgeCancel({ executionId: execution.executionId, generation: execution.generation, ownerId: execution.ownerId, reasonCode: clean(options.reasonCode || 'CANCEL_ACKNOWLEDGED') });
      this.evidence.cancelTrace({ traceId: execution.traceId, executionId: execution.executionId, idempotencyKey: `channel-cancelled:${execution.executionId}`, evidence: { operationKind: execution.operationKind, status: execution.state } });
      return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, execution, result: null };
    }
    if (execution.state === 'CREATED') execution = this.durable.schedule({ executionId: execution.executionId, expectedGeneration: execution.generation, operationKind: execution.operationKind });
    if (execution.state === 'RETRY_SCHEDULED' && execution.nextAttemptAt && Date.parse(execution.nextAttemptAt) > Date.parse(this.clock())) {
      return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, execution, result: null, waitingForRetryAt: execution.nextAttemptAt };
    }
    const ownerId = clean(options.ownerId);
    execution = this.durable.claim({ executionId: execution.executionId, expectedGeneration: execution.generation, ownerId, reasonCode: clean(options.reasonCode || 'CHANNEL_WORKER_CLAIM') });
    this.evidence.appendObservation({
      traceId: execution.traceId, idempotencyKey: `channel-claimed:${execution.executionId}:${execution.generation}`, kind: 'span', stage: 'channel-operation-claimed', status: execution.state,
      executionId: execution.executionId, evidence: { operationKind: execution.operationKind, platform: execution.metadata?.platform, attempt: execution.retryCount + 1 }
    });
    const handler = this.handlers.get(execution.operationKind);
    if (!handler) {
      const error = Object.assign(new Error(`No durable channel handler registered for ${execution.operationKind}`), { code: 'DURABLE_CHANNEL_HANDLER_NOT_REGISTERED', retryable: false });
      return this.#recordFailure(execution, ownerId, error);
    }
    try {
      const result = await handler({ execution, metadata: execution.metadata, ownerId, generation: execution.generation });
      execution = this.durable.succeed({
        executionId: execution.executionId, generation: execution.generation, ownerId,
        receiptId: clean(result?.receiptId || result?.deliveryReceiptId), providerRequestId: clean(result?.providerRequestId), reasonCode: clean(result?.reasonCode)
      });
      this.evidence.appendObservation({
        traceId: execution.traceId, idempotencyKey: `channel-succeeded:${execution.executionId}:${execution.generation}`, kind: 'event', stage: 'channel-operation-succeeded', status: execution.state,
        executionId: execution.executionId, providerRequestId: clean(result?.providerRequestId), deliveryReceiptId: clean(result?.deliveryReceiptId),
        evidence: { operationKind: execution.operationKind, platform: execution.metadata?.platform, status: execution.state, counts: result?.counts }
      });
      this.evidence.completeTrace({ traceId: execution.traceId, executionId: execution.executionId, idempotencyKey: `channel-trace-completed:${execution.executionId}`, stage: 'channel-trace-completed', evidence: { operationKind: execution.operationKind, status: execution.state } });
      return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, execution, result: result || {} };
    } catch (error) {
      return this.#recordFailure(execution, ownerId, error);
    }
  }

  #recordFailure(execution, ownerId, error) {
    const retryable = error?.retryable === true;
    const nextAttemptAt = clean(error?.nextAttemptAt);
    const failed = this.durable.fail({
      executionId: execution.executionId, generation: execution.generation, ownerId, retryable,
      nextAttemptAt, reasonCode: clean(error?.code || 'CHANNEL_OPERATION_FAILED')
    });
    this.evidence.appendObservation({
      traceId: failed.traceId, idempotencyKey: `channel-failed:${failed.executionId}:${execution.generation}`, kind: 'event', stage: 'channel-operation-failed', status: failed.state,
      executionId: failed.executionId, evidence: { operationKind: failed.operationKind, platform: failed.metadata?.platform, status: failed.state, reasonCode: clean(error?.code), retryable, nextAttemptAt }
    });
    if (TERMINAL.has(failed.state)) {
      this.evidence.failTrace({ traceId: failed.traceId, executionId: failed.executionId, idempotencyKey: `channel-trace-failed:${failed.executionId}`, stage: 'channel-trace-failed', error, evidence: { operationKind: failed.operationKind, status: failed.state } });
    }
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, execution: failed, result: null, error: { code: clean(error?.code), message: clean(error?.message), retryable } };
  }

  requestCancel(executionId, input = {}) {
    const current = this.durable.get(executionId);
    if (!current) throw Object.assign(new Error('Durable channel execution not found'), { code: 'DURABLE_EXECUTION_NOT_FOUND', status: 404, executionId: clean(executionId) });
    if (TERMINAL.has(current.state)) return current;
    return this.durable.requestCancel({ executionId: current.executionId, generation: current.generation, ownerId: current.ownerId, actor: clean(input.actor), reasonCode: clean(input.reasonCode || 'CHANNEL_CANCEL_REQUESTED') });
  }

  async resumeReady({ ownerId, limit = 100 } = {}) {
    const active = this.durable.listActive(limit).filter(row => ['SCHEDULED', 'RETRY_SCHEDULED', 'CANCEL_REQUESTED'].includes(row.state));
    const results = [];
    for (const row of active) results.push(await this.execute(row.executionId, { ownerId }));
    return results;
  }
}

const singleton = new DurableChannelOperationService();
module.exports = singleton;
module.exports.DurableChannelOperationService = DurableChannelOperationService;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.OPERATION_KINDS = OPERATION_KINDS;
