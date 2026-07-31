'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const smoke = require('../../backend/services/openRouterOnboardingSmokeService');
const diagnostics = require('../../backend/services/diagnosticsService');
const routingIntegrity = require('../../backend/services/modelRoutingIntegrityService');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fakeRegistry() {
  const state = {
    models: [
      { id: 'cloud-a', name: 'vendor/model-a', provider: 'openai-compatible', source: 'openrouter-auto', available: true, credentialRef: 'model:openrouter:default' },
      { id: 'cloud-b', name: 'vendor/model-b', provider: 'openai-compatible', source: 'openrouter-auto', available: true, credentialRef: 'model:openrouter:default' }
    ],
    routes: {}
  };
  return {
    state,
    read() { return state; },
    async recordInvocation(id, result) { state.models.find(row => row.id === id).lastSuccessfulInvocation = { at: new Date().toISOString(), returnedModel: result.returnedModel }; },
    async recordInvocationFailure() {},
    async recordReplyBrainBenchmark(id, result) { state.models.find(row => row.id === id).lastReplyBrainBenchmark = result; },
    async recordCommercialBenchmark(id, result) { state.models.find(row => row.id === id).lastCommercialBenchmark = result; },
    async recordTest(id, result) { Object.assign(state.models.find(row => row.id === id), { qualification: result.qualification, allowedTasks: result.allowedTasks, lastTest: result }); },
    async recordOpenRouterOnboardingSmoke(id, result) { Object.assign(state.models.find(row => row.id === id), { openRouterOnboardingSmoke: result, capabilityTags: result.capabilityTags }); },
    async applyOpenRouterConditionalRoutes(routes) { state.routes = routes; return state; }
  };
}

function validInference(model) {
  return {
    text: JSON.stringify({
      director: { goal: '自然回应并打开轻松话题', strategy: '短句承接', avoid: ['不虚构事实'] },
      candidates: [
        { text: 'Hallo, schön von dir zu hören. Wie ist dein Abend?', translationZh: '你好，很高兴收到你的消息。你今晚过得怎么样？', direction: '自然' },
        { text: 'Ein Hallo mit einer Rose ist schon ein guter Anfang. Woher kommst du?', translationZh: '带着玫瑰的问候已经是个不错的开始。你来自哪里？', direction: '俏皮' },
        { text: 'Hallo du. Was hat dich heute zum Lächeln gebracht?', translationZh: '你好呀。今天什么事情让你笑了？', direction: '轻松' }
      ],
      translationZh: '你好，附带一朵玫瑰。',
      fabricatedFacts: []
    }),
    totalMs: 820,
    firstTokenMs: 500,
    promptTokens: 120,
    outputTokens: 180,
    totalTokens: 300,
    returnedModel: model.name,
    requestMode: 'chat-completions-standard',
    raw: { id: `req-${model.id}` }
  };
}

test('conversation center keeps candidates in the right AI brain and compacts the composer into two single rows', () => {
  const html = source('frontend/index.html');
  const css = source('frontend/r32-conversation-center-v3.css');
  const runtime = source('frontend/js/r32-conversation-center-v3.js');
  assert.doesNotMatch(html, /id="quickReplyDock"/u);
  assert.match(html, /id="aiDailyCandidates"/u);
  assert.match(html, /id="aiCandidateProcessAction"/u);
  assert.match(html, /class="composer-settings-row"/u);
  assert.match(html, /class="composer-bottom-row"/u);
  assert.match(html, /id="composerSendActions"/u);
  assert.doesNotMatch(html, /输入文字或添加附件后可发送/u);
  assert.match(css, /\.composer-settings-row/u);
  assert.match(css, /\.composer-bottom-row/u);
  assert.match(runtime, /不会自动发送/u);
});

test('account login completion stops QR polling, shows success, closes the dialog and refreshes Telegram state', () => {
  const account = source('frontend/r32-account-center.js');
  assert.match(account, /function completeQrAuthorization/u);
  assert.match(account, /state\.qrPollTokens\[account\.id\].*\+ 1/u);
  assert.match(account, /关联成功/u);
  assert.match(account, /dialog\.close\(\)/u);
  assert.match(account, /telegram:state/u);
  assert.match(account, /reconcileAuthorizationCompletion/u);
});

