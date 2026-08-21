'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const modelBrainProjection = require('../services/modelBrainProjection');
const modelStatusProjection = require('../services/modelStatusProjection');
const ollamaClient = require('../services/ollamaClient');
const { AiGateway } = require('../services/aiGateway');

const FORMAL_REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director']);

function qualifiedModel({ id, provider, endpoint, tasks, benchmark = null }) {
  return {
    id,
    name: id,
    modelName: id,
    provider,
    endpoint,
    enabled: true,
    available: true,
    qualification: 'verified',
    allowedTasks: [...tasks],
    capabilities: { modalities: ['text'], languages: ['multilingual'] },
    ...(benchmark ? { lastCommercialBenchmark: benchmark } : {})
  };
}

function commercialBenchmark(tasks) {
  return {
    schemaVersion: 1,
    authority: 'YanceCommercialModelBenchmark',
    completed: true,
    pass: true,
    status: 'COMMERCIAL_MODEL_QUALIFIED',
    score: 92,
    testedAt: new Date(0).toISOString(),
    qualifyingTasks: [...tasks],
    scenarios: [{ id: 'evidence', task: tasks[0], pass: true, metrics: { totalMs: 1200, outputTokens: 64 } }]
  };
}

function runtimeSnapshot() {
  return {
    health: 'healthy',
    runtimeAvailable: true,
    complexityRouter: 'ComplexityRouter',
    strictTagFiltering: { enabled: true, matchAny: false },
    lastEvidence: null
  };
}

test('formal quick/deep/director projection is cloud-only even when qualified local or remote-host Ollama models have matching task tags', () => {
  for (const task of FORMAL_REPLY_TASKS) {
    const state = {
      models: [
        qualifiedModel({
          id: `local-${task}`,
          provider: 'ollama',
          endpoint: 'http://127.0.0.1:11434',
          tasks: [task]
        }),
        qualifiedModel({
          id: `remote-ollama-${task}`,
          provider: 'ollama',
          endpoint: 'http://ollama.internal:11434',
          tasks: [task]
        }),
        qualifiedModel({
          id: `cloud-${task}`,
          provider: 'openrouter',
          endpoint: 'https://openrouter.ai/api/v1',
          tasks: [task]
        })
      ]
    };

    const projection = modelBrainProjection.project(state, { task });
    assert.ok(projection.tags.includes('source:cloud'), `${task} must materialize source:cloud as a hard constraint`);
    assert.deepEqual(
      projection.candidates.map(row => row.sourceType),
      ['cloud'],
      `${task} must never admit an Ollama deployment into formal reply authority`
    );
    assert.deepEqual(projection.candidates.map(row => row.provider), ['openrouter']);
  }
});

test('local auxiliary candidates require commercial benchmark/SLA evidence for the exact background task', () => {
  const withoutBenchmark = qualifiedModel({
    id: 'local-understanding',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    tasks: ['understanding']
  });
  const noEvidenceProjection = modelBrainProjection.project({ models: [withoutBenchmark] }, { task: 'understanding' });
  assert.equal(noEvidenceProjection.candidates.length, 0, 'qualification + task tag alone must not admit local auxiliary work');

  const withBenchmark = qualifiedModel({
    id: 'local-understanding',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    tasks: ['understanding'],
    benchmark: commercialBenchmark(['understanding'])
  });
  const admitted = modelBrainProjection.project({ models: [withBenchmark] }, { task: 'understanding' });
  assert.deepEqual(admitted.candidates.map(row => row.id), ['local-understanding']);
  assert.deepEqual(admitted.candidates[0].localAuxiliarySlaTasks, ['understanding']);
});

test('local auxiliary work owns a scheduler that is distinct from the interactive Model Brain queue', () => {
  const interactiveQueue = {
    add() { throw new Error('interactive queue must not be exercised by this contract test'); },
    cancel() { return false; },
    status() { return { name: 'model-brain', concurrency: 2, pending: [], running: [] }; }
  };
  const auxiliaryQueue = {
    add() { throw new Error('auxiliary queue must not be exercised by this contract test'); },
    cancel() { return false; },
    status() { return { name: 'local-auxiliary', concurrency: 1, pending: [], running: [] }; }
  };
  const gateway = new AiGateway({
    queue: interactiveQueue,
    localAuxiliaryQueue: auxiliaryQueue,
    registry: { read: () => ({ models: [] }) },
    runtime: { status: runtimeSnapshot },
    internalOperationAuthorityProvider: () => null
  });

  assert.equal(gateway.queue, interactiveQueue);
  assert.equal(gateway.localAuxiliaryQueue, auxiliaryQueue, 'local auxiliary work must have an independently injected scheduler');
  assert.notEqual(gateway.localAuxiliaryQueue, gateway.queue, 'local auxiliary concurrency must not consume the interactive queue');
});

