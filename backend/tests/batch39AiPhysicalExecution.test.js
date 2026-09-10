'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-ai-physical-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { AiGateway } = require('../services/aiGateway');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const { closeStore } = require('../repositories/storeProvider');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { createSqliteConnectionBroker, resetSqliteConnectionBrokerForTests } = require('../lib/sqliteConnectionBroker');
const { closeR32Store } = require('../lib/r32StoreSingleton');

process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({ dbPath, instanceId: `b39-ai-physical-${process.pid}` });
createSqliteConnectionBroker({ dbPath, authorityWriteHostCapability: authorityWriteHost.capability });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep(value[key]);
  }
  return value;
}

function makePersistedAttempt(overrides = {}) {
  return freezeDeep({
    executionId: overrides.executionId || 'exec-b39-001',
    intentId: overrides.intentId || 'intent-b39-001',
    attemptId: overrides.attemptId || 'attempt-b39-001',
    idempotencyKey: overrides.idempotencyKey || 'idem-b39-001',
    ownerId: overrides.ownerId || 'owner-b39-001',
    claimId: overrides.claimId || 'claim-b39-001',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    leaseExpiresAt: overrides.leaseExpiresAt || new Date(Date.now() + 60000).toISOString(),
    request: overrides.request || { task: 'translation' }
  });
}

function makePersistedOperation(overrides = {}) {
  return Object.freeze({
    operationKind: 'AI_PROVIDER_EXECUTION',
    state: 'RUNNING',
    operationId: overrides.operationId || 'op-b39-001',
    executionId: overrides.executionId || 'exec-b39-001',
    ownerId: overrides.ownerId || 'owner-b39-001',
    claimId: overrides.claimId || 'claim-b39-001',
    leaseExpiresAt: overrides.leaseExpiresAt || new Date(Date.now() + 60000).toISOString(),
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await delay(5);
  }
}

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  try { closeStore(); } catch (_) {}
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('model execution host resolves a result only after the isolated child exits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-model-host-result-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `
    'use strict';
    process.once('message', message => {
      const executionId = message.envelope.executionId;
      process.send({
        type: 'result',
        executionId,
        result: { text: 'isolated-result', returnedModel: message.envelope.executionSpec.modelName }
      }, () => process.exit(0));
    });
  `, 'utf8');
  try {
    let startModelExecution;
    assert.doesNotThrow(() => {
      ({ startModelExecution } = require('../services/modelExecutionHost'));
    });
    const handle = startModelExecution({
      model: { id: 'model-a', name: 'model-a', provider: 'ollama' },
      task: 'translation',
      messages: [{ role: 'user', content: 'hello' }],
      options: {},
      persistedAttempt: makePersistedAttempt({
        executionId: 'exec-b39-result-001',
        request: { task: 'translation', modelName: 'model-a' }
      }),
      childProcessFactory: (_productionPath, args, options) => fork(workerPath, args, options)
    });
    const result = await handle.result;
    const receipt = await handle.exit;
    assert.deepEqual(result, { text: 'isolated-result', returnedModel: 'model-a' });
    assert.equal(receipt.executionId, handle.executionId);
    assert.equal(receipt.terminated, false);
    assert.equal(receipt.terminationClass, 'completed');
    assert.equal(receipt.exitCode, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('hard termination returns the matching child exit receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-model-host-terminate-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `
    'use strict';
    process.once('message', message => {
      process.send({ type: 'started', executionId: message.envelope.executionId });
      setInterval(() => {}, 1000);
    });
  `, 'utf8');
  try {
    let startModelExecution;
    assert.doesNotThrow(() => {
      ({ startModelExecution } = require('../services/modelExecutionHost'));
    });
    const handle = startModelExecution({
      model: { id: 'model-stuck', name: 'model-stuck', provider: 'ollama' },
      task: 'translation',
      messages: [],
      options: {},
      persistedAttempt: makePersistedAttempt({
        executionId: 'exec-b39-terminate-001',
        request: { task: 'translation', modelName: 'model-stuck' }
      }),
      childProcessFactory: (_productionPath, args, options) => fork(workerPath, args, options),
      terminationGraceMs: 20
    });
    await handle.started;
    const receipt = await handle.requestTermination('test-timeout');
    assert.equal(receipt.executionId, handle.executionId);
    assert.equal(receipt.terminated, true);
    assert.equal(
      Number.isInteger(receipt.exitCode) || Boolean(receipt.signal),
      true
    );
    await assert.rejects(handle.result, error => error.code === 'MODEL_EXECUTION_TERMINATED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('production AiGateway attempts execute through the isolated host and update provider ownership', async () => {
  const model = {
    id: 'translation-provider-model',
    name: 'translation-provider-model',
    provider: 'openrouter',
    qualification: 'verified',
    available: true,
    userDisabled: false,
    allowedTasks: ['translation'],
    lastCommercialBenchmark: {
      authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z',
      completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95
    }
  };
  model.roleQualificationReceipts = {
    translation: roleReceipts.issueFromEvidence({ modelId: model.id, task: 'translation', evidence: model.lastCommercialBenchmark, expiresAt: '2030-01-01T00:00:00.000Z' })
  };
  const registry = {
    read: () => ({
      models: [model],
      routes: {
        translation: {
          enabled: true,
          primary: model.id
        }
      }
    }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const runtimeCalls = [];
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute(payload) {
        runtimeCalls.push(payload);
        return Promise.resolve({ text: 'isolated translation', evidence: {} });
      }
    }
  });

  const result = await gateway._run({
    jobId: 'gateway-job-1',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    options: {},
    signal: new AbortController().signal,
    persistedOperation: makePersistedOperation({
      operationId: 'op-b39-gateway-001',
      executionId: 'exec-b39-gateway-001'
    })
  });

  assert.equal(result.text, 'isolated translation');
  assert.equal(runtimeCalls.length, 1);
  assert.equal(runtimeCalls[0].catalog[0].id, model.id);
  assert.equal(runtimeCalls[0].requestId, 'gateway-job-1');
});
