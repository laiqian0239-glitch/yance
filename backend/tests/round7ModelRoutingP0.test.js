'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routing = require('../services/modelRoutingIntegrityService');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function model(id, overrides = {}) {
  const evidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95 };
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    available: true,
    qualification: 'verified',
    allowedTasks: ['translation'],
    catalogMetadata: { taskEligibility: { translation: true } },
    lastCommercialBenchmark: evidence,
    roleQualificationReceipts: { translation: roleReceipts.issueFromEvidence({ modelId: id, task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' }) },
    ...overrides
  };
}

test('routing repair preserves benchmark authority selections and validates history translation models', () => {
  const document = {
    models: [
      model('cloud-free', { modelSlug: 'anthropic/cloud-free' }),
      model('cloud-paid', { modelSlug: 'openai/cloud-paid' }),
      model('local-history', { provider: 'ollama' })
    ],
    routes: {
      translation: {
        primary: 'cloud-free',
        fallback: 'cloud-paid',
        historyPrimary: 'local-history',
        source: 'commercial-model-benchmark-translation',
        primarySelection: 'auto',
        fallbackSelection: 'auto',
        requestedEnabled: true,
        enabled: true,
        allowCloudFallback: true
      }
    }
  };
  const result = routing.repairRegistryDocument(document, { autoSelectVerified: true, rebalanceAutoRoutes: true });
  assert.equal(result.document.routes.translation.primary, 'cloud-free');
  assert.equal(result.document.routes.translation.fallback, 'cloud-paid');
  assert.equal(result.document.routes.translation.historyPrimary, 'local-history');
  assert.equal(result.quarantine.length, 0);
});

test('catalog task eligibility blocks generation-only models even when they are otherwise marked verified', () => {
  const imageGenerator = model('gpt-image', {
    catalogMetadata: { taskEligibility: { translation: false, quick_reply: false, director: false, deep_reply: false, media_analysis: false } }
  });
  assert.equal(routing.modelTaskPolicyAllows(imageGenerator, 'translation'), false);
  assert.equal(routing.eligibleForTask(imageGenerator, 'translation', { allowExperimental: true }), false);
});
