'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operationPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'services',
  'durableOperations',
  'deliveryReceiptReconciliationOperation.js'
);

function operationModule() {
  assert.equal(
    fs.existsSync(operationPath),
    true,
    'WP_B_M2_DELIVERY_RECEIPT_OPERATION_REQUIRED'
  );
  delete require.cache[require.resolve(operationPath)];
  return require(operationPath);
}

function reconciliationEnvelope(overrides = {}) {
  const request = Object.freeze({
    platform: 'whatsapp',
    accountReference: 'account-ref-1',
    deliveryAttemptReference: 'delivery-attempt-ref-1',
    credentialReference: 'credential-ref-1',
    requestContentSha256: 'c'.repeat(64),
    ...overrides.request
  });
  return Object.freeze({
    executionId: 'execution-receipt-1',
    intentId: 'intent-receipt-1',
    attemptId: 'attempt-receipt-1',
    claimId: 'claim-receipt-1',
    ownerId: 'owner-receipt-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'idempotency-receipt-1',
    providerRequestId: 'provider-request-receipt-1',
    platformMessageId: 'platform-message-receipt-1',
    request,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'request')
    )
  });
}

test('M2-RCP-001 delivery receipt Adapter is frozen and exposes the exact durable operation kind', () => {
  const {
    OPERATION_KIND,
    createDeliveryReceiptReconciliationOperation
  } = operationModule();
  assert.equal(OPERATION_KIND, 'DELIVERY_RECEIPT_RECONCILIATION');
  const adapter = createDeliveryReceiptReconciliationOperation({
    resolveCredentialReference() {
      return Object.freeze({ session: 'ephemeral session' });
    },
    deliveryClient: Object.freeze({
      async query() {
        return Object.freeze({
          deliveryStatus: 'UNKNOWN',
          platformMessageId: 'platform-message-receipt-1'
        });
      },
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-RCP-002 perform queries persisted remote identity and returns only bounded delivery evidence', async () => {
  const { createDeliveryReceiptReconciliationOperation } = operationModule();
  const calls = [];
  const credential = Object.freeze({ session: 'private session material' });
  const adapter = createDeliveryReceiptReconciliationOperation({
    resolveCredentialReference(reference, context) {
      calls.push(['resolveCredentialReference', reference, context.attemptId]);
      return credential;
    },
    deliveryClient: Object.freeze({
      async query(input) {
        calls.push([
          'query',
          input.deliveryAttemptReference,
          input.providerRequestId,
          input.platformMessageId,
          input.credential === credential
        ]);
        return Object.freeze({
          deliveryStatus: 'DELIVERED',
          platformMessageId: input.platformMessageId,
          providerRequestId: input.providerRequestId,
          evidenceReference: 'evidence-receipt-2',
          payload: 'must-not-escape',
          sessionMaterial: 'must-not-escape'
        });
      },
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });

  const result = await adapter.perform(reconciliationEnvelope());
  assert.deepEqual(calls, [
    ['resolveCredentialReference', 'credential-ref-1', 'attempt-receipt-1'],
    [
      'query',
      'delivery-attempt-ref-1',
      'provider-request-receipt-1',
      'platform-message-receipt-1',
      true
    ]
  ]);
  assert.deepEqual(result, {
    deliveryStatus: 'DELIVERED',
    platformMessageId: 'platform-message-receipt-1',
    providerRequestId: 'provider-request-receipt-1',
    evidenceReference: 'evidence-receipt-2',
    failureCode: ''
  });
  assert.equal(JSON.stringify(result).includes('private session material'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-RCP-003 perform rejects mutable envelopes, missing attempt or remote identity, and inline content', async () => {
  const { createDeliveryReceiptReconciliationOperation } = operationModule();
  const adapter = createDeliveryReceiptReconciliationOperation({
    resolveCredentialReference() {
      throw new Error('invalid envelope must not resolve credential');
    },
    deliveryClient: Object.freeze({
      async query() {
        throw new Error('invalid envelope must not query');
      },
      async lookup() {
        throw new Error('invalid envelope must not lookup');
      }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...reconciliationEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  await assert.rejects(
    () => adapter.perform(Object.freeze({ ...reconciliationEnvelope(), attemptId: '' })),
    error => error?.code === 'WP_B_DELIVERY_RECEIPT_ATTEMPT_ID_REQUIRED'
  );
  await assert.rejects(
    () => adapter.perform(reconciliationEnvelope({
      providerRequestId: '',
      platformMessageId: ''
    })),
    error => error?.code === 'WP_B_DELIVERY_RECEIPT_REMOTE_IDENTITY_REQUIRED'
  );
  for (const field of [
    'apiKey',
    'oauthToken',
    'cookie',
    'sessionMaterial',
    'messageBody',
    'binaryPayload'
  ]) {
    await assert.rejects(
      () => adapter.perform(reconciliationEnvelope({ request: { [field]: 'forbidden-value' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD' && error?.field === field,
      field
    );
  }
});

test('M2-RCP-004 reconciliation performs lookup only and preserves a bounded remote outcome', async () => {
  const { createDeliveryReceiptReconciliationOperation } = operationModule();
  const calls = [];
  const credential = Object.freeze({ session: 'ephemeral reconciliation session' });
  const adapter = createDeliveryReceiptReconciliationOperation({
    resolveCredentialReference(reference) {
      calls.push(['resolveCredentialReference', reference]);
      return credential;
    },
    deliveryClient: Object.freeze({
      async query() {
        calls.push(['query']);
        throw new Error('reconciliation must not run ordinary query');
      },
      async lookup(input) {
        calls.push([
          'lookup',
          input.idempotencyKey,
          input.providerRequestId,
          input.platformMessageId,
          input.credential === credential
        ]);
        return Object.freeze({
          outcome: 'REMOTE_SUCCESS_PROVEN',
          deliveryStatus: 'READ',
          platformMessageId: input.platformMessageId,
          providerRequestId: input.providerRequestId,
          evidenceReference: 'evidence-receipt-reconciled',
          payload: 'must-not-escape'
        });
      }
    })
  });

  const result = await adapter.reconcile(reconciliationEnvelope());
  assert.deepEqual(calls, [
    ['resolveCredentialReference', 'credential-ref-1'],
    [
      'lookup',
      'idempotency-receipt-1',
      'provider-request-receipt-1',
      'platform-message-receipt-1',
      true
    ]
  ]);
  assert.deepEqual(result, {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    deliveryStatus: 'READ',
    platformMessageId: 'platform-message-receipt-1',
    providerRequestId: 'provider-request-receipt-1',
    evidenceReference: 'evidence-receipt-reconciled',
    failureCode: ''
  });
  assert.equal(Object.isFrozen(result), true);
});
