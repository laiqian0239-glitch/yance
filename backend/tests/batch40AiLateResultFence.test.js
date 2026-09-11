'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const eventBus = require('../services/eventBus');
const { AiGateway } = require('../services/aiGateway');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function qualifiedModel(id) {
  const evidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95 };
  return {
    id,
    name: id,
    provider: 'openrouter',
    qualification: 'verified',
    available: true,
    userDisabled: false,
    allowedTasks: ['translation'],
    lastCommercialBenchmark: evidence,
    roleQualificationReceipts: { translation: roleReceipts.issueFromEvidence({ modelId: id, task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' }) }
  };
}

// Schema 23 requires a frozen RUNNING AI_PROVIDER_EXECUTION operation before
// Model Brain physical execution is allowed to commit.
function makePersistedOperation(overrides = {}) {
  return Object.freeze({
    operationKind: 'AI_PROVIDER_EXECUTION',
    state: 'RUNNING',
    operationId: overrides.operationId || 'op-b40-001',
    executionId: overrides.executionId || 'exec-b40-001',
    ownerId: overrides.ownerId || 'owner-b40-001',
    claimId: overrides.claimId || 'claim-b40-001',
    leaseExpiresAt: overrides.leaseExpiresAt || new Date(Date.now() + 60000).toISOString(),
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1
  });
}

test('a primary model result resolving after cancellation has no success side effects', async t => {
  const model = qualifiedModel('batch40-primary');
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const completed = [];
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        started.resolve();
        return invocation.promise;
      }
    }
  });
  const onComplete = event => completed.push(event);
  eventBus.on('ai:job-complete', onComplete);
  t.after(() => eventBus.off('ai:job-complete', onComplete));

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-primary-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal,
    persistedOperation: makePersistedOperation({ operationId: 'batch40-primary-op', executionId: 'batch40-primary-job' })
  });
  await started.promise;
  const reason = Object.assign(new Error('cancelled by newer work'), { code: 'MODEL_CANCELLED' });
  controller.abort(reason);
  invocation.resolve({ text: 'late success' });

  await assert.rejects(running, error => {
    assert.equal(error.code, 'AI_STALE_EXECUTION_RESULT');
    assert.equal(error.executionId, 'batch40-primary-job');
    assert.equal(error.reason, 'MODEL_CANCELLED');
    return true;
  });
  assert.deepEqual(successCalls, []);
  assert.equal(completed.length, 0);
});

test('cancellation while physical execution is awaiting blocks completion and success return', async t => {
  const model = qualifiedModel('batch40-ledger-fence');
  const execStarted = deferred();
  const execRelease = deferred();
  const completed = [];
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        execStarted.resolve();
        await execRelease.promise;
        return { text: 'success-before-commit' };
      }
    }
  });
  const onComplete = event => completed.push(event);
  eventBus.on('ai:job-complete', onComplete);
  t.after(() => eventBus.off('ai:job-complete', onComplete));

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-ledger-fence-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal,
    persistedOperation: makePersistedOperation({ operationId: 'batch40-ledger-op', executionId: 'batch40-ledger-fence-job' })
  });
  await execStarted.promise;
  controller.abort(Object.assign(new Error('superseded during physical execution'), {
    code: 'MODEL_CANCELLED'
  }));
  execRelease.resolve();

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.equal(completed.length, 0);
});

test('a stream-shaped execution cancelled mid-flight is fenced at the result commit', async () => {
  const model = qualifiedModel('batch40-stream-fence');
  const controller = new AbortController();
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  let physicalExecutions = 0;
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        physicalExecutions += 1;
        controller.abort(Object.assign(new Error('stream superseded'), { code: 'MODEL_CANCELLED' }));
        return { text: 'firstlate' };
      }
    }
  });

  await assert.rejects(gateway._run({
    jobId: 'batch40-stream-fence-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal,
    persistedOperation: makePersistedOperation({ operationId: 'batch40-stream-op', executionId: 'batch40-stream-fence-job' })
  }), { code: 'AI_STALE_EXECUTION_RESULT' });
  // Physical execution did happen once, but its late result is refused at commit.
  assert.equal(physicalExecutions, 1);
});

