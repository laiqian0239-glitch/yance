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

  async dispatch(input = {}) {
    const request = canonicalSnapshot(input.request || {}, 'request');
    const attempt = this.outboxAuthority.startAttempt({
      ...input,
      request,
      authorityTimestamp: this.issue('external-action-attempt')
    });
    const identity = receiptIdentity(input, attempt);
    let execution = null;
    if (this.executionAuthority) {
      execution = this.executionAuthority.transition({
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
      const receiptInput = {
        ...identity,
        evidenceReference: String(
          error?.evidenceReference || `adapter:${attempt.attemptId}:${stableFailureCode(error)}`
        ),
        result: canonicalSnapshot({ failureCode: stableFailureCode(error) }, 'failureResult'),
        authorityTimestamp: this.issue(
          error?.remoteOutcomeUnknown === true
            ? 'external-action-unknown-receipt'
            : 'external-action-failure-receipt'
        )
      };
      if (error?.remoteOutcomeUnknown === true) {
        return this.outboxAuthority.markUncertain(receiptInput);
      }
      return this.outboxAuthority.recordFailureReceipt(receiptInput);
    }

    try {
      const result = canonicalSnapshot(physicalResult?.result || {}, 'physicalResult.result');
      const receipt = this.outboxAuthority.recordReceipt({
        ...identity,
        providerReceiptId: String(physicalResult?.providerReceiptId || ''),
        evidenceReference: String(
          physicalResult?.evidenceReference || `adapter:${attempt.attemptId}:success`
        ),
        result,
        authorityTimestamp: this.issue('external-action-success-receipt')
      });
      if (this.executionAuthority) {
        this.executionAuthority.transition({
          executionId: String(input.executionId || ''),
          allowedStates: ['WAITING_REMOTE'],
          targetState: 'SUCCEEDED',
          stateVersion: Number(execution?.stateVersion),
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
            attemptId: attempt.attemptId,
            receiptId: String(receipt?.receiptId || '')
          }
        });
      }
      return receipt;
    } catch (error) {
      const causeCode = stableFailureCode(error);
      return this.outboxAuthority.markUncertain({
        ...identity,
        evidenceReference: String(
          physicalResult?.evidenceReference
            || `adapter:${attempt.attemptId}:post-call:${causeCode}`
        ),
        result: canonicalSnapshot({
          failureCode: 'WP_B_POST_CALL_PERSISTENCE_UNCERTAIN',
          causeCode
        }, 'postCallUnknownResult'),
        authorityTimestamp: this.issue('external-action-post-call-unknown-receipt')
      });
    }
  }
}

module.exports = Object.freeze({
  ExternalActionDispatcher,
  dispatcherError
});
