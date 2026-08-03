'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ExternalActionDispatcher
} = require('../../../services/externalActionDispatcher');

function dispatchInput() {
  return {
    intentId: 'intent-review-1',
    ownerId: 'dispatcher-review-1',
    claimId: 'claim-review-1',
    generation: 1,
    hostGeneration: 2,
    fencingToken: 3,
    stateVersion: 1,
    request: { bodyReference: 'body-review-1' }
  };
}

function timestampIssuer() {
  return '2026-08-03T08:50:00.000Z';
}

test('post-call canonicalization failure is marked uncertain and never recorded as failure', async () => {
  const calls = [];
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt(input) {
        calls.push('startAttempt');
        return Object.freeze({
          attemptId: 'attempt-review-canonical',
          intentId: input.intentId,
          stateVersion: 2,
          generation: 1,
          ownerId: input.ownerId
        });
      },
      recordReceipt() {
        calls.push('recordReceipt');
        throw new Error('recordReceipt must not be reached after canonicalization failure');
      },
      recordFailureReceipt() {
        calls.push('recordFailureReceipt');
        throw new Error('post-call failure must not become an ordinary failure receipt');
      },
      markUncertain(input) {
        calls.push('markUncertain');
        return Object.freeze({
          receiptType: 'UNKNOWN',
          evidenceReference: input.evidenceReference
        });
      }
    },
    adapter: {
      async perform() {
        calls.push('perform');
        return {
          providerReceiptId: 'provider-review-canonical',
          evidenceReference: 'provider:review-canonical',
          result: { unsupported: 1n }
        };
      }
    },
    issueTimestamp: timestampIssuer
  });

  const receipt = await dispatcher.dispatch(dispatchInput());
  assert.deepEqual(calls, ['startAttempt', 'perform', 'markUncertain']);
  assert.equal(receipt.receiptType, 'UNKNOWN');
});

test('success receipt persistence failure is marked uncertain and never recorded as failure', async () => {
  const calls = [];
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt(input) {
        calls.push('startAttempt');
        return Object.freeze({
          attemptId: 'attempt-review-receipt',
          intentId: input.intentId,
          stateVersion: 2,
          generation: 1,
          ownerId: input.ownerId
        });
      },
      recordReceipt() {
        calls.push('recordReceipt');
        throw Object.assign(new Error('success receipt CAS rejected'), {
          code: 'WP_B_OUTBOX_RECEIPT_CAS_REJECTED'
        });
      },
      recordFailureReceipt() {
        calls.push('recordFailureReceipt');
        throw new Error('post-call receipt failure must not become an ordinary failure receipt');
      },
      markUncertain(input) {
        calls.push('markUncertain');
        return Object.freeze({
          receiptType: 'UNKNOWN',
          evidenceReference: input.evidenceReference
        });
      }
    },
    adapter: {
      async perform() {
        calls.push('perform');
        return {
          providerReceiptId: 'provider-review-receipt',
          evidenceReference: 'provider:review-receipt',
          result: { accepted: true }
        };
      }
    },
    issueTimestamp: timestampIssuer
  });

  const receipt = await dispatcher.dispatch(dispatchInput());
  assert.deepEqual(calls, ['startAttempt', 'perform', 'recordReceipt', 'markUncertain']);
  assert.equal(receipt.receiptType, 'UNKNOWN');
});