test('a late model result resolving after cancellation has no success side effects', async t => {
  const model = qualifiedModel('batch40-late-secondary');
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const completed = [];
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        started.resolve();
        return invocation.promise;
      }
    }
  });
  const onComplete = event => completed.push(event);
  eventBus.on('ai:job-complete', onComplete);
  t.after(() => eventBus.off('ai:job-complete', onComplete));

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-late-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal,
    persistedOperation: makePersistedOperation({ operationId: 'batch40-late-op', executionId: 'batch40-late-job' })
  });
  await started.promise;
  controller.abort(Object.assign(new Error('superseded'), { code: 'MODEL_CANCELLED' }));
  invocation.resolve({ text: 'late success' });

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.deepEqual(successCalls, []);
  assert.equal(completed.length, 0);
});

test('a context-reduced execution resolving after cancellation has no success side effects', async t => {
  const model = {
    ...qualifiedModel('batch40-context-reduction'),
    allowedTasks: ['understanding'],
    capabilityTags: ['relationship_reasoning', 'json_schema_strict']
  };
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const completed = [];
  const registry = {
    read: () => ({ models: [model], routes: { understanding: { enabled: true, primary: model.id } } }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        started.resolve();
        return invocation.promise;
      }
    }
  });
  const onComplete = event => completed.push(event);
  eventBus.on('ai:job-complete', onComplete);
  t.after(() => eventBus.off('ai:job-complete', onComplete));

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-context-reduction-job',
    task: 'understanding',
    messages: [{ role: 'user', content: 'x'.repeat(7000) }],
    signal: controller.signal,
    persistedOperation: makePersistedOperation({ operationId: 'batch40-context-op', executionId: 'batch40-context-reduction-job' })
  });
  await started.promise;
  controller.abort(Object.assign(new Error('deadline expired'), { code: 'AI_EXECUTION_TIMEOUT' }));
  invocation.resolve({ text: 'late reduced success' });

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.deepEqual(successCalls, []);
  assert.equal(completed.length, 0);
});

test('a result from a superseded generation is rejected even when its signal is not aborted', async () => {
  const model = qualifiedModel('batch40-generation-model');
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const scopeKey = 'batch40-generation-scope';
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async (...args) => successCalls.push(['failure', ...args])
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        started.resolve();
        return invocation.promise;
      }
    }
  });

  const running = gateway._run({
    jobId: 'batch40-generation-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: new AbortController().signal,
    context: { scopeKey, generation: 'generation-1' },
    persistedOperation: makePersistedOperation({ operationId: 'batch40-generation-op', executionId: 'batch40-generation-job' })
  });
  await started.promise;
  // A newer generation registers itself as the current authority for this scope.
  gateway.latestContextGenerations.set(scopeKey, 'generation-2');
  invocation.resolve({ text: 'late generation success' });

  await assert.rejects(running, error => {
    assert.equal(error.code, 'AI_STALE_EXECUTION_RESULT');
    assert.equal(error.reason, 'GENERATION_SUPERSEDED');
    return true;
  });
  assert.deepEqual(successCalls, []);
});

test('a missing current generation authority cannot authorize an expected generation', async () => {
  const model = qualifiedModel('batch40-missing-authority-model');
  const successCalls = [];
  const scopeKey = 'batch40-missing-authority-scope';
  const registry = {
    read: () => ({ models: [model], routes: { translation: { enabled: true, primary: model.id } } }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async (...args) => successCalls.push(['failure', ...args])
  };
  const gateway = new AiGateway({
    registry,
    runtime: {
      execute: async () => {
        throw new Error('physical execution must not start when the generation authority cannot authorize');
      }
    }
  });
  // The live authority already points at a generation that is not the expected one.
  gateway.latestContextGenerations.set(scopeKey, 'generation-stale');

  await assert.rejects(gateway._run({
    jobId: 'batch40-missing-authority-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: new AbortController().signal,
    context: { scopeKey, generation: 'generation-1' },
    persistedOperation: makePersistedOperation({ operationId: 'batch40-missing-op', executionId: 'batch40-missing-authority-job' })
  }), { code: 'AI_STALE_EXECUTION_RESULT', reason: 'GENERATION_SUPERSEDED' });
  assert.deepEqual(successCalls, []);
});
