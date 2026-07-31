'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ai-brain-runtime-closure-'));
process.env.YANCE_DATA_DIR = dataRoot;

const runtimePolicy = require('../services/replyBrainBenchmarkRuntimePolicy');
const taskPolicy = require('../services/modelTaskRuntimePolicy');
const routingIntegrity = require('../services/modelRoutingIntegrityService');
const { runReplyBrainBenchmark } = require('../services/replyBrainBenchmark');
const registry = require('../services/modelRegistry');
const authority = require('../services/replyBrainModelAuthority');
const { closeR32Store } = require('../lib/r32StoreSingleton');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function qualificationScores() {
  return { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } };
}

function passingBenchmark(score = 92) {
  return {
    schemaVersion: 2,
    authority: 'YanceReplyBrainBenchmark',
    testedAt: new Date().toISOString(),
    completed: true,
    pass: true,
    status: 'REPLY_BRAIN_QUALIFIED',
    score,
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
    scenarios: []
  };
}

test.after(() => {
  closeR32Store();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('benchmark runtime policy gives 5.9B and 14B different warmup and scenario budgets', () => {
  const small = runtimePolicy.profileForModel({ id: 'small', name: 'qwen3:5.9b', provider: 'ollama', parameterSize: '5.9B' });
  const large = runtimePolicy.profileForModel({ id: 'large', name: 'ministral-3:14b', provider: 'ollama', parameterSize: '14B' });
  assert.equal(small.sizeClass, 'small');
  assert.equal(large.sizeClass, 'large');
  assert.ok(large.warmupTimeoutMs > small.warmupTimeoutMs);
  assert.ok(large.scenarioTimeoutMs > small.scenarioTimeoutMs);
  assert.equal(small.serialRequired, true);
  assert.equal(large.warmupRequired, true);
});

test('technical timeout is incomplete rather than a model quality failure', async () => {
  const model = { id: 'small', name: 'qwen3:5.9b', provider: 'ollama', qualification: 'verified' };
  const executor = async (_model, messages) => {
    const prompt = messages.map(row => String(row.content || '')).join('\n');
    if (/Ich glaube/u.test(prompt)) throw Object.assign(new Error('模型请求超时'), { code: 'MODEL_TIMEOUT' });
    return { text: 'That was thoughtful of you. I am fine, just taking a quiet moment.', totalMs: 1000 };
  };
  const result = await runReplyBrainBenchmark(model, { executor, latencyThresholdMs: 5000 });
  assert.equal(result.completed, false);
  assert.equal(result.status, 'REPLY_BRAIN_INCOMPLETE');
  assert.match(result.summary, /未完成/);
  assert.equal(result.scenarios.find(row => row.id === 'german_whatsapp').technicalFailure, true);
});

test('an incomplete retry preserves the last qualified benchmark, tasks and routes', async () => {
  const previous = passingBenchmark(94);
  registry.write({
    schemaVersion: 3,
    models: [{
      id: 'brain', name: 'ministral-3:14b', provider: 'ollama', available: true,
      qualification: 'verified', allowedTasks: ['quick_reply', 'deep_reply', 'director'],
      lastTest: { scores: qualificationScores() }, lastReplyBrainBenchmark: previous,
      lastSuccessfulReplyBrainBenchmark: previous
    }],
    routes: {
      quick_reply: { primary: 'brain', fallback: '', enabled: true, maxTokens: 220 },
      deep_reply: { primary: 'brain', fallback: '', enabled: true, maxTokens: 480 },
      director: { primary: 'brain', fallback: '', enabled: true, maxTokens: 360 }
    },
    history: []
  });
  const state = await registry.recordReplyBrainBenchmark('brain', {
    schemaVersion: 2,
    authority: 'YanceReplyBrainBenchmark',
    testedAt: new Date().toISOString(),
    completed: false,
    pass: false,
    status: 'REPLY_BRAIN_INCOMPLETE',
    score: 25,
    qualifyingTasks: [],
    summary: '本次评估超时'
  });
  const model = state.models.find(row => row.id === 'brain');
  assert.equal(model.lastReplyBrainBenchmark.status, 'REPLY_BRAIN_QUALIFIED');
  assert.equal(model.lastReplyBrainBenchmarkAttempt.status, 'REPLY_BRAIN_INCOMPLETE');
  assert.equal(model.allowedTasks.includes('quick_reply'), true);
  assert.equal(state.routes.quick_reply.primary, 'brain');
  assert.equal(authority.projectModel(model).replyBrainQualified, true);
  assert.equal(authority.projectModel(model).replyBrainBenchmarkAttemptIncomplete, true);
});

test('completed quality failure still removes reply eligibility', async () => {
  const previous = passingBenchmark(90);
  registry.write({
    schemaVersion: 3,
    models: [{ id: 'brain', name: 'ministral-3:14b', provider: 'ollama', available: true, qualification: 'verified', allowedTasks: ['quick_reply', 'deep_reply', 'director'], lastTest: { scores: qualificationScores() }, lastReplyBrainBenchmark: previous }],
    routes: { quick_reply: { primary: 'brain', enabled: true }, deep_reply: { primary: 'brain', enabled: true }, director: { primary: 'brain', enabled: true } },
    history: []
  });
  const state = await registry.recordReplyBrainBenchmark('brain', {
    schemaVersion: 2, authority: 'YanceReplyBrainBenchmark', testedAt: new Date().toISOString(),
    completed: true, pass: false, status: 'REPLY_BRAIN_FAILED', score: 60, qualifyingTasks: [], summary: 'WhatsApp 风格不通过'
  });
  const model = state.models.find(row => row.id === 'brain');
  assert.equal(model.allowedTasks.includes('quick_reply'), false);
  assert.equal(model.lastSuccessfulReplyBrainBenchmark.status, 'REPLY_BRAIN_QUALIFIED');
  assert.equal(model.lastReplyBrainBenchmark.status, 'REPLY_BRAIN_FAILED');
  assert.equal(state.routes.quick_reply.primary, '');
});

test('legacy 1800 reply limits are normalized to task-specific budgets', () => {
  assert.equal(taskPolicy.normalizeMaxTokens('quick_reply', 1800), 320);
  assert.equal(taskPolicy.normalizeMaxTokens('deep_reply', 1800), 650);
  assert.equal(taskPolicy.normalizeMaxTokens('director', 1800), 520);
  const repaired = routingIntegrity.repairRegistryDocument({ models: [], routes: { quick_reply: { maxTokens: 1800, enabled: false } } }, { autoSelectVerified: false });
  assert.equal(repaired.document.routes.quick_reply.maxTokens, 320);
});

test('workbench waits for long local benchmarks and explains serial warmup', () => {
  const ui = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /timeoutMs:7200000/);
  assert.match(ui, /timeoutMs:2400000/);
  assert.match(ui, /正在串行预热并评估/);
  assert.match(ui, /本次评估未完成，未覆盖上次成功结果/);
  assert.match(ui, /TASK_TOKEN_LIMITS/);
});

test('local batch prevents duplicate runs, re-evaluates incomplete models and unloads between models', () => {
  const route = read('backend/routes/models.js');
  assert.match(route, /REPLY_BRAIN_BENCHMARK_ALREADY_RUNNING/);
  assert.match(route, /last\.pass !== true/);
  assert.match(route, /last\.status === 'REPLY_BRAIN_INCOMPLETE'/);
  assert.match(route, /await ollama\.unload\(model\.endpoint, model\.name\)/);
  assert.match(route, /batchCompleted && req\.body\?\.applyRoutes !== false/);
});
