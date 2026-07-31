'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const cloud = require('../services/openAiCompatibleClient');
const openRouter = require('../services/openRouterAutoConfigurationService');
const routing = require('../services/modelRoutingIntegrityService');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function translationModel(id, provider) {
  return {
    id,
    name: id,
    provider,
    available: true,
    qualification: 'verified',
    allowedTasks: ['translation'],
    callCount: 1
  };
}

function replyModel(id, provider, score) {
  return {
    id,
    name: id,
    provider,
    available: true,
    qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    callCount: 1,
    lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      pass: true,
      status: 'REPLY_BRAIN_QUALIFIED',
      completed: true,
      score,
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 25, score: 25, issues: [] },
        { id: 'english_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 25, issues: [] },
        { id: 'director_schema', pass: true, weight: 15, score: 15, issues: [] },
        { id: 'latency', pass: true, weight: 15, score: 15, issues: [] }
      ]
    }
  };
}

test('OpenAI-compatible transport sends a real Bearer authorization header without exposing the key', async () => {
  let observed = null;
  const server = http.createServer((req, res) => {
    observed = { authorization: req.headers.authorization, path: req.url };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const address = await listen(server);
  try {
    const result = await cloud.requestJson(`http://127.0.0.1:${address.port}/api/v1/key`, {
      apiKey: 'Bearer test-openrouter-key',
      timeoutMs: 5000
    });
    assert.equal(result.ok, true);
    assert.deepEqual(observed, { authorization: 'Bearer test-openrouter-key', path: '/api/v1/key' });
  } finally {
    await close(server);
  }
});

test('Node native fallback transport also sends the authorization header deterministically', async () => {
  let authorization = '';
  const server = http.createServer((req, res) => {
    authorization = String(req.headers.authorization || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  const address = await listen(server);
  try {
    await cloud.nativeRequestJson(`http://127.0.0.1:${address.port}/api/v1/models/user`, {
      apiKey: 'test-native-key',
      timeoutMs: 5000
    });
    assert.equal(authorization, 'Bearer test-native-key');
  } finally {
    await close(server);
  }
});

test('OpenRouter secure credential normalization strips a pasted Bearer prefix before both account requests', async () => {
  const ref = 'model:openrouter:default';
  const observed = [];
  const registry = {
    async synchronizeOpenRouterCatalog() {},
    async upsertCloudModel() {},
    async recordOpenRouterSnapshot() {}
  };
  const catalog = [{
    id: 'provider/chat-model',
    name: 'High quality multilingual chat',
    description: 'General multilingual relationship conversation model',
    context_length: 131072,
    architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
    supported_parameters: ['temperature', 'max_tokens', 'response_format', 'structured_outputs'],
    pricing: { prompt: '0.000001', completion: '0.000003', request: '0' },
    top_provider: { max_completion_tokens: 8192 }
  }];
  await openRouter.autoConfigure({
    credentialRef: ref,
    securityGuard: { credentials: new Map([[ref, { apiKey: '  Bearer normalized-key  ' }]]) },
    registry,
    requestJson: async (url, options) => {
      observed.push({ url, apiKey: options.apiKey });
      return url.endsWith('/key') ? { data: { is_free_tier: false } } : { data: catalog };
    }
  });
  assert.equal(observed.length, 2);
  assert.equal(observed.every(row => row.apiKey === 'normalized-key'), true);
});

test('automatic route authority prefers qualified cloud quality and retains local as fallback', () => {
  const cloudReply = replyModel('cloud-reply', 'openai-compatible', 92);
  const localReply = replyModel('local-reply', 'ollama', 92);
  const result = routing.repairRegistryDocument({
    models: [localReply, cloudReply],
    routes: { quick_reply: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto' } }
  });
  assert.equal(result.document.routes.quick_reply.primary, 'cloud-reply');
  assert.equal(result.document.routes.quick_reply.fallback, 'local-reply');
  assert.equal(result.document.routes.quick_reply.qualityPolicyVersion, 'ai-quality-cloud-first-v2');
});

test('translation defaults to cloud quality but preserves an explicit local-only policy', () => {
  const models = [
    translationModel('translategemma:4b', 'ollama'),
    translationModel('cloud-translation', 'openai-compatible')
  ];
  const qualityFirst = routing.repairRegistryDocument({
    models,
    routes: { translation: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto' } }
  });
  assert.equal(qualityFirst.document.routes.translation.primary, 'cloud-translation');
  assert.equal(qualityFirst.document.routes.translation.fallback, 'translategemma:4b');
  assert.equal(qualityFirst.document.routes.translation.allowCloudFallback, true);

  const localOnly = routing.repairRegistryDocument({
    models,
    routes: { translation: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', allowCloudFallback: false } }
  });
  assert.equal(localOnly.document.routes.translation.primary, 'translategemma:4b');
  assert.equal(localOnly.document.routes.translation.fallback, '');
});

test('AI workbench makes OpenRouter the primary action and waits for credential restart before account discovery', () => {
  const frontend = source('frontend/js/r32-ai-workbench-runtime.js');
  const openRouterAction = frontend.indexOf('class="primary" id="aiwAddCloud"');
  const localScan = frontend.indexOf('id="aiwScanModels"');
  assert.ok(openRouterAction >= 0 && localScan > openRouterAction);
  assert.match(frontend, /waitForAiBackendAfterCredentialRestart/);
  assert.match(frontend, /assertCredentialSave\(saved\)/);
  assert.match(frontend, /q\('aiwCloudKey'\)\.value=''/);
  assert.match(frontend, /localOnly:false/);
  assert.match(frontend, /云端高能力模型已成为回复、导演和翻译主路由/);
  assert.doesNotMatch(frontend, /默认只使用通过真实回复基准的本地模型/);
});

test('backend OpenRouter auto-configuration persists cloud-first automation after credential validation', () => {
  const routes = source('backend/routes/models.js');
  assert.match(routes, /aiAutomation\.updateConfig\(\{ enabled: true, localOnly: false \}\)/);
  assert.match(routes, /routingPolicy: 'cloud-quality-first-local-fallback'/);
});

test('Batch15 removes screenshot-confirmed composer text artifacts', () => {
  const html = source('frontend/index.html');
  const runtime = source('frontend/js/r32-ui-runtime.js');
  assert.doesNotMatch(html, /placeholder="选择左侧会话后输入消息"/);
  assert.doesNotMatch(runtime, /选择左侧会话后输入消息/);
  assert.doesNotMatch(html, /中→目标语 [●○?]/);
  for (const id of ['emojiBtn', 'gifBtn', 'imageBtn', 'voiceBtn']) {
    assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<svg\\b[\\s\\S]*?<\\/button>`));
  }
});

test('Batch15 reflows the shell and account center before controls overlap', () => {
  const shellCss = source('frontend/r32-conversation-center-v2.css');
  const accountCss = source('frontend/r32-account-center.css');
  const layoutCss = source('frontend/r32-production-workspace-layout.css');
  const narrowFlowCss = source('frontend/r32-flat-document-flow.css');
  assert.doesNotMatch(shellCss, /\.app\.ai-hidden\{[^}]*minmax\(560px,1fr\)/);
  assert.doesNotMatch(shellCss.match(/\.nav-compact \.nav-mode-toggle\{([^}]*)\}/)?.[1] || '', /position:absolute/);
  assert.match(narrowFlowCss, /@media\(max-width:820px\)[\s\S]*?:is\(\.ac32-main,\.sc32-body,\.sr32-body\)\{[^}]*grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(accountCss, /\.ac32-filters\{[^}]*flex-wrap:wrap/);
});

test('Batch15 keeps settings labels and switches in the same bounded row', () => {
  const systemCss = source('frontend/r32-system-center.css');
  assert.match(systemCss, /\.sc32-toggle-row\{[^}]*max-width:none[^}]*border-radius:var\(--ui-control-radius\)/);
  assert.match(systemCss, /\.sc32-toggle-row \.sc32-switch\{[^}]*justify-self:end/);
});

test('Batch15 normalizes display actions through one shared size class', () => {
  const html = source('frontend/index.html');
  const layoutCss = source('frontend/r32-production-workspace-layout.css');
  assert.equal((html.match(/<button class="display-action/g) || []).length, 2);
  assert.match(html, /\.display-actions \.display-action\{[^}]*height:44px/);
  assert.doesNotMatch(layoutCss, /\.display-settings-panel \.diagnostic-trigger\{[\s\S]*?margin:11px 0 0!important/);
});
