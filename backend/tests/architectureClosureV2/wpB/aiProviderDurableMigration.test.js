'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicesRoot = path.join(__dirname, '..', '..', '..', 'services');
const operationPath = path.join(servicesRoot, 'durableOperations', 'aiProviderExecutionOperation.js');
const hostPath = path.join(servicesRoot, 'modelExecutionHost.js');

function operationModule() {
  assert.equal(fs.existsSync(operationPath), true, 'WP_B_M2_AI_PROVIDER_OPERATION_REQUIRED');
  delete require.cache[require.resolve(operationPath)];
  return require(operationPath);
}

function hostModule() {
  assert.equal(fs.existsSync(hostPath), true, 'WP_B_M2_MODEL_EXECUTION_HOST_REQUIRED');
  delete require.cache[require.resolve(hostPath)];
  return require(hostPath);
}

function attemptEnvelope(overrides = {}) {
  const request = Object.freeze({
    modelReference: 'model-ref-1',
    promptReference: 'prompt-ref-1',
    credentialReference: 'credential-ref-1',
    requestContentSha256: 'a'.repeat(64),
    ...overrides.request
  });
  return Object.freeze({
    executionId: 'execution-1',
    intentId: 'intent-1',
    attemptId: 'attempt-1',
    idempotencyKey: 'idempotency-1',
    request,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request'))
  });
}

