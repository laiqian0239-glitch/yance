'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const routing = require('../services/modelRoutingIntegrityService');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const autoActivation = require('../services/modelAutoActivationService');
const qualification = require('../services/modelQualification');
const ollama = require('../services/ollamaClient');
const workspaceData = require('../services/workspaceDataService');
const { ensureCustomerContext } = require('../services/storeManagerService');

function model(id, name, qualificationValue, allowedTasks, sizeBytes) {
  const result = { id, name, provider: 'ollama', available: true, qualification: qualificationValue, allowedTasks, sizeBytes };
  if (qualificationValue === 'verified' && allowedTasks.includes('translation')) {
    const evidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95 };
    result.lastCommercialBenchmark = evidence;
    result.roleQualificationReceipts = { translation: roleReceipts.issueFromEvidence({ modelId: id, task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' }) };
  }
  return result;
}

function withReplyAuthority(modelValue) {
  const tasks = ['quick_reply', 'deep_reply', 'director'];
  const evidence = { authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 91, qualifyingTasks: tasks, scenarios: [] };
  return {
    ...modelValue,
    lastReplyBrainBenchmark: evidence,
    roleQualificationReceipts: {
      ...(modelValue.roleQualificationReceipts || {}),
      ...Object.fromEntries(tasks.map(task => [task, roleReceipts.issueFromEvidence({ modelId: modelValue.id, task, evidence, expiresAt: '2030-01-01T00:00:00.000Z' })]))
    }
  };
}

test('empty registry routes are rebuilt for every task from actual allowedTasks', () => {
  const models = [
    model('q4', 'qwen3.5:4b-q4_K_M', 'experimental', ['general', 'quick_reply', 'deep_reply', 'fact_extraction', 'understanding', 'summary'], 3_400_000_000),
    withReplyAuthority({ ...model('min', 'ministral-3:14b', 'verified', ['general', 'quick_reply', 'deep_reply', 'quality_review', 'relationship', 'material_analysis', 'director'], 9_000_000_000), lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } } }),
    model('tr', 'translategemma:4b', 'verified', ['general', 'translation', 'quick_reply'], 3_300_000_000),
    model('coder', 'qwen2.5-coder:14b-instruct', 'verified', ['quick_reply', 'deep_reply', 'director', 'fact_extraction'], 9_000_000_000)
  ];
  const repaired = routing.repairRegistryDocument({ models, routes: {} }, { autoSelectVerified: true }).repairedRoutes;
  assert.equal(repaired.translation.primary, 'tr');
  assert.equal(repaired.quick_reply.primary, 'min');
  assert.equal(repaired.deep_reply.primary, 'min');
  assert.notEqual(repaired.quick_reply.primary, 'coder');
  assert.notEqual(repaired.director.primary, 'coder');
  assert.equal(repaired.speech_transcription.primary, '');
  assert.ok(routing.configuredRouteCount(repaired) >= 9);
});

test('translation-only and coder policies prevent invalid live chat routes', () => {
  const translator = model('tr', 'translategemma:4b', 'verified', ['translation', 'quick_reply'], 3_000_000_000);
  const coder = model('coder', 'qwen2.5-coder:14b', 'verified', ['quick_reply', 'fact_extraction'], 9_000_000_000);
  assert.equal(routing.eligibleForTask(translator, 'translation'), true);
  assert.equal(routing.eligibleForTask(translator, 'quick_reply'), false);
  assert.equal(routing.eligibleForTask(coder, 'quick_reply'), false);
  assert.equal(routing.eligibleForTask(coder, 'fact_extraction'), true);
});

test('auto activation prioritizes stronger chat candidates and excludes coder models', () => {
  const chosen = autoActivation.chooseCandidates([
    model('coder', 'qwen2.5-coder:14b', 'untested', [], 9_000_000_000),
    model('q4', 'qwen3.5:4b-q4_K_M', 'failed', [], 3_400_000_000),
    model('q9', 'qwen3.5:9b', 'failed', [], 6_600_000_000),
    model('min', 'ministral-3:14b', 'experimental', ['quick_reply'], 9_000_000_000),
    model('tr', 'translategemma:4b', 'verified', ['translation'], 3_300_000_000)
  ]);
  assert.equal(chosen[0].model.id, 'min');
  assert.ok(chosen.filter(row => row.role !== 'translation').length >= 3);
  assert.equal(chosen.some(row => row.model.id === 'coder'), false);
  assert.equal(chosen.some(row => row.model.id === 'tr' && row.role === 'translation'), true);
});

