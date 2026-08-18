'use strict';

const { randomUUID } = require('node:crypto');
const { deepFreeze } = require('../lib/deepFreeze');
const { canonicalSerialize } = require('./canonicalSerialization');

const TERMINAL_EXECUTION_STATES = new Set(['CANCELLED', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED']);

function dispatcherError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function authorityTimestamp(value, purpose) {
  const source = typeof value === 'string' ? value : value?.iso;
  const milliseconds = Date.parse(String(source || ''));
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw dispatcherError(
      'WP_B_DISPATCHER_AUTHORITY_TIMESTAMP_INVALID',
      `Authority timestamp for ${purpose} is invalid`,
      { purpose }
    );
  }
  return source;
}

function canonicalSnapshot(value, field) {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(value == null ? {} : value)));
  } catch (error) {
    throw dispatcherError('WP_B_DISPATCHER_REQUEST_INVALID', `${field} must be canonical plain data`, {
      field,
      causeCode: String(error?.code || '')
    });
  }
}

function stableFailureCode(error) {
  const code = String(error?.code || '').trim();
  return code && /^[A-Z0-9_:-]{1,128}$/u.test(code) ? code : 'WP_B_EXTERNAL_ACTION_FAILED';
}

function receiptIdentity(input, attempt) {
  return {
    ...input,
    intentId: attempt.intentId || input.intentId,
    attemptId: attempt.attemptId,
    stateVersion: Number.isSafeInteger(attempt.stateVersion)
      ? attempt.stateVersion
      : Number(input.stateVersion || 0) + 1,
    generation: attempt.generation || input.generation,
    ownerId: attempt.ownerId || input.ownerId,
    claimId: attempt.claimId || input.claimId,
    hostGeneration: attempt.hostGeneration || input.hostGeneration,
    fencingToken: attempt.fencingToken || input.fencingToken
  };
}

function normalizedPhysicalObservation(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const providerReceiptId = String(source.providerReceiptId || source.remoteReceiptId || '').trim();
  const evidenceReference = String(source.evidenceReference || '').trim();
  const failureCode = String(source.failureCode || '').trim();
  const uncertain = source.uncertain === true || source.remoteOutcomeUnknown === true;
  const retryable = source.retryable === true;
  const retryDelayMs = Number.isSafeInteger(Number(source.retryDelayMs)) && Number(source.retryDelayMs) >= 0
    ? Number(source.retryDelayMs)
    : 0;
  let resultSource = source.result;
  if (!resultSource || typeof resultSource !== 'object' || Array.isArray(resultSource)) {
    resultSource = Object.fromEntries(Object.entries(source).filter(([field]) => ![
      'providerReceiptId',
      'remoteReceiptId',
      'evidenceReference',
      'failureCode',
      'uncertain',
      'remoteOutcomeUnknown',
      'retryable',
      'retryDelayMs'
    ].includes(field)));
  }
  return Object.freeze({
    providerReceiptId,
    evidenceReference,
    failureCode,
    uncertain,
    retryable,
    retryDelayMs,
    result: canonicalSnapshot(resultSource || {}, 'physicalResult.result')
  });
}

class ExternalActionDispatcher {
  constructor(options = {}) {
    if (!options.outboxAuthority || typeof options.outboxAuthority.startAttempt !== 'function') {
      throw new TypeError('ExternalActionDispatcher requires an ExternalActionOutboxAuthority');
    }
    if (!options.adapter || typeof options.adapter.perform !== 'function') {
      throw new TypeError('ExternalActionDispatcher requires a physical adapter.perform capability');
    }
    if (typeof options.issueTimestamp !== 'function') {
      throw new TypeError('ExternalActionDispatcher requires an explicit authority timestamp issuer');
    }
    this.outboxAuthority = options.outboxAuthority;
    this.executionAuthority = options.executionAuthority || null;
    if (this.executionAuthority && typeof this.executionAuthority.transition !== 'function') {
      throw new TypeError('ExternalActionDispatcher executionAuthority must expose transition');
    }
    this.adapter = options.adapter;
    this.issueTimestamp = options.issueTimestamp;
  }

  issue(purpose) {
    return authorityTimestamp(this.issueTimestamp(purpose), purpose);
  }

