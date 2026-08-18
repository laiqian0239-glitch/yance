'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deepFreeze } = require('../../../lib/deepFreeze');
const { OPERATION_KINDS } = require('../../../services/durableOperationRegistry');
const { CommunicationAuthority } = require('../../../services/communicationAuthority');
const { ChannelAdapterRuntime } = require('../../../services/channelAdapterRuntime');

const HASH = 'd'.repeat(64);

function reconciliationCommand(overrides = {}) {
  return deepFreeze({
    schemaVersion: 1,
    platform: 'telegram',
    accountReference: 'account-ref-receipt-1',
    deliveryAttemptReference: 'attempt-outbound-target-1',
    credentialReference: 'credential-ref-receipt-1',
    requestContentSha256: HASH,
    targetExecutionId: 'execution-outbound-target-1',
    targetIntentId: 'intent-outbound-target-1',
    targetAttemptId: 'attempt-outbound-target-1',
    providerRequestId: 'provider-request-target-1',
    platformMessageId: 'platform-message-target-1',
    ...overrides
  });
}

function facadeFixture(overrides = {}) {
  return {
    platform: 'telegram',
    contract: () => ({ bindings: {}, boundaries: {} }),
    auth: { execute: async input => input },
    ingress: { normalize: async input => input },
    egress: { execute: async input => ({ accepted: true, input }) },
    reconcile: { execute: async input => ({ outcome: 'REMOTE_RESULT_UNKNOWN', input }) },
    ...overrides
  };
}

function transactionCapability(order, overrides = {}) {
  let active = false;
  let transactionCount = 0;
  const assertActive = () => assert.equal(active, true, 'authority mutation escaped the single store transaction');
  return Object.freeze({
    transaction(work) {
      assert.equal(active, false, 'nested store transaction is forbidden');
      transactionCount += 1;
      active = true;
      order.push('transaction:start');
      try {
        return work();
      } finally {
        order.push('transaction:end');
        active = false;
      }
    },
    recordReconciliation(input) {
      assertActive();
      order.push('recordReconciliation');
      overrides.onReconciliation?.(input);
      return Object.freeze({ reconciliationId: 'reconciliation-durable-1' });
    },
    recordReceipt(input) {
      assertActive();
      order.push('recordReceipt');
      overrides.onReceipt?.(input);
      return Object.freeze({ receiptId: 'receipt-durable-1' });
    },
    transitionExecution(input) {
      assertActive();
      order.push('transitionExecution');
      overrides.onTransition?.(input);
      return Object.freeze({ executionId: input.executionId, state: input.targetState });
    },
    transactionCount() { return transactionCount; }
  });
}

test('M2-DRM-001 communication authority creates a separate durable reconciliation execution and intent', () => {
  const calls = [];
  const authority = new CommunicationAuthority({
    storeProvider() {
      throw Object.assign(new Error('legacy communication store must not be used'), {
        code: 'LEGACY_COMMUNICATION_STORE_FORBIDDEN'
      });
    },
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input]);
        return Object.freeze({ executionId: 'execution-reconciliation-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input]);
        return Object.freeze({ intentId: 'intent-reconciliation-1' });
      }
    }),
    issueTimestamp: purpose => purpose === 'delivery-receipt-reconciliation-execution'
      ? '2026-08-04T04:00:00.000Z'
      : '2026-08-04T04:00:01.000Z'
  });

  assert.equal(typeof authority.prepareDeliveryReceiptReconciliation, 'function');
  const prepared = authority.prepareDeliveryReceiptReconciliation({
    idempotencyKey: 'reconciliation-idempotency-1',
    traceId: 'trace-reconciliation-1',
    command: reconciliationCommand(),
    maxAttempts: 3
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['execution', 'intent']);
  assert.equal(calls[0][1].operationKind, OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION);
  assert.equal(calls[1][1].actionKind, OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION);
  assert.equal(calls[1][1].executionId, 'execution-reconciliation-1');
  assert.deepEqual(prepared, {
    executionId: 'execution-reconciliation-1',
    intentId: 'intent-reconciliation-1',
    operationKind: OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION,
    idempotencyKey: 'reconciliation-idempotency-1'
  });
  assert.equal(Object.isFrozen(prepared), true);
});

