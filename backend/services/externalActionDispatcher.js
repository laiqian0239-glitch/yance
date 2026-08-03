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

    try {
      const physicalResult = await this.adapter.perform(deepFreeze({
        intentId: attempt.intentId || input.intentId,
        attemptId: attempt.attemptId,
        request
      }));
      const result = canonicalSnapshot(physicalResult?.result || {}, 'physicalResult.result');
      return this.outboxAuthority.recordReceipt({
        ...input,
        intentId: attempt.intentId || input.intentId,
        attemptId: attempt.attemptId,
        stateVersion: Number.isSafeInteger(attempt.stateVersion)
          ? attempt.stateVersion
          : Number(input.stateVersion || 0) + 1,
        generation: attempt.generation || input.generation,
        ownerId: attempt.ownerId || input.ownerId,
        providerReceiptId: String(physicalResult?.providerReceiptId || ''),
        evidenceReference: String(
          physicalResult?.evidenceReference || `adapter:${attempt.attemptId}:success`
        ),
        result,
        authorityTimestamp: this.issue('external-action-success-receipt')
      });
    } catch (error) {
      const receiptInput = {
        ...input,
        intentId: attempt.intentId || input.intentId,
        attemptId: attempt.attemptId,
        stateVersion: Number.isSafeInteger(attempt.stateVersion)
          ? attempt.stateVersion
          : Number(input.stateVersion || 0) + 1,
        generation: attempt.generation || input.generation,
        ownerId: attempt.ownerId || input.ownerId,
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
  }
}

module.exports = Object.freeze({
  ExternalActionDispatcher,
  dispatcherError
});
