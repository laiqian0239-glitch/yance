'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ai-brain-model-lifecycle-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { closeR32Store } = require('../lib/r32StoreSingleton');
const registry = require('../services/modelRegistry');
const replyBrainAuthority = require('../services/replyBrainModelAuthority');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test.after(() => {
  closeR32Store();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('disabling a model removes every route reference without deleting the model record', async () => {
  registry.write({
    schemaVersion: 3,
    ollamaOnline: true,
    models: [{
      id: 'main', name: 'ministral-3:14b', provider: 'ollama', available: true,
      qualification: 'verified', allowedTasks: ['quick_reply', 'deep_reply', 'director'],
      lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } }
    }],
    routes: {
      quick_reply: { primary: 'main', fallback: '', enabled: true, source: 'user-configured' },
      deep_reply: { primary: 'main', fallback: '', enabled: true, source: 'user-configured' },
      director: { primary: 'main', fallback: '', enabled: true, source: 'user-configured' }
    },
    history: []
  });
  const state = await registry.setModelEnabled('main', false, { reason: 'not suitable' });
  assert.equal(state.models.find(model => model.id === 'main').userDisabled, true);
  assert.equal(state.routes.quick_reply.primary, '');
  assert.equal(state.routes.deep_reply.primary, '');
  assert.equal(state.routes.director.primary, '');
});



test('reply benchmark failure removes reply routes and a later pass can restore qualified routing', async () => {
  registry.write({
    schemaVersion: 3,
    ollamaOnline: true,
    models: [{
      id: 'brain', name: 'ministral-3:14b', provider: 'ollama', available: true,
      qualification: 'verified', allowedTasks: ['general', 'quick_reply', 'deep_reply', 'director'],
      lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } }
    }],
    routes: {
      quick_reply: { primary: 'brain', fallback: '', enabled: true, source: 'user-configured' },
      deep_reply: { primary: 'brain', fallback: '', enabled: true, source: 'user-configured' },
      director: { primary: 'brain', fallback: '', enabled: true, source: 'user-configured' }
    },
    history: []
  });

  let state = await registry.recordReplyBrainBenchmark('brain', {
    authority: 'YanceReplyBrainBenchmark', testedAt: new Date().toISOString(), pass: false,
    status: 'REPLY_BRAIN_FAILED', score: 55, qualifyingTasks: [], summary: 'style failed'
  });
  let model = state.models.find(row => row.id === 'brain');
  assert.equal(model.allowedTasks.includes('quick_reply'), false);
  assert.equal(state.routes.quick_reply.primary, '');
  assert.equal(model.replyBrainBenchmarkScore, 55);

  state = await registry.recordReplyBrainBenchmark('brain', {
    authority: 'YanceReplyBrainBenchmark', testedAt: new Date().toISOString(), pass: true,
    status: 'REPLY_BRAIN_QUALIFIED', score: 91,
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'], scenarios: []
  });
  model = state.models.find(row => row.id === 'brain');
  assert.equal(model.allowedTasks.includes('quick_reply'), true);
  assert.equal(model.replyBrainBenchmarkStatus, 'REPLY_BRAIN_QUALIFIED');
  assert.equal(state.routes.quick_reply.primary, 'brain');
});



test('recommended reply routes persist the strongest benchmark model and an independent fallback without replacing translation', async () => {
  const scores = { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } };
  const benchmark = score => ({ authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', pass: true, score, testedAt: new Date().toISOString() });
  registry.write({
    schemaVersion: 3,
    models: [
      { id: 'main', name: 'ministral-3:14b', provider: 'ollama', qualification: 'verified', available: true, parameterSize: '14B', allowedTasks: ['quick_reply', 'deep_reply', 'director'], lastTest: { scores }, lastReplyBrainBenchmark: benchmark(94) },
      { id: 'backup', name: 'gemma3:12b', provider: 'ollama', qualification: 'verified', available: true, parameterSize: '12B', allowedTasks: ['quick_reply', 'deep_reply', 'director'], lastTest: { scores }, lastReplyBrainBenchmark: benchmark(86) },
      { id: 'translation', name: 'translategemma:4b', provider: 'ollama', qualification: 'verified', available: true, allowedTasks: ['translation'], lastTest: { scores: { translation: { pass: true } } } }
    ],
    routes: { translation: { primary: 'translation', fallback: '', enabled: true } },
    history: []
  });
  const before = registry.read();
  const recommendation = replyBrainAuthority.recommendedReplyRoutes(before.models, before.routes);
  const state = await registry.applyRecommendedReplyBrainRoutes(recommendation.routes);
  assert.equal(state.routes.quick_reply.primary, 'main');
  assert.equal(state.routes.quick_reply.fallback, 'backup');
  assert.equal(state.routes.deep_reply.primary, 'main');
  assert.equal(state.routes.director.primary, 'main');
  assert.equal(state.routes.translation.primary, 'translation');
});

test('cloud configuration is verified before it is persisted', () => {
  const route = read('backend/routes/models.js');
  const verifyAt = route.indexOf('verification = await verifyCloudCredential');
  const persistAt = route.indexOf('let state = await registry.upsertCloudModel');
  assert.ok(verifyAt > 0 && persistAt > verifyAt);
  assert.match(route, /CLOUD_MODEL_TEST_REQUIRED/);
  assert.match(route, /persisted:\s*false/);
});

test('AI workbench exposes Chinese audit, disable, reconfigure and delete actions', () => {
  const ui = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /AI 回复大脑门禁/);
  assert.match(ui, /评估回复能力/);
  assert.match(ui, /reply-brain-benchmark/);
  assert.match(ui, /评估本地回复模型并应用推荐路由/);
  assert.match(ui, /reply-brain\/benchmark-local/);
  assert.match(ui, /回复大脑基准/);
  assert.match(ui, /data-service-lifecycle/);
  assert.match(ui, /重新配置/);
  assert.match(ui, /删除配置与凭据/);
  assert.match(ui, /从 Ollama 删除/);
  assert.match(ui, /测试未通过，配置没有进入正式模型注册表/);
  assert.doesNotMatch(ui, /q\('aiwDialogPriority'\)\.closest\('label'\)\.hidden=true/);
});


test('local Ollama removal requires disable, exact-name confirmation and the official delete API', () => {
  const route = read('backend/routes/models.js');
  const client = read('backend/services/ollamaClient.js');
  assert.match(route, /MODEL_MUST_BE_DISABLED_FIRST/);
  assert.match(route, /MODEL_DELETE_CONFIRMATION_MISMATCH/);
  assert.match(route, /MODEL_ROUTE_DEPENDENCY_EXISTS/);
  assert.match(client, /\/api\/delete/);
  assert.match(client, /method:\s*'DELETE'/);
});
