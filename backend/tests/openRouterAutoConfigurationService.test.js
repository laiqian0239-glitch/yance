'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/openRouterAutoConfigurationService');

function model(id, options = {}) {
  return {
    id,
    name: options.name || id,
    description: options.description || 'General multilingual chat model',
    context_length: options.contextLength || 131072,
    architecture: {
      input_modalities: options.inputModalities || ['text'],
      output_modalities: options.outputModalities || ['text'],
      modality: `${(options.inputModalities || ['text']).join('+')}->${(options.outputModalities || ['text']).join('+')}`
    },
    supported_parameters: options.supportedParameters || ['temperature', 'max_tokens', 'response_format'],
    pricing: {
      prompt: String(options.prompt ?? 0),
      completion: String(options.completion ?? 0),
      request: String(options.request ?? 0)
    },
    top_provider: { max_completion_tokens: 8192 }
  };
}

test('one OpenRouter credential auto-discovers, filters, ranks, and registers a compact Yance model pool', async () => {
  const credentialRef = 'model:openrouter:default';
  const securityGuard = { credentials: new Map([[credentialRef, { apiKey: 'secret-not-exported' }]]) };
  const registered = [];
  let synchronized = null;
  let savedSnapshot = null;
  const registry = {
    async synchronizeOpenRouterCatalog(row) { synchronized = row; return { models: [] }; },
    async upsertCloudModel(row) { registered.push(row); return { models: registered }; },
    async recordOpenRouterSnapshot(row) { savedSnapshot = row; }
  };
  const catalog = [
    model('google/gemini-flash:free', { name: 'Gemini Flash Free', inputModalities: ['text', 'image'] }),
    model('qwen/qwen-large:free', { name: 'Qwen Large Free', supportedParameters: ['temperature', 'structured_outputs'] }),
    model('anthropic/claude-sonnet', { name: 'Claude Sonnet', prompt: 0.000003, completion: 0.000015, supportedParameters: ['temperature', 'structured_outputs', 'reasoning'] }),
    model('openai/gpt-latest', { name: 'GPT Latest', prompt: 0.000002, completion: 0.000012, supportedParameters: ['temperature', 'response_format', 'reasoning'] }),
    model('google/gemini-vision', { name: 'Gemini Vision', inputModalities: ['text', 'image'], prompt: 0.000001, completion: 0.000005 }),
    model('google/lyria-3-pro-preview', { name: 'Google: Lyria 3 Pro Preview', inputModalities: ['text'], outputModalities: ['audio'] }),
    model('openrouter/free', { name: 'Free Models Router' }),
    model('vendor/code-coder:free', { name: 'Code Coder Free', description: 'Coding agent' }),
    model('vendor/image-only', { name: 'Image Generator', inputModalities: ['text'], outputModalities: ['image'] })
  ];
  const calls = [];
  const requestJson = async url => {
    calls.push(url);
    if (url.endsWith('/key')) return { data: { is_free_tier: false, limit: 20, limit_remaining: 15, usage: 5, usage_daily: 1 } };
    if (url.endsWith('/models/user')) return { data: catalog };
    throw new Error(`unexpected URL ${url}`);
  };

  const snapshot = await service.autoConfigure({ credentialRef, securityGuard, registry, requestJson });

  assert.deepEqual(calls, ['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models/user']);
  assert.equal(snapshot.modelCount, catalog.length);
  assert.equal(snapshot.freeModelCount, 2);
  assert.equal(snapshot.registeredModelCount, registered.length);
  assert.equal(synchronized.endpoint, 'https://openrouter.ai/api/v1');
  assert.equal(synchronized.credentialRef, credentialRef);
  assert.equal(synchronized.models.some(row => row.name === 'openrouter/free'), false);
  assert.equal(synchronized.models.some(row => /coder/u.test(row.name)), false);
  assert.equal(synchronized.models.some(row => row.name === 'anthropic/claude-sonnet'), true);
  assert.equal(synchronized.models.some(row => /lyria/iu.test(row.name)), false, 'audio generation models never enter chat or translation candidates');
  assert.ok(registered.length >= 4 && registered.length <= 18);
  assert.equal(registered.every(row => row.credentialRef === credentialRef), true);
  assert.equal(registered.every(row => row.endpoint === 'https://openrouter.ai/api/v1'), true);
  assert.equal(registered.some(row => row.name === 'openrouter/free'), false, 'random free router is not a formal Yance route');
  assert.equal(registered.some(row => /coder/u.test(row.name)), false, 'coding models are filtered from relationship reply tasks');
  assert.equal(registered.every(row => row.taskHints.every(task => ['translation', 'quick_reply', 'director', 'deep_reply', 'media_analysis', 'memory_extraction', 'fact_extraction', 'understanding', 'summary', 'persona_rewrite'].includes(task))), true, 'registered task hints use canonical executable Yance task names');
  assert.equal(registered.some(row => row.taskHints.includes('memory_extraction')), true, 'memory extraction is a first-class executable task');
  assert.equal(registered.some(row => row.taskHints.includes('media_analysis')), true, 'media analysis is a first-class executable task');
  assert.equal(registered.some(row => row.taskHints.includes('persona_rewrite')), true, 'persona rewrite is a first-class executable task');
  assert.equal(snapshot.selections.translation.some(row => row.free), true, 'free models are actively used for translation candidates');
  assert.equal(snapshot.selections.director.some(row => /claude|gpt/u.test(row.id)), true, 'high-quality paid models remain director candidates');
  assert.equal(snapshot.selections.media_analysis.every(row => row.visionInput), true);
  assert.equal(savedSnapshot.credentialRef, credentialRef);
  assert.equal(JSON.stringify(snapshot).includes('secret-not-exported'), false, 'API key never enters the public snapshot');
  assert.equal(snapshot.benchmarkStatus, 'pending');
  assert.equal(snapshot.key.usageWeekly, 0);
});