test('Ollama seam exposes governed on-demand pull with progress and caller cancellation', async () => {
  assert.equal(typeof ollamaClient.pull, 'function', 'Ollama client must expose the V1 pull lifecycle on the existing runtime seam');

  const originalFetch = global.fetch;
  const progress = [];
  let observed = null;
  global.fetch = async (url, init = {}) => {
    observed = { url: String(url), init };
    const body = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'downloading', digest: 'sha256:test', total: 100, completed: 0 }),
      JSON.stringify({ status: 'downloading', digest: 'sha256:test', total: 100, completed: 40 }),
      JSON.stringify({ status: 'success', total: 100, completed: 100 })
    ].join('\n') + '\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  };

  try {
    const controller = new AbortController();
    const result = await ollamaClient.pull('http://127.0.0.1:11434', 'qwen-test:latest', {
      signal: controller.signal,
      onProgress: event => progress.push(event)
    });
    assert.match(observed.url, /\/api\/pull$/u);
    assert.equal(observed.init.method, 'POST');
    assert.equal(JSON.parse(observed.init.body).stream, true);
    assert.ok(observed.init.signal, 'pull must pass an abortable signal to physical I/O');
    assert.ok(progress.length >= 3, 'pull must surface upstream progress instead of hiding a long-running download');
    assert.equal(progress[1].completed, 0, 'zero-valued upstream progress must be represented truthfully');
    assert.equal(result.ok, true);
    assert.equal(result.model, 'qwen-test:latest');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Ollama pull refuses arbitrary remote endpoints that are not local or explicitly configured', async () => {
  await assert.rejects(
    ollamaClient.pull('http://203.0.113.77:11434', 'qwen-test:latest'),
    error => error?.code === 'OLLAMA_ENDPOINT_NOT_AUTHORIZED' && error?.status === 400
  );
});

test('status projection separates local auxiliary benchmark/SLA evidence from ordinary qualification and invocation evidence', () => {
  const state = {
    ollamaOnline: true,
    endpoint: 'http://127.0.0.1:11434',
    version: 'test',
    scannedAt: new Date(0).toISOString(),
    scanError: '',
    models: [qualifiedModel({
      id: 'local-summary',
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      tasks: ['summary']
    })]
  };
  let projected = modelStatusProjection.project(state, { modelBrainRuntime: runtimeSnapshot() });

  assert.ok(projected.localAuxiliary && typeof projected.localAuxiliary === 'object', 'status must expose a dedicated localAuxiliary surface');
  assert.equal(projected.localAuxiliary.realtimeReplyAuthority, false);
  assert.equal(projected.localAuxiliary.optional, true);
  assert.equal(projected.localAuxiliary.benchmark.measuredModels, 0, 'qualification alone is not benchmark evidence');
  assert.equal(projected.localAuxiliary.benchmark.qualifiedModels, 0);
  assert.deepEqual(projected.localAuxiliary.benchmark.evidence[0].allowedTasks, []);

  state.models[0].lastCommercialBenchmark = commercialBenchmark(['summary']);
  projected = modelStatusProjection.project(state, { modelBrainRuntime: runtimeSnapshot() });
  assert.equal(projected.localAuxiliary.benchmark.measuredModels, 1);
  assert.equal(projected.localAuxiliary.benchmark.qualifiedModels, 1);
  assert.deepEqual(projected.localAuxiliary.benchmark.evidence[0].allowedTasks, ['summary']);
  assert.equal(projected.localAuxiliary.benchmark.evidence[0].benchmarkPass, true);
  assert.ok(Object.prototype.hasOwnProperty.call(projected.localAuxiliary, 'runtimeAvailable'));
  assert.ok(Object.prototype.hasOwnProperty.call(projected.localAuxiliary, 'sla'));
});