test('M2-DRM-002 public delivery query schedules reconciliation and never performs remote lookup', async () => {
  let physicalLookupCount = 0;
  const scheduled = [];
  const runtime = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade: facadeFixture({
      reconcile: {
        async execute() {
          physicalLookupCount += 1;
          return { outcome: 'REMOTE_RESULT_UNKNOWN' };
        }
      }
    }),
    communicationAuthority: Object.freeze({
      prepareDeliveryReceiptReconciliation(input) {
        scheduled.push(input);
        return Object.freeze({
          executionId: 'execution-reconciliation-2',
          intentId: 'intent-reconciliation-2',
          operationKind: OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION,
          idempotencyKey: input.idempotencyKey
        });
      }
    }),
    accountReader: () => null
  });

  const result = await runtime.queryDelivery({
    traceId: 'trace-reconciliation-2',
    idempotencyKey: 'reconciliation-idempotency-2',
    accountId: 'account-ref-receipt-1',
    deliveryAttemptReference: 'attempt-outbound-target-1',
    credentialReference: 'credential-ref-receipt-1',
    requestContentSha256: HASH,
    targetExecutionId: 'execution-outbound-target-1',
    targetIntentId: 'intent-outbound-target-1',
    targetAttemptId: 'attempt-outbound-target-1',
    providerRequestId: 'provider-request-target-1',
    platformMessageId: 'platform-message-target-1'
  });

  assert.equal(physicalLookupCount, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].command.targetIntentId, 'intent-outbound-target-1');
  assert.equal(scheduled[0].command.targetAttemptId, 'attempt-outbound-target-1');
  assert.equal(result.executionId, 'execution-reconciliation-2');
  assert.equal(result.intentId, 'intent-reconciliation-2');
});

test('M2-DRM-003 unknown remote observation is persisted first in one transaction and never authorizes retry', () => {
  const order = [];
  const capability = transactionCapability(order);
  const authority = new CommunicationAuthority({
    deliveryReceiptTransactionCapability: capability,
    issueTimestamp: () => '2026-08-04T04:10:00.000Z'
  });

  assert.equal(typeof authority.applyDeliveryReceiptObservation, 'function');
  const result = authority.applyDeliveryReceiptObservation({
    targetExecutionId: 'execution-outbound-target-3',
    targetIntentId: 'intent-outbound-target-3',
    targetAttemptId: 'attempt-outbound-target-3',
    observation: deepFreeze({
      outcome: 'REMOTE_RESULT_UNKNOWN',
      provider: 'telegram',
      operationId: 'execution-outbound-target-3',
      evidenceReference: 'evidence-reconciliation-unknown-3',
      remoteReceiptId: '',
      observedAt: '2026-08-04T04:09:59.000Z',
      result: Object.freeze({ deliveryStatus: 'UNKNOWN' })
    })
  });

  assert.deepEqual(order, [
    'transaction:start',
    'recordReconciliation',
    'transaction:end'
  ]);
  assert.equal(capability.transactionCount(), 1);
  assert.equal(result.state, 'REMOTE_RESULT_UNKNOWN');
  assert.equal(result.retryAllowed, false);
  assert.equal(result.terminal, false);
});

test('M2-DRM-004 proven success persists observation then receipt then execution transition in one transaction', () => {
  const order = [];
  let receiptInput = null;
  let transitionInput = null;
  const capability = transactionCapability(order, {
    onReceipt(input) { receiptInput = input; },
    onTransition(input) { transitionInput = input; }
  });
  const authority = new CommunicationAuthority({
    deliveryReceiptTransactionCapability: capability,
    issueTimestamp: () => '2026-08-04T04:20:00.000Z'
  });

  const result = authority.applyDeliveryReceiptObservation({
    targetExecutionId: 'execution-outbound-target-4',
    targetIntentId: 'intent-outbound-target-4',
    targetAttemptId: 'attempt-outbound-target-4',
    outboxClaim: deepFreeze({
      stateVersion: 2,
      generation: 1,
      ownerId: 'owner-reconciliation-4',
      claimId: 'claim-reconciliation-4',
      hostId: 'host-reconciliation-4',
      hostGeneration: 1,
      fencingToken: 1
    }),
    executionClaim: deepFreeze({
      stateVersion: 3,
      generation: 1,
      ownerId: 'owner-reconciliation-4',
      claimId: 'claim-reconciliation-4',
      hostId: 'host-reconciliation-4',
      hostGeneration: 1,
      fencingToken: 1,
      allowedStates: Object.freeze(['RUNNING', 'WAITING_REMOTE'])
    }),
    observation: deepFreeze({
      outcome: 'REMOTE_SUCCESS_PROVEN',
      provider: 'telegram',
      operationId: 'execution-outbound-target-4',
      evidenceReference: 'evidence-reconciliation-success-4',
      remoteReceiptId: 'platform-message-target-4',
      observedAt: '2026-08-04T04:19:59.000Z',
      result: Object.freeze({ deliveryStatus: 'DELIVERED' })
    })
  });

  assert.deepEqual(order, [
    'transaction:start',
    'recordReconciliation',
    'recordReceipt',
    'transitionExecution',
    'transaction:end'
  ]);
  assert.equal(capability.transactionCount(), 1);
  assert.equal(receiptInput.intentId, 'intent-outbound-target-4');
  assert.equal(receiptInput.attemptId, 'attempt-outbound-target-4');
  assert.equal(receiptInput.providerReceiptId, 'platform-message-target-4');
  assert.equal(transitionInput.executionId, 'execution-outbound-target-4');
  assert.equal(transitionInput.targetState, 'SUCCEEDED');
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(result.retryAllowed, false);
  assert.equal(result.terminal, true);
});
