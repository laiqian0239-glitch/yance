'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const frontier = require('../services/openRouterFrontierCandidateAuthority');
const autoConfig = require('../services/openRouterAutoConfigurationService');
const onboarding = require('../services/openRouterOnboardingSmokeService');

function catalogModel(id, options = {}) {
  const created = options.created ?? 1_786_000_000;
  return autoConfig.normalizeCatalogModel({
    id,
    name: options.name || id,
    description: options.description || 'General multilingual conversational model',
    created,
    context_length: options.contextLength || 1_000_000,
    architecture: {
      input_modalities: ['text', ...(options.vision ? ['image'] : [])],
      output_modalities: ['text'],
      modality: options.vision ? 'text+image->text' : 'text->text'
    },
    supported_parameters: options.supportedParameters || ['temperature', 'response_format', 'reasoning', 'tools'],
    pricing: {
      prompt: String(options.prompt ?? 0.000005),
      completion: String(options.completion ?? 0.000025),
      request: '0'
    },
    top_provider: { max_completion_tokens: 32768 }
  });
}

function registryModel(id, source = 'openrouter-auto') {
  return {
    id: `model:${id}`,
    name: id,
    displayName: id,
    source,
    provider: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1',
    credentialRef: 'model:openrouter:default',
    available: true,
    configured: true,
    capabilities: ['text'],
    catalogMetadata: { taskEligibility: { quick_reply: true, director: true, deep_reply: true, translation: true } }
  };
}

test('frontier authority guarantees exact preferred cross-provider primary and fallback when catalog exposes both', () => {
  const models = [
    catalogModel('anthropic/claude-opus-5-fast', { prompt: 0.00001, completion: 0.00005, created: 1_786_100_000 }),
    catalogModel('anthropic/claude-opus-5', { created: 1_786_000_000 }),
    catalogModel('openai/gpt-5.6-sol', { completion: 0.00003, created: 1_785_000_000 }),
    catalogModel('x-ai/grok-4.5', { prompt: 0.000004, completion: 0.00002, created: 1_787_000_000 }),
    catalogModel('google/gemini-3.6-pro', { prompt: 0.000003, completion: 0.000018, created: 1_788_000_000 })
  ];
  const plan = frontier.buildPlan(models);
  assert.equal(plan.preferredPrimary.slug, 'anthropic/claude-opus-5');
  assert.equal(plan.preferredFallback.slug, 'openai/gpt-5.6-sol');
  assert.equal(plan.preferredPrimary.provider, 'anthropic');
  assert.equal(plan.preferredFallback.provider, 'openai');
  assert.deepEqual(plan.shortlist.slice(0, 2).map(row => row.id), ['anthropic/claude-opus-5', 'openai/gpt-5.6-sol']);
  assert.equal(plan.shortlist.some(row => row.id === 'anthropic/claude-opus-5-fast'), true, 'Fast may remain a challenger but cannot replace the selected regular primary');
});

test('frontier authority excludes Batch-only models from interactive shortlist and role selections', () => {
  const batch = catalogModel('anthropic/claude-opus-5:batch');
  const normal = catalogModel('anthropic/claude-opus-5');
  const plan = frontier.buildPlan([batch, normal]);
  assert.equal(batch.batchOnly, true);
  assert.equal(plan.shortlist.some(row => /:batch$/u.test(row.id)), false);
  assert.equal(plan.rejected.some(row => row.slug === 'anthropic/claude-opus-5:batch' && row.reasonCode === 'BATCH_ONLY_INTERACTIVE_FORBIDDEN'), true);
});

test('auto configuration persists preferred route intent and never registers Batch-only models', async () => {
  const credentialRef = 'model:openrouter:default';
  const securityGuard = { credentials: new Map([[credentialRef, { apiKey: 'secret' }]]) };
  const registered = [];
  let snapshot = null;
  const rawCatalog = [
    catalogModel('anthropic/claude-opus-5').raw,
    catalogModel('openai/gpt-5.6-sol').raw,
    catalogModel('anthropic/claude-opus-5:batch').raw,
    catalogModel('google/gemma-4-31b-it:free', { prompt: 0, completion: 0 }).raw
  ];
  const result = await autoConfig.autoConfigure({
    credentialRef,
    securityGuard,
    registry: {
      async synchronizeOpenRouterCatalog() {},
      async upsertCloudModel(row) { registered.push(row); return { models: registered }; },
      async recordOpenRouterSnapshot(row) { snapshot = row; }
    },
    requestJson: async url => url.endsWith('/key')
      ? { data: { limit: 15, limit_remaining: 14 } }
      : { data: rawCatalog }
  });
  assert.equal(registered.some(row => /:batch$/u.test(row.name)), false);
  assert.equal(result.preferredRoute.primarySlug, 'anthropic/claude-opus-5');
  assert.equal(result.preferredRoute.fallbackSlug, 'openai/gpt-5.6-sol');
  assert.equal(snapshot.preferredRoute.primarySlug, 'anthropic/claude-opus-5');
  assert.deepEqual(result.selections.quick_reply.slice(0, 2).map(row => row.id), ['anthropic/claude-opus-5', 'openai/gpt-5.6-sol']);
});

test('onboarding smoke uses preferred primary then preferred fallback before other candidates', () => {
  const models = [
    registryModel('x-ai/grok-4.5'),
    registryModel('openai/gpt-5.6-sol'),
    registryModel('anthropic/claude-opus-5')
  ];
  const selected = onboarding.selectIndependentModels({
    preferredRoute: {
      primarySlug: 'anthropic/claude-opus-5',
      fallbackSlug: 'openai/gpt-5.6-sol'
    },
    selections: { quick_reply: [{ id: 'x-ai/grok-4.5' }] }
  }, models, 3);
  assert.deepEqual(selected.map(row => row.name), [
    'anthropic/claude-opus-5',
    'openai/gpt-5.6-sol',
    'x-ai/grok-4.5'
  ]);
});

test('onboarding smoke preserves provider independence when preferred fallback is unavailable', () => {
  const models = [
    registryModel('anthropic/claude-opus-5'),
    registryModel('anthropic/claude-sonnet-5'),
    registryModel('openai/gpt-5.6-terra')
  ];
  const selected = onboarding.selectIndependentModels({
    preferredRoute: {
      primarySlug: 'anthropic/claude-opus-5',
      fallbackSlug: 'openai/gpt-5.6-sol'
    },
    selections: {
      quick_reply: [
        { id: 'anthropic/claude-sonnet-5' },
        { id: 'openai/gpt-5.6-terra' }
      ]
    }
  }, models, 3);
  assert.deepEqual(selected.slice(0, 2).map(row => row.name), [
    'anthropic/claude-opus-5',
    'openai/gpt-5.6-terra'
  ]);
});
