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
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

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

  // Task identity/timeout is owned by the backend canonical TASKS + taskPolicy above;
  // the retired physical AI workbench no longer hard-codes short-code labels in the browser.
});

test('OpenRouter capability classification does not confuse learning material analysis with media input', () => {
  const text = catalogModel('demo/text');
  const vision = catalogModel('demo/vision', { inputs: ['text', 'image'] });
  // Modality -> task eligibility is derived from catalog modalities: media analysis
  // requires image input, while learning/persona material analysis is text-only.
  const textEligibility = {
    memory_extraction: text.textInput === true,
    persona_rewrite: text.textInput === true,
    media_analysis: text.vision === true
  };
  const visionEligibility = { media_analysis: vision.vision === true };
  assert.equal(textEligibility.memory_extraction, true);
  assert.equal(textEligibility.persona_rewrite, true);
  assert.equal(textEligibility.media_analysis, false);
  assert.equal(visionEligibility.media_analysis, true);

  const verifiedText = {
    id: 'text', name: 'demo/text', provider: 'openai-compatible', source: 'openrouter-auto', available: true,
    qualification: 'verified', allowedTasks: ['material_analysis', 'memory_extraction', 'persona_rewrite'],
    catalogMetadata: { taskEligibility: textEligibility, inputModalities: text.inputModalities }
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
  const qualified = (id, tasks) => {
    const commercialEvidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: tasks, translationScore: 95, evidenceScore: 95 };
    const replyEvidence = { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 90, qualifyingTasks: tasks, scenarios: [] };
    const receipts = {};
    for (const task of tasks.filter(value => roleReceipts.GOVERNED_TASKS.includes(value))) {
      const evidence = task === 'translation' ? commercialEvidence : replyEvidence;
      receipts[task] = roleReceipts.issueFromEvidence({ modelId: id, task, evidence, expiresAt: '2030-01-01T00:00:00.000Z' });
    }
    return { id, name: id, provider: 'openai-compatible', available: true, qualification: 'verified', allowedTasks: tasks, lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true }, translation: { pass: true } } }, lastCommercialBenchmark: commercialEvidence, lastReplyBrainBenchmark: replyEvidence, roleQualificationReceipts: receipts };
  };
  const empty = aiTaskRoutingReadiness({ models: [], routes: {} });
  assert.equal(empty.pass, false);
  assert.match(empty.summary, /Model Brain capability readiness 0\/8/);
  // Current Model Brain readiness derives capability from hard qualification per task
  // (not static physical routes); inject an available runtime fixture.
  const runtime = { runtimeAvailable: true, health: 'healthy' };
  const tasks = [...CORE_AI_TASKS];
  const model = qualified('all-primary', tasks);
  const fallback = qualified('all-fallback', tasks);
  let status = aiTaskRoutingReadiness({ models: [model, fallback], modelBrainRuntime: runtime });
  assert.equal(status.pass, true);
  // A model set lacking hard qualification for memory_extraction must not report green.
  const partial = qualified('missing-memory', tasks.filter(task => task !== 'memory_extraction'));
  status = aiTaskRoutingReadiness({ models: [partial], modelBrainRuntime: runtime });
  assert.equal(status.pass, false);
  assert.ok(status.missing.some(row => row.task === 'memory_extraction'));
  assert.match(status.summary, /7\/8/);
});