test('platform-wide reading authority loads after all component CSS and covers meta, controls, contrast and density', () => {
  const html = source('frontend/index.html');
  const css = source('frontend/r32-global-reading.css');
  assert.ok(html.lastIndexOf('/r32-global-reading.css') > html.lastIndexOf('/r32-flat-document-flow.css'));
  assert.match(css, /--ws-body/u);
  assert.match(css, /--ws-meta/u);
  assert.match(css, /html\[data-reading="large"\]/u);
  assert.match(css, /html\[data-density="comfortable"\]/u);
  assert.match(css, /html\[data-contrast="high"\]/u);
  assert.match(css, /\.reply-mode-control/u);
  assert.match(css, /color:color-mix\(in srgb,var\(--text-secondary/u);
  assert.match(html, /id="resetDisplaySettings"/u);
  assert.match(html, /id="displayScaleStatus"/u);
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /contrastMode/u);
  assert.match(ui, /devicePixelRatio/u);
});

test('Persona runtime retries and replaces raw Failed to fetch with actionable Chinese state', () => {
  const persona = source('frontend/js/r32-persona-runtime.js');
  const status = source('frontend/js/r32-persona-status-runtime.js');
  assert.match(persona, /PERSONA_SERVICE_UNREACHABLE/u);
  assert.match(persona, /重新读取/u);
  assert.match(status, /人物基线服务暂未连接/u);
  assert.doesNotMatch(persona, />Failed to fetch</u);
});

test('OpenRouter onboarding no longer blocks the modal on the full commercial benchmark', () => {
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  const route = source('backend/routes/models.js');
  assert.doesNotMatch(ui.slice(ui.indexOf('async function autoConfigureOpenRouter'), ui.indexOf('async function runOpenRouterCommercialBenchmark')), /commercial-benchmark/u);
  assert.match(ui, /runOpenRouterCommercialBenchmark/u);
  assert.match(route, /openRouterOnboardingSmoke\.run/u);
  assert.match(route, /connectionState: 'conditional-ready'/u);
  assert.match(route, /OPENROUTER_ONBOARDING_SMOKE_FAILED/u);
  assert.match(route, /router\.get\('\/cloud\/openrouter\/status'/u);
});

test('two different OpenRouter models must pass real JSON/director/candidate/translation smoke before conditional routes are created', async () => {
  const registry = fakeRegistry();
  const result = await smoke.run({
    snapshot: {
      selections: {
        quick_reply: [{ id: 'vendor/model-a' }, { id: 'vendor/model-b' }],
        director: [{ id: 'vendor/model-a' }, { id: 'vendor/model-b' }]
      }
    },
    registry,
    executeModel: async model => validInference(model)
  });
  assert.equal(result.pass, true);
  assert.equal(result.state, 'conditional-ready');
  assert.notEqual(result.primaryModelId, result.fallbackModelId);
  assert.equal(result.results.length, 2);
  assert.equal(result.results.every(row => row.pass), true);
  for (const task of ['director', 'quick_reply', 'deep_reply', 'translation', 'learning_synthesis']) {
    assert.equal(registry.state.routes[task].primary, 'cloud-a');
    assert.equal(registry.state.routes[task].fallback, 'cloud-b');
    assert.equal(registry.state.routes[task].humanReviewRequired, true);
  }
});

test('OpenRouter onboarding refuses to claim success when the independent fallback model fails', async () => {
  const registry = fakeRegistry();
  await assert.rejects(
    smoke.run({
      snapshot: { selections: { quick_reply: [{ id: 'vendor/model-a' }, { id: 'vendor/model-b' }] } },
      registry,
      executeModel: async model => model.id === 'cloud-a' ? validInference(model) : ({ ...validInference(model), text: '{"candidates":[]}' })
    }),
    error => error.code === 'OPENROUTER_ONBOARDING_SMOKE_INCOMPLETE'
  );
  assert.deepEqual(registry.state.routes, {});
});


test('OpenRouter diagnostics distinguishes no configuration, conditional human-review readiness and formal qualification', () => {
  const none = diagnostics.openRouterReadiness({ openRouter: {} });
  assert.equal(none.configured, false);
  assert.equal(none.conditionalReady, false);

  const conditional = diagnostics.openRouterReadiness({
    openRouter: {
      credentialConfigured: true,
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'passed',
      routeStatus: 'conditional-ready',
      formalQualificationStatus: 'pending',
      onboardingPrimaryModelSlug: 'vendor/a',
      onboardingFallbackModelSlug: 'vendor/b',
      onboardingSmokeResults: [{ pass: true, modelSlug: 'vendor/a' }, { pass: true, modelSlug: 'vendor/b' }]
    }
  });
  assert.equal(conditional.conditionalReady, true);
  assert.equal(conditional.formallyQualified, false);

  const qualified = diagnostics.openRouterReadiness({ openRouter: { ...conditional, credentialConfigured: true, authenticationStatus: 'passed', catalogStatus: 'passed', onboardingSmokeStatus: 'passed', routeStatus: 'ready', formalQualificationStatus: 'passed', onboardingPrimaryModelSlug: 'vendor/a', onboardingFallbackModelSlug: 'vendor/b', onboardingSmokeResults: [{ pass: true }, { pass: true }] } });
  assert.equal(qualified.formallyQualified, true);
});

test('candidate generation backend records an observable operation and never reports an untracked permanent wait', () => {
  const route = source('backend/routes/store.js');
  assert.match(route, /beginOperation\(\{[\s\S]*command: 'ai\.reply\.generate'/u);
  assert.match(route, /AI_REPLY_CANDIDATE_READY/u);
  assert.match(route, /candidate-failed/u);
  const service = source('backend/services/diagnosticsService.js');
  assert.match(service, /ai-candidate-operation-observability/u);
  assert.match(service, /尚无候选生成尝试；界面不得显示无法追踪的永久等待状态/u);
});


test('current Batch 20 source retains the full 81-case Chromium flat-flow geometry matrix', () => {
  const evidence = JSON.parse(source('artifacts/repair-batch20/YANCE_BATCH20_PRODUCTION_LAYOUT_AND_READABILITY_CHROMIUM_EVIDENCE.json'));
  assert.equal(evidence.documentType, 'YANCE_BATCH20_PRODUCTION_LAYOUT_AND_READABILITY_CHROMIUM_EVIDENCE');
  assert.equal(evidence.testCount, 81);
  assert.equal(evidence.passCount, 81);
  assert.equal(evidence.failCount, 0);
  assert.equal(evidence.passed, true);
});


test('conditional OpenRouter primary and independent fallback survive the real routing-integrity repair', () => {
  const model = id => ({
    id,
    name: `vendor/${id}`,
    provider: 'openai-compatible',
    source: 'openrouter-auto',
    available: true,
    qualification: 'experimental',
    allowedTasks: ['director', 'quick_reply', 'deep_reply', 'translation', 'persona_rewrite', 'learning_synthesis'],
    lastSuccessfulInvocation: { at: new Date().toISOString(), returnedModel: `vendor/${id}` },
    lastQualificationTest: { scores: { json: { pass: true }, persona: { pass: true }, hallucination: { pass: true }, translation: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainOnboardingSmoke', completed: true, pass: false, status: 'REPLY_BRAIN_CONDITIONAL', score: 82,
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 30, score: 30, issues: [] },
        { id: 'german_alternative', pass: true, weight: 15, score: 15, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 25, issues: [] },
        { id: 'director_schema', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'latency', pass: true, weight: 10, score: 8, issues: [] }
      ]
    }
  });
  const routes = smoke.conditionalRoutes(model('cloud-a'), model('cloud-b'));
  const repaired = routingIntegrity.repairRegistryDocument({ models: [model('cloud-a'), model('cloud-b')], routes }, { autoSelectVerified: false, rebalanceAutoRoutes: false });
  assert.equal(repaired.quarantine.length, 0);
  for (const task of ['director', 'quick_reply', 'deep_reply', 'translation', 'learning_synthesis']) {
    assert.equal(repaired.document.routes[task].primary, 'cloud-a');
    assert.equal(repaired.document.routes[task].fallback, 'cloud-b');
    assert.equal(repaired.document.routes[task].humanReviewRequired, true);
  }
});
