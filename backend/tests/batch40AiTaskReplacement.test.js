'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-ai-replacement-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const registry = require('../services/aiTaskRuntimeRegistry');
const { closeStore } = require('../repositories/storeProvider');

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('receipt mismatch blocks replacement and preserves the authoritative old generation', async () => {
  const taskId = 'b40-receipt-mismatch';
  const old = registry.start(taskId, {
    conversationId: 'conversation-receipt-mismatch',
    objectFingerprint: 'old-fingerprint',
    executionId: 'execution-old'
  });

  await assert.rejects(
    registry.replace(taskId, {
      conversationId: 'conversation-receipt-mismatch',
      objectFingerprint: 'new-fingerprint',
      executionId: 'execution-new',
      hardTerminate: async () => ({
        terminated: true,
        executionId: 'different-execution',
        exitCode: 0,
        signal: ''
      })
    }),
    error => error.code === 'AI_REPLACEMENT_BLOCKED'
      && error.retryable === true
      && error.reason === 'EXIT_RECEIPT_MISMATCH'
  );

  const status = registry.status();
  const current = status.tasks.find(task => task.taskId === taskId);
  assert.equal(current.generation, old.generation);
  assert.equal(current.objectFingerprint, 'old-fingerprint');
  assert.equal(current.executionId, 'execution-old');
  assert.equal(status.durable.operations.filter(operation =>
    operation.scopeKey === 'conversation-receipt-mismatch').length, 1);
});

test('termination timeout is bounded and leaves the old generation authoritative', async () => {
  const taskId = 'b40-termination-timeout';
  const old = registry.start(taskId, {
    conversationId: 'conversation-termination-timeout',
    objectFingerprint: 'timeout-old',
    executionId: 'execution-timeout-old'
  });
  const startedAt = Date.now();

  await assert.rejects(
    registry.replace(taskId, {
      conversationId: 'conversation-termination-timeout',
      objectFingerprint: 'timeout-new',
      executionId: 'execution-timeout-new',
      terminationTimeoutMs: 25,
      hardTerminate: async () => new Promise(() => {})
    }),
    error => error.code === 'AI_REPLACEMENT_BLOCKED'
      && error.reason === 'TERMINATION_TIMEOUT'
      && error.retryable === true
  );

  assert.ok(Date.now() - startedAt < 1000, 'replacement must not wait indefinitely');
  const current = registry.status().tasks.find(task => task.taskId === taskId);
  assert.equal(current.generation, old.generation);
  assert.equal(current.executionId, 'execution-timeout-old');
});

test('durable generation CAS rejection blocks replacement after verified exit', async () => {
  const taskId = 'b40-durable-cas-rejected';
  const old = registry.start(taskId, {
    conversationId: 'conversation-durable-cas-rejected',
    objectFingerprint: 'cas-old',
    executionId: 'execution-cas-old'
  });

  await assert.rejects(
    registry.replace(taskId, {
      conversationId: 'conversation-durable-cas-rejected',
      objectFingerprint: 'cas-new',
      executionId: 'execution-cas-new',
      hardTerminate: async () => ({
        terminated: true,
        executionId: 'execution-cas-old',
        exitCode: null,
        signal: 'SIGTERM'
      }),
      durableCancel: async entry => {
        assert.equal(entry.generation, old.generation);
        assert.equal(entry.objectFingerprint, 'cas-old');
        return { updated: false, reason: 'stale-generation' };
      }
    }),
    error => error.code === 'AI_REPLACEMENT_BLOCKED'
      && error.reason === 'DURABLE_CANCEL_REJECTED'
      && error.durableReason === 'stale-generation'
  );

  const current = registry.status().tasks.find(task => task.taskId === taskId);
  assert.equal(current.generation, old.generation);
  assert.equal(current.objectFingerprint, 'cas-old');
});

test('verified exit and durable CAS install one new generation and stale finish cannot delete it', async () => {
  const taskId = 'b40-successful-replacement';
  const order = [];
  const old = registry.start(taskId, {
    conversationId: 'conversation-successful-replacement',
    objectFingerprint: 'success-old',
    executionId: 'execution-success-old'
  });

  const replacement = await registry.replace(taskId, {
    conversationId: 'conversation-successful-replacement',
    objectFingerprint: 'success-new',
    executionId: 'execution-success-new',
    hardTerminate: async input => {
      order.push(`terminate:${input.executionId}`);
      return {
        terminated: true,
        executionId: input.executionId,
        exitCode: 0,
        signal: ''
      };
    },
    durableCancel: async entry => {
      order.push(`cancel:${entry.generation}:${entry.objectFingerprint}`);
      return { updated: true, reason: 'settled' };
    }
  });

  assert.deepEqual(order, [
    'terminate:execution-success-old',
    `cancel:${old.generation}:success-old`
  ]);
  assert.ok(replacement.generation > old.generation);
  assert.equal(registry.finish(taskId, old.generation), false);
  const current = registry.status().tasks.find(task => task.taskId === taskId);
  assert.equal(current.generation, replacement.generation);
  assert.equal(current.objectFingerprint, 'success-new');
  assert.equal(current.executionId, 'execution-success-new');
});

test('legacy start cannot bypass the replacement coordinator for an active task', () => {
  const taskId = 'b40-start-bypass';
  const old = registry.start(taskId, {
    conversationId: 'conversation-start-bypass',
    objectFingerprint: 'start-old',
    executionId: 'execution-start-old'
  });

  assert.throws(
    () => registry.start(taskId, {
      conversationId: 'conversation-start-bypass',
      objectFingerprint: 'start-new',
      executionId: 'execution-start-new'
    }),
    error => error.code === 'AI_REPLACEMENT_REQUIRED' && error.taskId === taskId
  );

  const current = registry.status().tasks.find(task => task.taskId === taskId);
  assert.equal(current.generation, old.generation);
  assert.equal(current.objectFingerprint, 'start-old');
  assert.equal(current.executionId, 'execution-start-old');
});
