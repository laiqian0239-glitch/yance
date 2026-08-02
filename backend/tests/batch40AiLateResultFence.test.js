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

test('a primary model result resolving after cancellation has no success side effects', async t => {
  const model = qualifiedModel('batch40-primary');
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const completed = [];
  const stale = [];
  const registry = {
    read: () => ({
      models: [model],
      routes: { translation: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => {
      started.resolve();
      return invocation.promise;
    }
  });
  t.mock.method(gateway, 'noteSuccess', modelId => successCalls.push(['noteSuccess', modelId]));
  const onComplete = event => completed.push(event);
  const onStale = event => stale.push(event);
  eventBus.on('ai:job-complete', onComplete);
  eventBus.on('ai:stale-execution-result', onStale);
  t.after(() => {
    eventBus.off('ai:job-complete', onComplete);
    eventBus.off('ai:stale-execution-result', onStale);
  });

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-primary-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal
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
  assert.equal(stale.length, 1);
  assert.equal(stale[0].payload.executionId, 'batch40-primary-job');
  assert.equal(stale[0].payload.reason, 'MODEL_CANCELLED');
});

test('cancellation while the invocation ledger is awaiting blocks completion and success return', async t => {
  const model = qualifiedModel('batch40-ledger-fence');
  const ledgerStarted = deferred();
  const ledgerRelease = deferred();
  const completed = [];
  const registry = {
    read: () => ({
      models: [model],
      routes: { translation: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async () => {
      ledgerStarted.resolve();
      await ledgerRelease.promise;
    },
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => ({ text: 'success-before-ledger-await' })
  });
  const onComplete = event => completed.push(event);
  eventBus.on('ai:job-complete', onComplete);
  t.after(() => eventBus.off('ai:job-complete', onComplete));

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-ledger-fence-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal
  });
  await ledgerStarted.promise;
  controller.abort(Object.assign(new Error('superseded during ledger write'), {
    code: 'MODEL_CANCELLED'
  }));
  ledgerRelease.resolve();

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.equal(completed.length, 0);
});

test('stream tokens are fenced after cancellation before reaching the caller', async () => {
  const model = qualifiedModel('batch40-stream-fence');
  const tokens = [];
  const controller = new AbortController();
  const registry = {
    read: () => ({
      models: [model],
      routes: { translation: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async (_model, _messages, options) => {
      options.onToken('first');
      controller.abort(Object.assign(new Error('stream superseded'), { code: 'MODEL_CANCELLED' }));
      options.onToken('late');
      return { text: 'firstlate' };
    }
  });

  await assert.rejects(gateway._run({
    jobId: 'batch40-stream-fence-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal,
    options: { onToken: token => tokens.push(token) }
  }), { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.deepEqual(tokens, ['first']);
});

test('a fallback result resolving after cancellation has no success side effects', async t => {
  const primary = qualifiedModel('batch40-fallback-primary');
  const fallback = qualifiedModel('batch40-fallback-secondary');
  primary.modelSlug = 'anthropic/claude-opus-5';
  fallback.modelSlug = 'openai/gpt-5.6-sol';
  const invocation = deferred();
  const fallbackStarted = deferred();
  const successCalls = [];
  const completed = [];
  const stale = [];
  let attempt = 0;
  const registry = {
    read: () => ({
      models: [primary, fallback],
      routes: {
        translation: {
          enabled: true,
          primary: primary.id,
          fallback: fallback.id
        }
      }
    }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('primary unavailable'), { code: 'MODEL_NETWORK_ERROR' });
      fallbackStarted.resolve();
      return invocation.promise;
    }
  });
  t.mock.method(gateway, 'noteSuccess', modelId => successCalls.push(['noteSuccess', modelId]));
  const onComplete = event => completed.push(event);
  const onStale = event => stale.push(event);
  eventBus.on('ai:job-complete', onComplete);
  eventBus.on('ai:stale-execution-result', onStale);
  t.after(() => {
    eventBus.off('ai:job-complete', onComplete);
    eventBus.off('ai:stale-execution-result', onStale);
  });

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-fallback-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: controller.signal
  });
  await fallbackStarted.promise;
  controller.abort(Object.assign(new Error('superseded'), { code: 'MODEL_CANCELLED' }));
  invocation.resolve({ text: 'late fallback success' });

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.deepEqual(successCalls, []);
  assert.equal(completed.length, 0);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].payload.executionId, 'batch40-fallback-job');
});

