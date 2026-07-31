'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-ai-physical-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { JobQueue } = require('../services/jobQueue');
const { AiGateway } = require('../services/aiGateway');
const { closeStore } = require('../repositories/storeProvider');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

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
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('truthy hard termination without an exit receipt keeps physical capacity occupied', async () => {
  const queue = new JobQueue({
    concurrency: 1,
    name: `b39-truthy-termination-${Date.now()}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 1000
  });
  const first = queue.add(() => new Promise(() => {}), {
    providerKey: 'provider-a',
    executionTimeoutMs: 20,
    hardTerminate: () => true
  });

  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  await delay(30);
  assert.equal(queue.status().physicalInFlightCount, 1);
  assert.equal(queue.status().providerCircuits['provider-a'].zombies, 1);
});

test('mismatched execution exit receipt cannot release another physical slot', async () => {
  const queue = new JobQueue({
    concurrency: 1,
    name: `b39-mismatched-receipt-${Date.now()}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 1000
  });
  const first = queue.add(() => new Promise(() => {}), {
    providerKey: 'provider-a',
    executionTimeoutMs: 20,
    hardTerminate: () => ({
      terminated: true,
      executionId: 'different-execution',
      exitCode: 0,
      signal: ''
    })
  });

  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  await delay(30);
  assert.equal(queue.status().physicalInFlightCount, 1);
  assert.equal(queue.status().providerCircuits['provider-a'].zombies, 1);
});

test('matching verified exit receipt releases the physical slot', async () => {
  const queue = new JobQueue({
    concurrency: 1,
    name: `b39-matching-receipt-${Date.now()}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 1000
  });
  const first = queue.add(() => new Promise(() => {}), {
    providerKey: 'provider-a',
    executionTimeoutMs: 20,
    hardTerminate: ({ jobId }) => ({
      terminated: true,
      executionId: jobId,
      exitCode: null,
      signal: 'SIGTERM'
    })
  });

  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  await waitFor(() => queue.status().physicalInFlightCount === 0);
  assert.equal(queue.status().providerCircuits['provider-a']?.zombies || 0, 0);

  const second = queue.add(async () => 'next-ran', {
    providerKey: 'provider-b',
    executionTimeoutMs: 100
  });
  assert.equal(await second.promise, 'next-ran');
});

test('physical provider ownership follows the active fallback attempt', async () => {
  const queue = new JobQueue({
    concurrency: 1,
    name: `b39-provider-ownership-${Date.now()}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 1000
  });
  let queueExecutionId = '';
  const first = queue.add(async ({ jobId, updateProvider }) => {
    queueExecutionId = jobId;
    updateProvider('fallback-provider');
    return new Promise(() => {});
  }, {
    providerKey: 'primary-provider',
    executionTimeoutMs: 20,
    hardTerminate: ({ jobId }) => ({
      terminated: true,
      executionId: jobId,
      exitCode: 143,
      signal: ''
    })
  });

  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  assert.ok(queueExecutionId);
  await waitFor(() => queue.status().physicalInFlightCount === 0);
  assert.equal(queue.status().providerCircuits['primary-provider'], undefined);
  assert.equal(queue.status().physicalInFlightCount, 0);
  const persisted = queue.status().completed.find(row => row.id === queueExecutionId);
  assert.equal(persisted.errorCode, 'AI_EXECUTION_TIMEOUT');
});

test('hard termination receipt matches the bound child execution rather than the logical queue ID', async () => {
  const queue = new JobQueue({
    concurrency: 1,
    name: `b39-child-execution-identity-${Date.now()}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 1000
  });
  let terminationContext = null;
  const first = queue.add(async ({ bindExecution }) => {
    bindExecution({
      executionId: 'child-execution-1',
      providerKey: 'fallback-provider'
    });
    return new Promise(() => {});
  }, {
    providerKey: 'primary-provider',
    executionTimeoutMs: 20,
    hardTerminate: context => {
      terminationContext = context;
      return {
        terminated: true,
        executionId: context.executionId,
        exitCode: null,
        signal: 'SIGTERM'
      };
    }
  });

  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  await waitFor(() => queue.status().physicalInFlightCount === 0);
  assert.equal(terminationContext.executionId, 'child-execution-1');
  assert.equal(terminationContext.jobId === terminationContext.executionId, false);
});

test('model execution host resolves a result only after the isolated child exits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-model-host-result-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `
    'use strict';
    process.once('message', message => {
      process.send({
        type: 'result',
        executionId: message.executionId,
        result: { text: 'isolated-result', returnedModel: message.model.name }
      }, () => process.exit(0));
    });
  `, 'utf8');
  try {
    let startModelExecution;
    assert.doesNotThrow(() => {
      ({ startModelExecution } = require('../services/modelExecutionHost'));
    });
    const handle = startModelExecution({
      model: { id: 'model-a', name: 'model-a', provider: 'test' },
      messages: [{ role: 'user', content: 'hello' }],
      options: {},
      workerPath
    });
    const result = await handle.result;
    const receipt = await handle.exit;
    assert.deepEqual(result, { text: 'isolated-result', returnedModel: 'model-a' });
    assert.equal(receipt.executionId, handle.executionId);
    assert.equal(receipt.terminated, true);
    assert.equal(receipt.exitCode, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hard termination returns the matching child exit receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-model-host-terminate-'));
  const workerPath = path.join(root, 'worker.js');
  fs.writeFileSync(workerPath, `
    'use strict';
    process.once('message', () => {
      process.send({ type: 'started' });
      setInterval(() => {}, 1000);
    });
  `, 'utf8');
  try {
    let startModelExecution;
    assert.doesNotThrow(() => {
      ({ startModelExecution } = require('../services/modelExecutionHost'));
    });
    const handle = startModelExecution({
      model: { id: 'model-stuck', name: 'model-stuck', provider: 'test' },
      messages: [],
      options: {},
      workerPath,
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
    fs.rmSync(root, { recursive: true, force: true });
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
      completed: true,
      qualifyingTasks: ['translation']
    }
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
  const hostCalls = [];
  const providerUpdates = [];
  const gateway = new AiGateway({
    registry,
    startModelExecution(input) {
      hostCalls.push(input);
      return {
        executionId: 'isolated-execution-1',
        result: Promise.resolve({ text: 'isolated translation' }),
        exit: Promise.resolve({
          terminated: true,
          executionId: 'isolated-execution-1',
          exitCode: 0,
          signal: ''
        }),
        requestTermination: async () => ({
          terminated: true,
          executionId: 'isolated-execution-1',
          exitCode: null,
          signal: 'SIGTERM'
        })
      };
    }
  });

  const result = await gateway._run({
    jobId: 'gateway-job-1',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    options: {},
    signal: new AbortController().signal,
    updateProvider: providerKey => providerUpdates.push(providerKey)
  });

  assert.equal(result.text, 'isolated translation');
  assert.equal(hostCalls.length, 1);
  assert.equal(hostCalls[0].model.id, model.id);
  assert.deepEqual(providerUpdates, ['openrouter']);
});