test('missing secure credential blocks auto configuration before any model is registered', async () => {
  let registered = 0;
  await assert.rejects(
    service.autoConfigure({
      credentialRef: 'missing',
      securityGuard: { credentials: new Map() },
      registry: { async upsertCloudModel() { registered += 1; } },
      requestJson: async () => ({})
    }),
    error => error.code === 'OPENROUTER_CREDENTIAL_MISSING'
  );
  assert.equal(registered, 0);
});

test('catalog normalization recognizes zero-price free variants and model capabilities', () => {
  const row = service.normalizeCatalogModel(model('demo/free-model', {
    inputModalities: ['text', 'image', 'audio'],
    supportedParameters: ['structured_outputs', 'reasoning', 'tools']
  }));
  assert.equal(row.free, true);
  assert.equal(row.textOutput, true);
  assert.equal(row.visionInput, true);
  assert.equal(row.audioInput, true);
  assert.equal(row.structuredOutput, true);
  assert.equal(row.reasoning, true);
  assert.equal(row.tools, true);
  assert.equal(row.pricingKnown, true);
  assert.equal(row.taskEligibility.translation, true);
  assert.equal(row.taskEligibility.media_analysis, true);
});

test('capability classifier separates chat analysis models from image, audio, and video generators', () => {
  const chatVision = service.normalizeCatalogModel(model('google/gemini-multimodal', {
    inputModalities: ['text', 'image', 'audio'],
    outputModalities: ['text']
  }));
  const music = service.normalizeCatalogModel(model('google/lyria-3-clip-preview', {
    name: 'Google: Lyria 3 Clip Preview',
    inputModalities: ['text'],
    outputModalities: ['audio']
  }));
  const image = service.normalizeCatalogModel(model('openai/gpt-image-1', {
    name: 'OpenAI: GPT Image 1',
    inputModalities: ['text', 'image'],
    outputModalities: ['image']
  }));
  assert.equal(chatVision.taskEligibility.quick_reply, true);
  assert.equal(chatVision.taskEligibility.media_analysis, true);
  assert.equal(music.generationOnly, true);
  assert.equal(music.taskEligibility.quick_reply, false);
  assert.equal(music.taskEligibility.media_analysis, false);
  assert.equal(image.generationOnly, true);
  assert.equal(image.taskEligibility.translation, false);
  assert.equal(service.isSpecialPurpose(music), true);
  assert.equal(service.isSpecialPurpose(image), true);
});

test('missing OpenRouter price fields are unknown rather than silently treated as free', () => {
  const raw = model('demo/price-unknown');
  delete raw.pricing;
  const row = service.normalizeCatalogModel(raw);
  assert.equal(row.pricingKnown, false);
  assert.equal(row.free, false);
});

test('account status refresh reads the real key endpoint without exposing the API key', async () => {
  const credentialRef = 'model:openrouter:refresh';
  const securityGuard = { credentials: new Map([[credentialRef, { apiKey: 'refresh-secret' }]]) };
  let saved = null;
  let observed = null;
  const result = await service.refreshAccountStatus({
    credentialRef,
    securityGuard,
    registry: { async recordOpenRouterSnapshot(row) { saved = row; } },
    requestJson: async (url, options) => {
      observed = { url, apiKey: options.apiKey };
      return { data: { is_free_tier: true, limit: 10, limit_remaining: 7.5, usage: 2.5, usage_daily: 0.5, usage_weekly: 1.5, usage_monthly: 2.5 } };
    }
  });
  assert.equal(observed.url, 'https://openrouter.ai/api/v1/key');
  assert.equal(observed.apiKey, 'refresh-secret');
  assert.equal(result.key.limitRemaining, 7.5);
  assert.equal(result.key.usageWeekly, 1.5);
  assert.equal(saved.balanceRefreshStatus, 'success');
  assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
});
