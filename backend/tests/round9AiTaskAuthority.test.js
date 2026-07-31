'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TASKS } = require('../../shared/constants');
const taskPolicy = require('../services/modelTaskRuntimePolicy');
const routing = require('../services/modelRoutingIntegrityService');
const openRouter = require('../services/openRouterAutoConfigurationService');
const commercial = require('../services/commercialModelBenchmarkService');

const root = path.resolve(__dirname, '../..');

function catalogModel(id, { inputs = ['text'], outputs = ['text'], description = 'multilingual relationship chat model' } = {}) {
  return openRouter.normalizeCatalogModel({
    id,
    name: id,
    description,
    architecture: { input_modalities: inputs, output_modalities: outputs, modality: `${inputs.join('+')}->${outputs.join('+')}` },
    supported_parameters: ['temperature', 'response_format', 'structured_outputs'],
    pricing: { prompt: '0', completion: '0', request: '0' },
    context_length: 131072,
    top_provider: { max_completion_tokens: 8192 }
  });
}

test('memory, media, and persona are canonical first-class AI tasks across backend and workbench', () => {
  for (const task of ['memory_extraction', 'media_analysis', 'persona_rewrite']) assert.equal(TASKS.includes(task), true, `${task} must be canonical`);
  assert.equal(taskPolicy.policyForTask('memory_extraction').default, 520);
  assert.equal(taskPolicy.policyForTask('media_analysis').default, 720);
  assert.equal(taskPolicy.policyForTask('persona_rewrite').default, 420);
  assert.equal(taskPolicy.timeoutPolicyForTask('media_analysis').min, 240000);

  const ui = fs.readFileSync(path.join(root, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(ui, /memory_extraction:\['MX','记忆提取'/u);
  assert.match(ui, /media_analysis:\['MD','媒体理解'/u);
  assert.match(ui, /persona_rewrite:\['PR','人格改写'/u);
});

test('OpenRouter capability classification does not confuse learning material analysis with media input', () => {
  const text = catalogModel('demo/text');
  const vision = catalogModel('demo/vision', { inputs: ['text', 'image'] });
  assert.equal(text.taskEligibility.memory_extraction, true);
  assert.equal(text.taskEligibility.persona_rewrite, true);
  assert.equal(text.taskEligibility.media_analysis, false);
  assert.equal(vision.taskEligibility.media_analysis, true);

  const verifiedText = {
    id: 'text', name: 'demo/text', provider: 'openai-compatible', source: 'openrouter-auto', available: true,
    qualification: 'verified', allowedTasks: ['material_analysis', 'memory_extraction', 'persona_rewrite'],
    catalogMetadata: { taskEligibility: text.taskEligibility }
  };
  assert.equal(routing.eligibleForTask(verifiedText, 'material_analysis'), true, 'text learning materials remain valid without image input');
  assert.equal(routing.eligibleForTask(verifiedText, 'memory_extraction'), true);
  assert.equal(routing.eligibleForTask(verifiedText, 'persona_rewrite'), true);
  assert.equal(routing.eligibleForTask(verifiedText, 'media_analysis'), false);
});

test('commercial evidence qualification activates the independent memory route', () => {
  const free = {
    id: 'free-memory', name: 'free-memory', provider: 'openai-compatible', available: true,
    catalogMetadata: { free: true, pricing: { known: true, promptPerMillion: 0, completionPerMillion: 0 } },
    lastCommercialBenchmark: {
      completed: true,
      qualifyingTasks: ['fact_extraction', 'memory_extraction', 'understanding', 'summary', 'relationship'],
      evidenceScore: 94
    }
  };
  const routes = commercial.recommendedUtilityRoutes([free]);
  assert.equal(routes.fact_extraction.primary, 'free-memory');
  assert.equal(routes.memory_extraction.primary, 'free-memory');
  assert.equal(routes.understanding.primary, 'free-memory');
  assert.notStrictEqual(routes.memory_extraction, routes.fact_extraction, 'routes are separate configuration objects even when the model is shared');
});

test('diagnostic readiness cannot report a green core AI when memory or director routes are missing', () => {
  const { aiTaskRoutingReadiness, CORE_AI_TASKS } = require('../services/diagnosticReadiness');
  const qualified = (id, tasks) => ({ id, name: id, provider: 'openai-compatible', available: true, qualification: 'verified', allowedTasks: tasks, lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true }, translation: { pass: true } } }, lastCommercialBenchmark: { completed: true, pass: true, qualifyingTasks: tasks, translationScore: 95, evidenceScore: 95 }, lastReplyBrainBenchmark: { authority: 'YanceReplyBrainBenchmark', completed: true, pass: true, status: 'REPLY_BRAIN_QUALIFIED', score: 90, qualifyingTasks: tasks, scenarios: [] } });
  const empty = aiTaskRoutingReadiness({ models: [], routes: {} });
  assert.equal(empty.pass, false);
  assert.match(empty.summary, /尚未配置可用AI模型/);
  const tasks = [...CORE_AI_TASKS];
  const model = qualified('all-primary', tasks);
  const fallback = qualified('all-fallback', tasks);
  const redundant = new Set(['translation', 'director', 'quick_reply', 'deep_reply']);
  const routes = Object.fromEntries(tasks.map(task => [task, { primary: model.id, fallback: redundant.has(task) ? fallback.id : '', enabled: true }]));
  let status = aiTaskRoutingReadiness({ models: [model, fallback], routes });
  assert.equal(status.pass, true);
  delete routes.memory_extraction;
  status = aiTaskRoutingReadiness({ models: [model, fallback], routes });
  assert.equal(status.pass, false);
  assert.ok(status.missing.some(row => row.task === 'memory_extraction'));
  assert.match(status.summary, /memory_extraction/);
});