  settleExecution(input, waitingExecution, identity, receipt, settlement) {
    if (!this.executionAuthority) return null;
    if (typeof this.executionAuthority.settleExternalAttempt === 'function') {
      return this.executionAuthority.settleExternalAttempt({
        executionId: String(input.executionId || ''),
        outcome: settlement.outcome,
        receiptId: String(receipt?.receiptId || ''),
        stateVersion: Number(waitingExecution?.stateVersion),
        generation: Number(input.executionGeneration),
        ownerId: String(identity.ownerId || ''),
        claimId: String(identity.claimId || ''),
        hostId: String(input.hostId || identity.ownerId || ''),
        hostGeneration: Number(identity.hostGeneration || 0),
        fencingToken: Number(identity.fencingToken || 0),
        retryable: settlement.retryable === true,
        retryDelayMs: Number(settlement.retryDelayMs || 0),
        failureCode: String(settlement.failureCode || ''),
        authorityTimestamp: this.issue(`external-action-settlement-${settlement.outcome.toLowerCase()}`)
      });
    }
    if (settlement.outcome !== 'SUCCESS') return null;
    return this.executionAuthority.transition({
      executionId: String(input.executionId || ''),
      allowedStates: ['WAITING_REMOTE'],
      targetState: 'SUCCEEDED',
      stateVersion: Number(waitingExecution?.stateVersion),
      generation: Number(input.executionGeneration),
      ownerId: String(identity.ownerId || ''),
      claimId: String(identity.claimId || ''),
      hostId: String(input.hostId || identity.ownerId || ''),
      hostGeneration: Number(identity.hostGeneration || 0),
      fencingToken: Number(identity.fencingToken || 0),
      authorityTimestamp: this.issue('external-action-terminal-success'),
      eventType: 'external-action-succeeded',
      reasonCode: 'EXTERNAL_ACTION_RECEIPT_COMMITTED',
      payload: {
        intentId: identity.intentId,
        attemptId: identity.attemptId,
        receiptId: String(receipt?.receiptId || '')
      }
    });
  }

  recordUnknown(input, waitingExecution, identity, observation) {
    const receipt = this.outboxAuthority.markUncertain({
      ...identity,
      evidenceReference: String(observation.evidenceReference || `adapter:${identity.attemptId}:unknown`),
      result: observation.result,
      authorityTimestamp: this.issue('external-action-unknown-receipt')
    });
    this.settleExecution(input, waitingExecution, identity, receipt, {
      outcome: 'UNKNOWN',
      failureCode: 'UNCERTAIN_REMOTE_OUTCOME'
    });
    return receipt;
  }

  recordFailure(input, waitingExecution, identity, observation) {
    const receipt = this.outboxAuthority.recordFailureReceipt({
      ...identity,
      retryable: observation.retryable === true,
      evidenceReference: String(
        observation.evidenceReference || `adapter:${identity.attemptId}:${observation.failureCode}`
      ),
      result: canonicalSnapshot({
        ...observation.result,
        failureCode: observation.failureCode,
        retryable: observation.retryable === true,
        retryDelayMs: Number(observation.retryDelayMs || 0)
      }, 'failureResult'),
      authorityTimestamp: this.issue('external-action-failure-receipt')
    });
    this.settleExecution(input, waitingExecution, identity, receipt, {
      outcome: 'FAILURE',
      failureCode: observation.failureCode,
      retryable: observation.retryable === true,
      retryDelayMs: Number(observation.retryDelayMs || 0)
    });
    return receipt;
  }

