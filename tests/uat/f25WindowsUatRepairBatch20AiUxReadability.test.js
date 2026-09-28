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

test('platform-wide reading authority is token-only and remains independent from density and contrast authorities', () => {
  const html = source('frontend/index.html');
  const css = source('frontend/r32-global-reading.css');
  const themeAuthority = source('frontend/r32-theme-authority.css');
  assert.ok(html.lastIndexOf('/r32-global-reading.css') > html.lastIndexOf('/r32-flat-document-flow.css'));
  for (const token of ['page-title', 'section-title', 'card-title', 'body', 'body-strong', 'caption', 'meta', 'control', 'badge', 'data-value']) {
    assert.match(css, new RegExp(`--type-${token}:`, 'u'));
  }
  assert.match(css, /html\[data-reading="standard"\]/u);
  assert.match(css, /html\[data-reading="comfortable"\]/u);
  assert.match(css, /html\[data-reading="large"\]/u);
  assert.match(css, /html\[data-density="compact"\]/u);
  assert.match(css, /html\[data-density="comfortable"\]/u);
  assert.doesNotMatch(css, /--ws-/u);
  assert.doesNotMatch(css, /!important/u);
  assert.doesNotMatch(css, /(?:^|\})\s*[.#][^{]+\{/u);
  assert.doesNotMatch(themeAuthority, /--type-[\w-]+\s*:/u);
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

test('Product model center uses the single canonical OpenRouter credential and recovers readiness from trusted runtime projection', () => {
  const shell = source('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /const OPENROUTER_CREDENTIAL_REF = "model:openrouter:default"/u);
  const configureStart = shell.indexOf('const configureOpenRouter = async');
  const configureEnd = shell.indexOf('const discoverCompatibleCloud = async', configureStart);
  const configure = shell.slice(configureStart, configureEnd);
  assert.match(configure, /const credentialRef = OPENROUTER_CREDENTIAL_REF/u);
  assert.doesNotMatch(configure, /model:openrouter:\$\{/u);
  assert.match(shell, /OPENROUTER_CREDENTIAL_MISSING: "OpenRouter 密钥尚未生效/u);
  const projectionStart = shell.indexOf('const applyProjection = (payload: unknown)');
  const projectionEnd = shell.indexOf('const applyHealth =', projectionStart);
  assert.match(shell.slice(projectionStart, projectionEnd), /setRuntimeBackendReady\(true\)/u);
});

test('desktop startup canonicalizes exactly one legacy OpenRouter ref through the existing credential authority transaction', () => {
  const main = source('electron/main.js');
  assert.match(main, /const OPENROUTER_CANONICAL_CREDENTIAL_REF = 'model:openrouter:default'/u);
  assert.match(main, /desktopCredentialApplicationCoordinator\.runExclusive\('LEGACY_CREDENTIAL_MIGRATION'/u);
  assert.match(main, /canonicalizeOpenRouterCredentialRef\(applicationLeaseToken\)/u);
  const start = main.indexOf('async function canonicalizeOpenRouterCredentialRef');
  const end = main.indexOf('async function saveCredentialFromDesktop', start);
  const migration = main.slice(start, end);
  assert.match(migration, /legacyRefs\.length !== 1/u);
  assert.match(migration, /host\.persistFromMigration\(OPENROUTER_CANONICAL_CREDENTIAL_REF, value/u);
  assert.match(migration, /host\.executeCustodyTransaction\('remove', legacyRef, undefined/u);
  assert.doesNotMatch(migration, /writeFileSync|credentials\.safe\.json|replaceRaw/u);
});

test('OpenRouter onboarding delegates physical model choice to Model Brain and keeps formal qualification separate', () => {
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  const route = source('backend/routes/models.js');
  const configureStart = ui.indexOf('async function autoConfigureOpenRouter');
  const configureEnd = ui.indexOf('async function discoverCloudModels', configureStart);
  const configure = ui.slice(configureStart, configureEnd);
  assert.match(configure, /model:openrouter:default/u);
  assert.match(configure, /cloud\/openrouter\/auto-configure/u);
  assert.doesNotMatch(configure, /commercial-benchmark|runOpenRouterCommercialBenchmark|conditionalRoutes/u);
  assert.match(route, /openRouterOnboardingSmoke\.run/u);
  assert.match(route, /connectionState: 'ready'/u);
  assert.match(route, /qualificationStatus: 'pending'/u);
  assert.match(route, /OPENROUTER_ONBOARDING_SMOKE_FAILED/u);
  assert.match(route, /router\.get\('\/cloud\/openrouter\/status'/u);
});

test('OpenRouter onboarding smoke uses only the Model Brain probe seam and does not own production routes', async () => {
  const registry = fakeRegistry();
  const calls = [];
  const result = await smoke.run({
    snapshot: { credentialRef: 'model:openrouter:default' },
    registry,
    aiGateway: {
      execute: async input => {
        calls.push(input);
        return {
          text: 'YANCE_MODEL_BRAIN_OK',
          evidence: { selectedModel: input.modelId, provider: 'openrouter', requestId: 'probe-1' }
        };
      }
    }
  });
  assert.equal(result.pass, true);
  assert.equal(result.passedModelId, 'cloud-a');
  assert.equal(result.results.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, 'probe');
  assert.equal(calls[0].modelId, 'cloud-a');
  assert.deepEqual(registry.state.routes, {});
  assert.deepEqual(smoke.ALLOWED_TASKS, ['probe']);
  assert.equal(typeof smoke.conditionalRoutes, 'undefined');
});

test('OpenRouter onboarding fails closed when no Model Brain probe can execute', async () => {
  const registry = fakeRegistry();
  await assert.rejects(
    smoke.run({
      snapshot: { credentialRef: 'model:openrouter:default' },
      registry,
      aiGateway: {
        execute: async () => { throw Object.assign(new Error('probe unavailable'), { code: 'MODEL_BRAIN_PROBE_UNAVAILABLE' }); }
      }
    }),
    error => error.code === 'OPENROUTER_ONBOARDING_SMOKE_FAILED'
      && Array.isArray(error.results)
      && error.results.length === 2
  );
  assert.deepEqual(registry.state.routes, {});
});


test('OpenRouter diagnostics reports credential, authentication, catalog and logical-smoke readiness without shadow route status', () => {
  const none = diagnostics.openRouterReadiness({ openRouter: {} });
  assert.equal(none.configured, false);
  assert.equal(none.ready, false);
  assert.equal(none.smokePassed, false);

  const connected = diagnostics.openRouterReadiness({
    openRouter: {
      credentialConfigured: true,
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'passed',
      onboardingSmokeResults: [{ pass: true, returnedModel: 'vendor/a', requestId: 'probe-1' }]
    }
  });
  assert.equal(connected.configured, true);
  assert.equal(connected.authenticated, true);
  assert.equal(connected.catalogReady, true);
  assert.equal(connected.smokePassed, true);
  assert.equal(connected.ready, true);
  assert.equal(Object.prototype.hasOwnProperty.call(connected, 'conditionalReady'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(connected, 'formallyQualified'), false);
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


test('current FIX6D source retains the full real-Chromium typography and reflow matrix gate', () => {
  const probe = source('tools/uat/fix6d_global_typography_matrix_probe.py');
  const gate = source('tests/uat/fix6dGlobalTypographyComputedStyleMatrix.test.js');
  assert.match(probe, /from playwright\.sync_api import sync_playwright/u);
  assert.match(probe, /getComputedStyle/u);
  assert.match(probe, /scrollHeight/u);
  assert.match(probe, /scrollWidth/u);
  assert.match(gate, /assert\.equal\(result\.themeCount, 29/u);
  assert.match(gate, /assert\.equal\(result\.routeCount, 10/u);
  assert.match(gate, /\(3 \* 2 \* 3 \* 2 \* 10\) \+ \(\(29 - 1\) \* 10\)/u);
  assert.match(gate, /assert\.equal\(result\.pass, true/u);
});


test('OpenRouter onboarding smoke cannot create or repair production routing authority', () => {
  const smokeSource = source('backend/services/openRouterOnboardingSmokeService.js');
  assert.deepEqual(smoke.ALLOWED_TASKS, ['probe']);
  assert.equal(typeof smoke.conditionalRoutes, 'undefined');
  assert.doesNotMatch(smokeSource, /applyOpenRouterConditionalRoutes|repairRegistryDocument|humanReviewRequired|quick_reply|deep_reply|director|translation/u);
  assert.equal(typeof routingIntegrity.repairRegistryDocument, 'function');
  assert.match(source('backend/services/modelRoutingIntegrityService.js'), /replyChampionAuthority|workloadPlacementAuthority|routeResolutionAuthority/u);
});
