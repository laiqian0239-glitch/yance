'use strict';

const { deepFreeze } = require('../lib/deepFreeze');
const { canonicalSerialize } = require('./canonicalSerialization');

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
      const settled = this.executionAuthority.settleExternalAttempt({
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
      if (settled?.state === 'RETRY_SCHEDULED'
          && typeof this.outboxAuthority.rearmRetry === 'function'
          && typeof this.outboxAuthority.intent === 'function') {
        const currentIntent = this.outboxAuthority.intent(identity.intentId);
        this.outboxAuthority.rearmRetry({
          intentId: identity.intentId,
          receiptId: String(receipt?.receiptId || ''),
          stateVersion: Number(currentIntent?.claim?.stateVersion),
          generation: Number(currentIntent?.claim?.generation),
          ownerId: String(currentIntent?.claim?.ownerId || identity.ownerId || ''),
          claimId: String(currentIntent?.claim?.claimId || identity.claimId || ''),
          hostId: String(input.hostId || identity.ownerId || ''),
          hostGeneration: Number(currentIntent?.claim?.hostGeneration || identity.hostGeneration || 0),
          fencingToken: Number(currentIntent?.claim?.fencingToken || identity.fencingToken || 0),
          authorityTimestamp: this.issue('external-action-retry-rearm')
        });
      }
      return settled;
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

module.exports = Object.freeze({
  ExternalActionDispatcher,
  dispatcherError
});