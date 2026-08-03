'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
    ownerId: 'owner-1',
    claimId: 'claim-1',
    generation: 1,
    hostGeneration: 7,
    fencingToken: 11,
    leaseExpiresAt: '2026-08-04T02:00:00.000Z',
    request,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request'))
  });
}

function fakeUncertainChildFactory(observe) {
  return () => {
    observe.forkCount += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 5151;
    child.connected = true;
    child.send = message => {
      observe.messages.push(message);
      if (message.type !== 'execute') return;
      queueMicrotask(() => {
        child.emit('message', {
          type: 'provider-request',
          executionId: message.envelope.executionId,
          providerRequestId: 'provider-request-uncertain-1'
        });
        child.connected = false;
        child.emit('exit', 1, null);
      });
    };
    child.kill = () => true;
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
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

test('M2-AI-005 durable model preparation persists execution then intent before any physical capability is touched', () => {
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
        ? '2026-08-04T01:00:00.000Z'
        : '2026-08-04T01:00:01.000Z';
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

test('M2-AI-006 durable model start persists execution, intent, claims and attempt before Adapter perform', async () => {
  const { startDurableModelExecution } = hostModule();
  assert.equal(typeof startDurableModelExecution, 'function');
  const calls = [];
  let timestampSequence = 0;
  const issueTimestamp = purpose => {
    calls.push(['issueTimestamp', purpose]);
    timestampSequence += 1;
    return `2026-08-04T01:10:${String(timestampSequence).padStart(2, '0')}.000Z`;
  };
  const durableExecutionAuthority = Object.freeze({
    createExecution(input) {
      calls.push(['createExecution', input.operationKind]);
      return Object.freeze({ executionId: 'execution-durable-2', state: 'CREATED', stateVersion: 0, generation: 0 });
    },
    schedule(input) {
      calls.push(['scheduleExecution', input.executionId, input.hostGeneration, input.fencingToken]);
      return Object.freeze({ executionId: input.executionId, state: 'SCHEDULED', stateVersion: 1, generation: 0 });
    },
    claim(input) {
      calls.push(['claimExecution', input.executionId, input.claimId, input.hostGeneration, input.fencingToken]);
      return Object.freeze({
        executionId: input.executionId,
        state: 'CLAIMED',
        stateVersion: 2,
        generation: 1,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken,
        leaseExpiresAt: input.leaseExpiresAt
      });
    }
  });
  const outboxAuthority = Object.freeze({
    createIntent(input) {
      calls.push(['createIntent', input.executionId, input.actionKind]);
      return Object.freeze({
        intentId: 'intent-durable-2',
        executionId: input.executionId,
        actionKind: input.actionKind,
        idempotencyKey: input.idempotencyKey,
        claim: Object.freeze({ state: 'READY', stateVersion: 0, generation: 0 })
      });
    },
    claimIntent(input) {
      calls.push(['claimIntent', input.intentId, input.claimId, input.hostGeneration, input.fencingToken]);
      return Object.freeze({
        intentId: input.intentId,
        executionId: 'execution-durable-2',
        actionKind: 'AI_PROVIDER_EXECUTION',
        idempotencyKey: 'model-execution-key-2',
        claim: Object.freeze({
          state: 'CLAIMED',
          stateVersion: 1,
          generation: 1,
          ownerId: input.ownerId,
          claimId: input.claimId,
          hostGeneration: input.hostGeneration,
          fencingToken: input.fencingToken,
          leaseExpiresAt: input.leaseExpiresAt
        })
      });
    },
    startAttempt(input) {
      calls.push(['startAttempt', input.intentId, input.claimId, input.request.modelReference]);
      return Object.freeze({
        attemptId: 'attempt-durable-2',
        intentId: input.intentId,
        stateVersion: 2,
        generation: input.generation,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken
      });
    },
    recordReceipt(input) {
      calls.push(['recordReceipt', input.intentId, input.attemptId, input.providerReceiptId]);
      return Object.freeze({ receiptId: 'receipt-durable-2', receiptType: 'SUCCESS' });
    },
    recordFailureReceipt() {
      throw new Error('unexpected failure receipt');
    },
    markUncertain() {
      throw new Error('unexpected uncertain receipt');
    }
  });
  const adapter = Object.freeze({
    operationKind: 'AI_PROVIDER_EXECUTION',
    async perform(envelope) {
      calls.push(['adapterPerform', envelope.executionId, envelope.intentId, envelope.attemptId]);
      assert.equal(envelope.idempotencyKey, 'model-execution-key-2');
      assert.equal(envelope.claimId, 'claim-durable-2');
      assert.equal(envelope.generation, 1);
      assert.equal(envelope.hostGeneration, 7);
      assert.equal(envelope.fencingToken, 11);
      assert.equal(Object.isFrozen(envelope), true);
      return Object.freeze({
        providerRequestId: 'provider-request-durable-2',
        providerReceiptId: 'provider-receipt-durable-2',
        evidenceReference: 'provider-evidence-durable-2',
        accepted: true
      });
    },
    async reconcile() {
      throw new Error('reconciliation not expected');
    }
  });

  const handle = startDurableModelExecution({
    operationKind: 'AI_PROVIDER_EXECUTION',
    idempotencyKey: 'model-execution-key-2',
    traceId: 'trace-2',
    command: Object.freeze({
      modelReference: 'model-ref-2',
      promptReference: 'prompt-ref-2',
      credentialReference: 'credential-ref-2'
    }),
    request: Object.freeze({
      modelReference: 'model-ref-2',
      promptReference: 'prompt-ref-2',
      credentialReference: 'credential-ref-2',
      requestContentSha256: 'b'.repeat(64)
    }),
    ownerId: 'owner-durable-2',
    claimId: 'claim-durable-2',
    hostId: 'write-host-2',
    hostGeneration: 7,
    fencingToken: 11,
    leaseExpiresAt: '2026-08-04T01:30:00.000Z',
    durableExecutionAuthority,
    outboxAuthority,
    adapter,
    issueTimestamp
  });

  assert.equal(handle.executionId, 'execution-durable-2');
  assert.equal(handle.intentId, 'intent-durable-2');
  const receipt = await handle.result;
  assert.equal(receipt.receiptId, 'receipt-durable-2');
  const performAt = calls.findIndex(row => row[0] === 'adapterPerform');
  for (const required of ['createExecution', 'createIntent', 'scheduleExecution', 'claimExecution', 'claimIntent', 'startAttempt']) {
    const index = calls.findIndex(row => row[0] === required);
    assert.ok(index >= 0 && index < performAt, `${required} must precede Adapter perform`);
  }
});

test('M2-AI-007 low-level worker host rejects missing persisted attempt identity before resolver or fork', () => {
  const { startModelExecution } = hostModule();
  const observe = { forkCount: 0, resolverCount: 0 };
  assert.throws(
    () => startModelExecution({
      model: Object.freeze({ id: 'model-direct-1' }),
      messages: Object.freeze([]),
      resolveExecutionSpec() {
        observe.resolverCount += 1;
        return Object.freeze({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434', modelName: 'model' });
      },
      childProcessFactory() {
        observe.forkCount += 1;
        throw new Error('fork must not be reached');
      }
    }),
    error => error?.code === 'WP_B_MODEL_EXECUTION_PERSISTED_ATTEMPT_REQUIRED'
  );
  assert.equal(observe.resolverCount, 0);
  assert.equal(observe.forkCount, 0);
});

test('M2-AI-008 provider acceptance followed by worker exit is an uncertain remote outcome, never ordinary retryable failure', async () => {
  const { startModelExecution } = hostModule();
  const observe = { forkCount: 0, messages: [] };
  const handle = startModelExecution({
    persistedAttempt: attemptEnvelope({
      executionId: 'execution-uncertain-1',
      intentId: 'intent-uncertain-1',
      attemptId: 'attempt-uncertain-1'
    }),
    executionId: 'execution-uncertain-1',
    correlationId: 'correlation-uncertain-1',
    task: 'translation',
    model: Object.freeze({ id: 'model-uncertain-1' }),
    messages: Object.freeze([]),
    childProcessFactory: fakeUncertainChildFactory(observe),
    resolveExecutionSpec: () => Object.freeze({
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      modelName: 'model-uncertain-1',
      modelId: 'model-uncertain-1'
    }),
    readSystemPolicy: () => Object.freeze({
      emergencyStop: false,
      privacyMode: false,
      operatingModeAuthority: 'test',
      sourceVersion: 1
    }),
    now: () => new Date('2026-08-04T01:20:00.000Z')
  });

  await assert.rejects(
    handle.result,
    error => error?.code === 'UNCERTAIN_REMOTE_OUTCOME'
      && error?.remoteOutcomeUnknown === true
      && error?.attemptId === 'attempt-uncertain-1'
      && error?.intentId === 'intent-uncertain-1'
  );
  const exit = await handle.exit;
  assert.equal(exit.terminationClass, 'uncertain-remote-outcome');
  assert.equal(exit.terminationReason, 'UNCERTAIN_REMOTE_OUTCOME');
  assert.equal(exit.providerRequestId, 'provider-request-uncertain-1');
  assert.equal(observe.forkCount, 1);
});
