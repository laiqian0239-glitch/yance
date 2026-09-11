'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/openRouterAutoConfigurationService');

// V21 Model Brain / LiteLLM retired Yance-owned task ranking/selection from catalog
// auto-configuration. This service now only normalizes the OpenRouter catalog, rejects
// non-chat special-purpose generators (audio/image/embedding/...), and registers the usable
// text-chat models; per-task candidate selection is owned downstream by Model Brain.

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

test('one OpenRouter credential auto-discovers, filters non-chat generators, and registers usable text models', async () => {
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
  assert.equal(snapshot.catalogCount, catalog.length);
  assert.equal(snapshot.usableCatalogCount, 7);
  assert.equal(snapshot.registeredModelCount, registered.length);
  assert.equal(registered.length, 7);
  assert.equal(synchronized.endpoint, 'https://openrouter.ai/api/v1');
  assert.equal(synchronized.credentialRef, credentialRef);
  // Audio/image generators never enter the usable text-chat catalog.
  assert.equal(synchronized.models.some(row => /lyria/iu.test(row.name)), false);
  assert.equal(synchronized.models.some(row => row.name === 'vendor/image-only'), false);
  assert.equal(synchronized.models.some(row => row.name === 'anthropic/claude-sonnet'), true);
  assert.equal(registered.every(row => row.credentialRef === credentialRef), true);
  assert.equal(registered.every(row => row.endpoint === 'https://openrouter.ai/api/v1'), true);
  // A text-in/image-in -> text-out model carries the vision capability alongside text.
  assert.deepEqual(registered.find(row => row.name === 'google/gemini-flash:free').capabilities, ['text', 'vision']);
  assert.equal(registered.every(row => Array.isArray(row.catalogMetadata.supportedParameters)), true);
  assert.equal(savedSnapshot.credentialRef, credentialRef);
  assert.equal(savedSnapshot.accountStatus, 'connected');
  assert.equal(JSON.stringify(snapshot).includes('secret-not-exported'), false, 'API key never enters the public snapshot');
  assert.equal(snapshot.accountStatus, 'connected');
  assert.equal(snapshot.qualificationStatus, 'pending');
  assert.equal(snapshot.key.usageWeekly, 0);
  assert.equal(snapshot.key.limitRemaining, 15);
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

test('catalog normalization exposes modality and parameter capabilities', () => {
  const row = service.normalizeCatalogModel(model('demo/free-model', {
    inputModalities: ['text', 'image', 'audio'],
    supportedParameters: ['structured_outputs', 'reasoning', 'tools']
  }));
  assert.equal(row.textOutput, true);
  assert.equal(row.text, true);
  assert.equal(row.vision, true);
  assert.equal(row.audio, true);
  assert.equal(row.structuredOutput, true);
  assert.equal(row.reasoning, true);
  assert.equal(row.tools, true);
  assert.deepEqual(row.inputModalities, ['text', 'image', 'audio']);
  assert.equal(row.promptPerMillion, 0);
  assert.equal(row.completionPerMillion, 0);
});

test('capability classifier separates chat analysis models from image and audio generators', () => {
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
  assert.equal(chatVision.text, true);
  assert.equal(chatVision.vision, true);
  assert.equal(chatVision.audio, true);
  assert.equal(service.isSpecialPurpose(chatVision), false);
  assert.equal(music.text, false);
  assert.equal(service.isSpecialPurpose(music), true);
  assert.equal(image.text, false);
  assert.equal(service.isSpecialPurpose(image), true);
});

test('missing OpenRouter price fields normalize to zero numeric rates rather than a free flag', () => {
  const raw = model('demo/price-unknown');
  delete raw.pricing;
  const row = service.normalizeCatalogModel(raw);
  assert.equal(row.promptPerMillion, 0);
  assert.equal(row.completionPerMillion, 0);
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
  assert.equal(result.accountStatus, 'connected');
  assert.equal(saved.accountStatus, 'connected');
  assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
});
