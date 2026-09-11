'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const frontier = require('../services/openRouterFrontierCandidateAuthority');
const autoConfig = require('../services/openRouterAutoConfigurationService');

function catalogModel(id, options = {}) {
  const created = options.created ?? 1_786_000_000;
  return autoConfig.normalizeCatalogModel({
    id,
    name: id,
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

// V21 Model Brain / LiteLLM retired Yance-owned preferred-primary/fallback/shortlist planning
// (frontier.buildPlan) and onboarding independent-model ordering. Physical provider selection,
// fallback and cross-provider independence are owned by LiteLLM. The remaining Yance seams are
// catalog normalization, special-purpose exclusion and non-interactive Batch rejection.

test('Batch-only catalog models are flagged and excluded while interactive text models remain usable', () => {
  const batch = catalogModel('anthropic/claude-opus-5:batch');
  const normal = catalogModel('anthropic/claude-opus-5');
  assert.equal(frontier.isBatchOnly(batch), true);
  assert.equal(autoConfig.exclusionReason(batch), 'batch-only-model');
  assert.equal(autoConfig.isSpecialPurpose(batch), true);
  assert.equal(frontier.isBatchOnly(normal), false);
  assert.equal(autoConfig.exclusionReason(normal), '');
  assert.equal(autoConfig.isSpecialPurpose(normal), false);
});

test('auto configuration registers usable text chat models and never registers Batch-only models', async () => {
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
  assert.equal(result.catalogCount, 4);
  assert.equal(result.usableCatalogCount, 3);
  assert.equal(result.registeredModelCount, 3);
  assert.deepEqual(result.registered.map(row => row.name).sort(), [
    'anthropic/claude-opus-5',
    'google/gemma-4-31b-it:free',
    'openai/gpt-5.6-sol'
  ]);
  assert.equal(snapshot.usableCatalogCount, 3);
  assert.equal(snapshot.accountStatus, 'connected');
});