test('hallucination judge accepts correct cannot-know Chinese wording', () => {
  assert.equal(qualification.statesEvidenceIsUnknown('根据现有资料，无法得知 Alex 的具体生日。'), true);
  assert.equal(qualification.statesEvidenceIsUnknown('没有足够信息可以确定他的生日。'), true);
});

test('Ollama thinking models are requested with think false and empty visible output is explicit failure', async () => {
  const previousFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const lines = [
      JSON.stringify({ message: { thinking: 'internal reasoning', content: '' }, eval_count: 16 }),
      JSON.stringify({ message: { thinking: 'more', content: '' }, eval_count: 32, done: true })
    ].join('\n') + '\n';
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(lines)); controller.close(); } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  try {
    await assert.rejects(
      ollama.streamChat({ endpoint: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', messages: [{ role: 'user', content: 'hello' }], options: { timeoutMs: 2000 } }),
      error => error.code === 'EMPTY_MODEL_OUTPUT'
    );
    assert.equal(requestBody.think, false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('conversation id is authoritative over a stale contact hint', async () => {
  const original = workspaceData.resolveContactForConversation;
  workspaceData.resolveContactForConversation = conversationId => ({
    conversation: { session_key: conversationId, contact_id: 'contact-real' },
    contact: { id: 'contact-real' }
  });
  const fakeState = { customers: { byId: { 'contact-stale': { id: 'contact-stale' }, 'contact-real': { id: 'contact-real' } } } };
  const fakeStore = { select: selector => selector(fakeState), dispatch: async () => ({}) };
  try {
    assert.equal(await ensureCustomerContext(fakeStore, 'conversation-1', 'contact-stale'), 'contact-real');
  } finally {
    workspaceData.resolveContactForConversation = original;
  }
});

test('AI workbench route health is based on assigned registry routes, not eleven UI switches', () => {
  const ui = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /configured=Boolean\(actualMain\)/);
  assert.match(ui, /primarySelection==='auto'/);
  assert.match(ui, /actualMain/);
  assert.match(ui, /YanceModelRuntimeSnapshotAuthority/u);
  assert.match(ui, /modelRuntimeSnapshotAuthority\.projectModelRuntimeSnapshot/u);
  const snapshotAuthority = require('../../frontend/js/r32-model-runtime-snapshot-authority');
  const readiness = { pass: true, tasks: [{ task: 'quick_reply', operational: true }], missing: [] };
  const snapshot = snapshotAuthority.projectModelRuntimeSnapshot({
    modelState: { models: [], routes: { quick_reply: { primary: 'resolved-model' } }, taskReadiness: readiness },
    previousState: { routes: [], taskReadiness: {} },
    defaults: { taskReadiness: {}, replyBrain: {}, modelPools: {}, openRouter: {}, aiAutomation: {} },
    adapters: {
      projectServices: models => models,
      projectRoutes: (routes, taskReadiness) => [{ id: 'quick_reply', actualMain: routes.quick_reply.primary, taskReadiness }],
      summarizeServices: services => ({ count: services.length }),
      mergeAuthoritativeSummary: (derived, authoritative) => ({ ...derived, ...authoritative })
    }
  });
  assert.strictEqual(snapshot.taskReadiness, readiness);
  assert.equal(snapshot.routes[0].actualMain, 'resolved-model');
  assert.strictEqual(snapshot.routes[0].taskReadiness, readiness);
  assert.match(ui, /\$\{configuredRoutes\}\/\$\{totalRoutes\} 已配置 · \$\{operationalRoutes\} 主路由可运行 · \$\{resilientRoutes\} 主备就绪/);
  assert.doesNotMatch(ui, /state\.routes\.length===Object\.keys\(TASK_META\)\.length/);
});