test('M2-AI-001 AI provider Adapter is frozen, registered to the exact kind, and exposes perform plus reconcile', () => {
  const { OPERATION_KIND, createAiProviderExecutionOperation } = operationModule();
  assert.equal(OPERATION_KIND, 'AI_PROVIDER_EXECUTION');
  const adapter = createAiProviderExecutionOperation({
    resolveCredentialReference() { return Object.freeze({ token: 'ephemeral-token' }); },
    providerClient: Object.freeze({
      async perform() { return Object.freeze({ providerRequestId: 'provider-1', accepted: true }); },
      async lookup() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-AI-002 perform resolves credential custody immediately before the physical call and returns only redacted evidence', async () => {
  const { createAiProviderExecutionOperation } = operationModule();
  const calls = [];
  const credential = Object.freeze({ token: 'super-secret-token' });
  const adapter = createAiProviderExecutionOperation({
    resolveCredentialReference(reference, context) {
      calls.push(['resolveCredentialReference', reference, context.attemptId]);
      return credential;
    },
    providerClient: Object.freeze({
      async perform(input) {
        calls.push(['physicalCall', input.attemptId, input.credential === credential]);
        assert.equal(input.credential, credential);
        assert.equal(input.promptReference, 'prompt-ref-1');
        return Object.freeze({
          providerRequestId: 'provider-request-1',
          providerReceiptId: 'provider-receipt-1',
          accepted: true,
          token: 'must-not-escape',
          responseBody: 'must-not-escape'
        });
      },
      async lookup() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });

  const result = await adapter.perform(attemptEnvelope());
  assert.deepEqual(calls, [
    ['resolveCredentialReference', 'credential-ref-1', 'attempt-1'],
    ['physicalCall', 'attempt-1', true]
  ]);
  assert.equal(result.providerRequestId, 'provider-request-1');
  assert.equal(result.providerReceiptId, 'provider-receipt-1');
  assert.equal(result.accepted, true);
  assert.equal(result.token, undefined);
  assert.equal(result.responseBody, undefined);
  assert.equal(JSON.stringify(result).includes('super-secret-token'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-AI-003 perform rejects missing persisted attempt identity, mutable envelopes, and inline secret or prompt bodies', async () => {
  const { createAiProviderExecutionOperation } = operationModule();
  const adapter = createAiProviderExecutionOperation({
    resolveCredentialReference() { throw new Error('must not resolve invalid envelope'); },
    providerClient: Object.freeze({
      async perform() { throw new Error('must not perform invalid envelope'); },
      async lookup() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...attemptEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  await assert.rejects(
    () => adapter.perform(Object.freeze({ ...attemptEnvelope(), attemptId: '' })),
    error => error?.code === 'WP_B_AI_PROVIDER_ATTEMPT_ID_REQUIRED'
  );
  for (const field of ['apiKey', 'oauthToken', 'cookie', 'promptBody', 'messageBody', 'binaryPayload']) {
    await assert.rejects(
      () => adapter.perform(attemptEnvelope({ request: { [field]: 'forbidden-value' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD' && error?.field === field,
      field
    );
  }
});

test('M2-AI-004 reconciliation uses provider idempotency/request lookup and never performs a second physical call', async () => {
  const { createAiProviderExecutionOperation } = operationModule();
  const calls = [];
  const adapter = createAiProviderExecutionOperation({
    resolveCredentialReference(reference) {
      calls.push(['resolveCredentialReference', reference]);
      return Object.freeze({ token: 'ephemeral-lookup-token' });
    },
    providerClient: Object.freeze({
      async perform() {
        calls.push(['perform']);
        throw new Error('reconciliation must not perform');
      },
      async lookup(input) {
        calls.push(['lookup', input.idempotencyKey, input.providerRequestId]);
        return Object.freeze({
          outcome: 'REMOTE_SUCCESS_PROVEN',
          providerRequestId: input.providerRequestId,
          providerReceiptId: 'provider-receipt-reconciled'
        });
      }
    })
  });

  const result = await adapter.reconcile(Object.freeze({
    ...attemptEnvelope(),
    providerRequestId: 'provider-request-lookup-1'
  }));
  assert.deepEqual(calls, [
    ['resolveCredentialReference', 'credential-ref-1'],
    ['lookup', 'idempotency-1', 'provider-request-lookup-1']
  ]);
  assert.equal(result.outcome, 'REMOTE_SUCCESS_PROVEN');
  assert.equal(result.providerReceiptId, 'provider-receipt-reconciled');
  assert.equal(Object.isFrozen(result), true);
});

test('M2-AI-005 durable model preparation persists execution then intent before any worker fork capability is touched', () => {
  const { prepareDurableModelExecution } = hostModule();
  assert.equal(typeof prepareDurableModelExecution, 'function');
  const calls = [];
  const result = prepareDurableModelExecution({
    operationKind: 'AI_PROVIDER_EXECUTION',
    idempotencyKey: 'model-execution-key-1',
    traceId: 'trace-1',
    command: Object.freeze({
      modelReference: 'model-ref-1',
      promptReference: 'prompt-ref-1',
      credentialReference: 'credential-ref-1'
    }),
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['createExecution', input.operationKind]);
        return Object.freeze({ executionId: 'execution-durable-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['createIntent', input.executionId, input.actionKind]);
        return Object.freeze({ intentId: 'intent-durable-1', executionId: input.executionId });
      }
    }),
    issueTimestamp(purpose) {
      calls.push(['issueTimestamp', purpose]);
      return purpose === 'durable-model-execution'
        ? '2026-08-03T18:00:00.000Z'
        : '2026-08-03T18:00:01.000Z';
    }
  });

  assert.deepEqual(calls, [
    ['issueTimestamp', 'durable-model-execution'],
    ['createExecution', 'AI_PROVIDER_EXECUTION'],
    ['issueTimestamp', 'durable-model-intent'],
    ['createIntent', 'execution-durable-1', 'AI_PROVIDER_EXECUTION']
  ]);
  assert.deepEqual(result, {
    executionId: 'execution-durable-1',
    intentId: 'intent-durable-1',
    operationKind: 'AI_PROVIDER_EXECUTION',
    idempotencyKey: 'model-execution-key-1'
  });
  assert.equal(Object.isFrozen(result), true);
});

test('M2-AI-006 model execution source orders durable execution and intent before worker fork and recognizes uncertain outcome', () => {
  const source = fs.readFileSync(hostPath, 'utf8');
  const prepareAt = source.indexOf('prepareDurableModelExecution(');
  const forkAt = source.indexOf('childProcessFactory(');
  assert.ok(prepareAt >= 0, 'prepareDurableModelExecution call missing');
  assert.ok(forkAt >= 0, 'worker fork missing');
  assert.ok(prepareAt < forkAt, 'durable execution and intent must be persisted before worker fork');
  assert.match(source, /UNCERTAIN_REMOTE_OUTCOME/u);
  assert.match(source, /attemptId/u);
  assert.match(source, /intentId/u);
});