  async dispatch(input = {}) {
    const request = canonicalSnapshot(input.request || {}, 'request');
    const attempt = this.outboxAuthority.startAttempt({
      ...input,
      request,
      authorityTimestamp: this.issue('external-action-attempt')
    });
    const identity = receiptIdentity(input, attempt);
    let waitingExecution = null;
    if (this.executionAuthority) {
      waitingExecution = this.executionAuthority.transition({
        executionId: String(input.executionId || ''),
        allowedStates: ['RUNNING'],
        targetState: 'WAITING_REMOTE',
        stateVersion: Number(input.executionStateVersion),
        generation: Number(input.executionGeneration),
        ownerId: String(identity.ownerId || ''),
        claimId: String(identity.claimId || ''),
        hostId: String(input.hostId || identity.ownerId || ''),
        hostGeneration: Number(identity.hostGeneration || 0),
        fencingToken: Number(identity.fencingToken || 0),
        authorityTimestamp: this.issue('external-action-waiting-remote'),
        eventType: 'external-action-waiting-remote',
        reasonCode: 'EXTERNAL_ACTION_ATTEMPT_PERSISTED',
        payload: { intentId: identity.intentId, attemptId: attempt.attemptId }
      });
    }

    let physicalResult;
    try {
      physicalResult = await this.adapter.perform(deepFreeze({
        executionId: String(identity.executionId || ''),
        intentId: identity.intentId,
        attemptId: identity.attemptId,
        idempotencyKey: String(identity.idempotencyKey || ''),
        ownerId: String(identity.ownerId || ''),
        claimId: String(identity.claimId || ''),
        generation: Number(identity.generation || 0),
        hostGeneration: Number(identity.hostGeneration || 0),
        fencingToken: Number(identity.fencingToken || 0),
        leaseExpiresAt: String(identity.leaseExpiresAt || ''),
        request
      }));
    } catch (error) {
      const failureCode = stableFailureCode(error);
      const observation = Object.freeze({
        evidenceReference: String(error?.evidenceReference || `adapter:${attempt.attemptId}:${failureCode}`),
        failureCode,
        retryable: error?.retryable === true,
        retryDelayMs: Number.isSafeInteger(Number(error?.retryDelayMs)) && Number(error.retryDelayMs) >= 0
          ? Number(error.retryDelayMs)
          : 0,
        result: canonicalSnapshot({ failureCode }, 'failureResult')
      });
      if (error?.remoteOutcomeUnknown === true) {
        return this.recordUnknown(input, waitingExecution, identity, observation);
      }
      return this.recordFailure(input, waitingExecution, identity, observation);
    }

    let observation;
    try {
      observation = normalizedPhysicalObservation(physicalResult);
    } catch (error) {
      return this.recordUnknown(input, waitingExecution, identity, Object.freeze({
        evidenceReference: String(physicalResult?.evidenceReference || `adapter:${attempt.attemptId}:post-call-canonical`),
        result: canonicalSnapshot({
          failureCode: 'WP_B_POST_CALL_CANONICALIZATION_UNCERTAIN',
          causeCode: stableFailureCode(error)
        }, 'postCallUnknownResult')
      }));
    }

    if (observation.uncertain) {
      return this.recordUnknown(input, waitingExecution, identity, observation);
    }
    if (observation.failureCode) {
      return this.recordFailure(input, waitingExecution, identity, observation);
    }

    let receipt;
    try {
      receipt = this.outboxAuthority.recordReceipt({
        ...identity,
        providerReceiptId: observation.providerReceiptId,
        evidenceReference: String(observation.evidenceReference || `adapter:${attempt.attemptId}:success`),
        result: observation.result,
        authorityTimestamp: this.issue('external-action-success-receipt')
      });
    } catch (error) {
      return this.recordUnknown(input, waitingExecution, identity, Object.freeze({
        evidenceReference: String(
          observation.evidenceReference || `adapter:${attempt.attemptId}:post-call:${stableFailureCode(error)}`
        ),
        result: canonicalSnapshot({
          failureCode: 'WP_B_POST_CALL_PERSISTENCE_UNCERTAIN',
          causeCode: stableFailureCode(error)
        }, 'postCallUnknownResult')
      }));
    }
    this.settleExecution(input, waitingExecution, identity, receipt, { outcome: 'SUCCESS' });
    return receipt;
  }
}

