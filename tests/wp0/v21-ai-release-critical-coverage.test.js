'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  AiGateway,
  assertExecutionCommitAllowed,
  resolveQueueTimeoutMs
} = require('../../backend/services/aiGateway');
const { normalizeTimeoutMs } = require('../../backend/services/modelTaskRuntimePolicy');
const runtimeRegistry = require('../../backend/services/aiTaskRuntimeRegistry');
const { ConversationTurnCoordinator } = require('../../backend/services/conversationTurnCoordinator');

function queueAdmissionFailureFixture() {
  const calls = [];
  let operation = null;
  const authority = {
    create(input) {
      calls.push(['create', input.operationId]);
      operation = {
        operationId: input.operationId,
        executionId: input.operationId,
        state: 'SCHEDULED',
        generation: 0,
        objectFingerprint: input.objectFingerprint
      };
      return { created: true, operation: { ...operation } };
    },
    read(operationId) {
      assert.equal(operationId, operation.operationId);
      return { ...operation };
    },
    start(operationId) {
      calls.push(['start', operationId]);
      assert.equal(operation.state, 'SCHEDULED');
      operation = { ...operation, state: 'RUNNING', generation: 1 };
      return { updated: true, operation: { ...operation } };
    },
    cancel(operationId, _receipt, options = {}) {
      calls.push(['cancel', operationId]);
      assert.equal(operation.state, 'RUNNING');
      assert.equal(options.generation, operation.generation);
      assert.equal(options.objectFingerprint, operation.objectFingerprint);
      operation = { ...operation, state: 'CANCELLED' };
      return { updated: true, operation: { ...operation } };
    },
    succeed() { throw new Error('queue-admission failure must not succeed'); },
    fail() { throw new Error('queue-admission failure must not fail after physical start'); }
  };
  const queue = {
    add() {
      const error = Object.assign(new Error('queue admission rejected'), {
        code: 'QUEUE_ADMISSION_FAILED'
      });
      return Object.freeze({ id: 'queue-rejected-1', promise: Promise.reject(error) });
    },
    cancel() { return false; },
    status() { return { pending: [], running: [], completed: [] }; }
  };
  return { authority, queue, calls, readOperation: () => ({ ...operation }) };
}

test('KF-P0-29 queue-admission failure terminalizes the already-persisted SCHEDULED AI operation', async () => {
  const fixture = queueAdmissionFailureFixture();
  const gateway = new AiGateway({
    queue: fixture.queue,
    internalOperationAuthorityProvider: () => fixture.authority
  });
  const { jobId } = gateway.submit({
    task: 'deep_reply',
    messages: [{ role: 'user', content: 'hello' }],
    context: { scopeKey: 'coverage:queue', generation: '1' }
  });

  await assert.rejects(
    () => gateway.waitForJob(jobId),
    error => error?.code === 'QUEUE_ADMISSION_FAILED'
  );
  assert.equal(fixture.readOperation().state, 'CANCELLED');
  assert.deepEqual(fixture.calls.map(row => row[0]), ['create', 'start', 'cancel']);
});

test('KF-P0-30/KF-P0-31 generation and fingerprint fences reject stale terminal/commit observations', () => {
  assert.throws(
    () => assertExecutionCommitAllowed({
      executionId: 'ai-execution-stale-1',
      expectedGeneration: 'generation-1',
      currentGeneration: 'generation-2'
    }),
    error => error?.code === 'AI_STALE_EXECUTION_RESULT'
      && error?.reason === 'GENERATION_SUPERSEDED'
  );
});

test('KF-P0-31 a newer inbound turn invalidates the captured turn and cancels the stale runtime generation', () => {
  const taskId = 'v21-coverage-stale-turn-task';
  const conversationId = 'v21-coverage-conversation';
  runtimeRegistry.finish(taskId);
  const runtime = runtimeRegistry.start(taskId, {
    conversationId,
    objectFingerprint: 'turn-fingerprint-1'
  });
  const bus = new EventEmitter();
  const coordinator = new ConversationTurnCoordinator({ eventBus: bus, clock: () => 1000 });
  coordinator.start();
  try {
    const captured = coordinator.capture(conversationId, 7);
    bus.emit('message:inserted', {
      payload: {
        message: {
          id: 'incoming-2',
          conversationId,
          direction: 'inbound',
          fromMe: false,
          type: 'text',
          text: 'newer turn'
        }
      }
    });

    assert.equal(coordinator.isCurrent(captured, 7), false);
    assert.throws(
      () => runtimeRegistry.assertCurrent(taskId, {
        generation: runtime.generation,
        objectFingerprint: runtime.objectFingerprint
      }),
      error => error?.code === 'NEW_INCOMING_MESSAGE'
    );
  } finally {
    coordinator.stop();
    runtimeRegistry.finish(taskId);
  }
});

test('KF-P1-07 deep reply timeout policy remains finite and bounded', () => {
  const queueBudget = resolveQueueTimeoutMs('deep_reply', {
    options: { timeoutMs: 300000 },
    background: false
  });
  assert.equal(Number.isFinite(queueBudget), true);
  assert.ok(queueBudget >= 300000);

  const runtimeBudget = normalizeTimeoutMs('deep_reply', Number.POSITIVE_INFINITY);
  assert.equal(Number.isFinite(runtimeBudget), true);
  assert.ok(runtimeBudget >= 240000);
  assert.ok(runtimeBudget <= 1200000);
});

test('KF-P0-30/KF-P0-31/KF-P1-07 existing AI_AUTO race, stale-turn and deterministic retry contracts execute successfully', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const relativePath of [
    'backend/tests/v21ProductAiAutoConversationP0.test.js',
    'backend/tests/v21ProductAiAutoRetryStorm.test.js'
  ]) {
    const absolutePath = path.join(repoRoot, relativePath);
    const child = spawnSync(process.execPath, [
      '--test',
      '--test-concurrency=1',
      absolutePath
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, NODE_ENV: 'test' }
    });
    assert.equal(
      child.status,
      0,
      `${relativePath} failed\n${child.stdout || ''}\n${child.stderr || ''}`
    );
  }
});