test('a context-reduced retry resolving after cancellation has no success side effects', async t => {
  const model = {
    ...qualifiedModel('batch40-context-reduction'),
    allowedTasks: ['understanding'],
    capabilityTags: ['relationship_reasoning', 'json_schema_strict']
  };
  const invocation = deferred();
  const retryStarted = deferred();
  const successCalls = [];
  const completed = [];
  const stale = [];
  let attempt = 0;
  const registry = {
    read: () => ({
      models: [model],
      routes: { understanding: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('model timeout'), { code: 'MODEL_TIMEOUT' });
      retryStarted.resolve();
      return invocation.promise;
    }
  });
  t.mock.method(gateway, 'noteSuccess', modelId => successCalls.push(['noteSuccess', modelId]));
  const onComplete = event => completed.push(event);
  const onStale = event => stale.push(event);
  eventBus.on('ai:job-complete', onComplete);
  eventBus.on('ai:stale-execution-result', onStale);
  t.after(() => {
    eventBus.off('ai:job-complete', onComplete);
    eventBus.off('ai:stale-execution-result', onStale);
  });

  const controller = new AbortController();
  const running = gateway._run({
    jobId: 'batch40-context-reduction-job',
    task: 'understanding',
    messages: [{ role: 'user', content: 'x'.repeat(7000) }],
    signal: controller.signal
  });
  await retryStarted.promise;
  controller.abort(Object.assign(new Error('deadline expired'), { code: 'AI_EXECUTION_TIMEOUT' }));
  invocation.resolve({ text: 'late reduced success' });

  await assert.rejects(running, { code: 'AI_STALE_EXECUTION_RESULT' });
  assert.deepEqual(successCalls, []);
  assert.equal(completed.length, 0);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].payload.executionId, 'batch40-context-reduction-job');
});

test('a result from a superseded generation is rejected even when its signal is not aborted', async t => {
  const model = qualifiedModel('batch40-generation-model');
  const invocation = deferred();
  const started = deferred();
  const successCalls = [];
  const stale = [];
  let currentGeneration = 'generation-1';
  const registry = {
    read: () => ({
      models: [model],
      routes: { translation: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async (...args) => successCalls.push(['failure', ...args])
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => {
      started.resolve();
      return invocation.promise;
    }
  });
  t.mock.method(gateway, 'noteSuccess', modelId => successCalls.push(['noteSuccess', modelId]));
  const onStale = event => stale.push(event);
  eventBus.on('ai:stale-execution-result', onStale);
  t.after(() => eventBus.off('ai:stale-execution-result', onStale));

  const running = gateway._run({
    jobId: 'batch40-generation-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: new AbortController().signal,
    expectedGeneration: 'generation-1',
    currentGeneration: () => currentGeneration
  });
  await started.promise;
  currentGeneration = 'generation-2';
  invocation.resolve({ text: 'late generation success' });

  await assert.rejects(running, error => {
    assert.equal(error.code, 'AI_STALE_EXECUTION_RESULT');
    assert.equal(error.reason, 'GENERATION_SUPERSEDED');
    return true;
  });
  assert.deepEqual(successCalls, []);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].payload.reason, 'GENERATION_SUPERSEDED');
});

test('a missing current generation authority cannot authorize an expected generation', async () => {
  const model = qualifiedModel('batch40-missing-authority-model');
  const successCalls = [];
  const registry = {
    read: () => ({
      models: [model],
      routes: { translation: { enabled: true, primary: model.id } }
    }),
    recordInvocation: async (...args) => successCalls.push(args),
    recordInvocationFailure: async (...args) => successCalls.push(['failure', ...args])
  };
  const gateway = new AiGateway({
    registry,
    executeModel: async () => ({ text: 'unauthorized success' })
  });

  await assert.rejects(gateway._run({
    jobId: 'batch40-missing-authority-job',
    task: 'translation',
    messages: [{ role: 'user', content: 'Hallo' }],
    signal: new AbortController().signal,
    expectedGeneration: 'generation-1',
    currentGeneration: ''
  }), { code: 'AI_STALE_EXECUTION_RESULT', reason: 'GENERATION_SUPERSEDED' });
  assert.deepEqual(successCalls, []);
});