async function executePreparedOperation(options = {}) {
  const prepared = options.prepared;
  const executionAuthority = options.executionAuthority;
  const outboxAuthority = options.outboxAuthority;
  const operationRegistry = options.operationRegistry;
  const authorityWriteHostCapability = options.authorityWriteHostCapability;
  const issueTimestamp = options.issueTimestamp;
  if (!prepared || typeof prepared !== 'object') {
    throw new TypeError('Prepared durable operation receipt is required');
  }
  if (!executionAuthority || typeof executionAuthority.get !== 'function'
      || typeof executionAuthority.schedule !== 'function'
      || typeof executionAuthority.claim !== 'function'
      || typeof executionAuthority.transition !== 'function') {
    throw new TypeError('Prepared operation pump requires DurableExecutionAuthority');
  }
  if (!outboxAuthority || typeof outboxAuthority.intent !== 'function'
      || typeof outboxAuthority.claimIntent !== 'function') {
    throw new TypeError('Prepared operation pump requires ExternalActionOutboxAuthority');
  }
  if (!operationRegistry || typeof operationRegistry.require !== 'function') {
    throw new TypeError('Prepared operation pump requires the sealed durable operation registry');
  }
  if (!authorityWriteHostCapability || typeof authorityWriteHostCapability.tokenSnapshot !== 'function') {
    throw new TypeError('Prepared operation pump requires AuthorityWriteHost capability');
  }
  if (typeof issueTimestamp !== 'function') {
    throw new TypeError('Prepared operation pump requires an authority timestamp issuer');
  }

  const executionId = String(prepared.executionId || '').trim();
  const intentId = String(prepared.intentId || '').trim();
  if (!executionId || !intentId) {
    throw dispatcherError('WP_B_PREPARED_OPERATION_ID_REQUIRED', 'Prepared executionId and intentId are required');
  }
  let execution = executionAuthority.get(executionId);
  if (!execution) {
    throw dispatcherError('WP_B_PREPARED_EXECUTION_NOT_FOUND', 'Prepared durable execution does not exist', { executionId });
  }
  if (TERMINAL_EXECUTION_STATES.has(execution.state)) {
    return Object.freeze({
      dispatched: false,
      replayedTerminal: true,
      executionId,
      intentId,
      state: execution.state,
      receiptId: execution.terminalReceiptId || ''
    });
  }
  const token = authorityWriteHostCapability.tokenSnapshot();
  const hostId = String(token?.instanceId || '').trim();
  const hostGeneration = Number(token?.hostGeneration || 0);
  const fencingToken = Number(token?.fencingToken || 0);
  if (!hostId || !Number.isSafeInteger(hostGeneration) || hostGeneration < 1
      || !Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw dispatcherError('WP_B_PREPARED_OPERATION_HOST_TOKEN_INVALID', 'Current write-host token is invalid');
  }
  const issue = purpose => authorityTimestamp(issueTimestamp(purpose), purpose);
  if (execution.state === 'CREATED') {
    execution = executionAuthority.schedule({
      executionId,
      stateVersion: execution.stateVersion,
      generation: execution.generation,
      operationKind: execution.operationKind,
      hostId,
      hostGeneration,
      fencingToken,
      authorityTimestamp: issue('prepared-operation-schedule')
    });
  }
  if (execution.state !== 'SCHEDULED') {
    return Object.freeze({
      dispatched: false,
      replayedTerminal: false,
      executionId,
      intentId,
      state: execution.state,
      reason: 'EXECUTION_NOT_SCHEDULED'
    });
  }

  const intent = outboxAuthority.intent(intentId);
  if (!intent || intent.executionId !== executionId) {
    throw dispatcherError(
      'WP_B_PREPARED_OPERATION_INTENT_MISMATCH',
      'Prepared intent is missing or belongs to another execution',
      { executionId, intentId }
    );
  }
  if (intent.claim?.state !== 'READY') {
    return Object.freeze({
      dispatched: false,
      replayedTerminal: false,
      executionId,
      intentId,
      state: execution.state,
      reason: `INTENT_${String(intent.claim?.state || 'UNKNOWN')}`
    });
  }

  const ownerId = hostId;
  const claimId = `external-action-claim-${randomUUID()}`;
  const leaseStartedAt = issue('prepared-operation-claim');
  const leaseMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Number(options.leaseMs || 120_000)));
  const leaseExpiresAt = new Date(Date.parse(leaseStartedAt) + leaseMs).toISOString();
  const executionClaim = executionAuthority.claim({
    executionId,
    stateVersion: execution.stateVersion,
    generation: execution.generation,
    ownerId,
    claimId,
    hostId,
    hostGeneration,
    fencingToken,
    leaseStartedAt,
    leaseExpiresAt,
    reasonCode: 'EXTERNAL_ACTION_DISPATCH_CLAIM'
  });
  const intentClaim = outboxAuthority.claimIntent({
    intentId,
    stateVersion: Number(intent.claim.stateVersion),
    generation: Number(intent.claim.generation),
    ownerId,
    claimId,
    hostId,
    hostGeneration,
    fencingToken,
    leaseStartedAt,
    leaseExpiresAt
  });
  const running = executionAuthority.transition({
    executionId,
    allowedStates: ['CLAIMED'],
    targetState: 'RUNNING',
    stateVersion: executionClaim.stateVersion,
    generation: executionClaim.generation,
    ownerId,
    claimId,
    hostId,
    hostGeneration,
    fencingToken,
    authorityTimestamp: issue('prepared-operation-running'),
    eventType: 'external-action-running',
    reasonCode: 'EXTERNAL_ACTION_DISPATCH_STARTED',
    payload: { intentId }
  });
  const adapter = operationRegistry.require(execution.operationKind);
  const dispatcher = new ExternalActionDispatcher({
    executionAuthority,
    outboxAuthority,
    adapter,
    issueTimestamp
  });
  const receipt = await dispatcher.dispatch({
    executionId,
    executionStateVersion: running.stateVersion,
    executionGeneration: running.generation,
    intentId,
    idempotencyKey: intent.idempotencyKey,
    ownerId,
    hostId,
    claimId,
    stateVersion: Number(intentClaim.claim?.stateVersion),
    generation: Number(intentClaim.claim?.generation),
    hostGeneration,
    fencingToken,
    leaseExpiresAt,
    request: intent.payload
  });
  const settled = executionAuthority.get(executionId);
  return Object.freeze({
    dispatched: true,
    replayedTerminal: false,
    executionId,
    intentId,
    state: settled?.state || '',
    receiptId: String(receipt?.receiptId || ''),
    receiptType: String(receipt?.receiptType || '')
  });
}

module.exports = Object.freeze({
  ExternalActionDispatcher,
  dispatcherError,
  executePreparedOperation
});