'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiGateway = require('../services/aiGateway');
const routing = require('../services/modelRoutingIntegrityService');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const routeDraftAuthority = require('../../frontend/js/r32-route-draft-authority');

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

test('translation profiles keep realtime and outbound on qualified cloud while history uses local model', () => {
  const route = {
    primary: 'cloud-free',
    fallback: 'cloud-paid',
    historyPrimary: 'local-history',
    historyFallback: 'local-history-2',
    offlineFallback: 'local-history'
  };
  assert.deepEqual(aiGateway.translationRouteIds(route, 'realtime'), { primaryId: 'cloud-free', fallbackId: 'cloud-paid' });
  assert.deepEqual(aiGateway.translationRouteIds(route, 'outbound'), { primaryId: 'cloud-free', fallbackId: 'cloud-paid' });
  assert.deepEqual(aiGateway.translationRouteIds(route, 'history'), { primaryId: 'local-history', fallbackId: 'local-history-2' });
  assert.deepEqual(aiGateway.translationRouteIds(route, 'offline'), { primaryId: 'local-history', fallbackId: 'local-history-2' });
});

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

test('AI workbench keeps persisted automatic routes formal while allowing an explicit conditional single-task probe', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /maxModels\s*:\s*6/u);
  assert.doesNotMatch(source, /maxReplyModels\s*:\s*3/u);
  assert.match(source, /benchmarkPlan/u);
  assert.match(source, /未评估目录/u);
  assert.match(source, /routeDraftAuthority\.project/u);

  const route = {
    id: 'quick_reply',
    main: 'auto',
    backup: 'auto',
    actualMain: 'openrouter/conditional-primary',
    actualBackup: 'openrouter/conditional-fallback',
    requestedEnabled: true
  };
  const services = [
    { id: 'openrouter/conditional-primary', taskQualifications: { quick_reply: { selectable: true, full: false } } },
    { id: 'openrouter/conditional-fallback', taskQualifications: { quick_reply: { selectable: true, full: false } } }
  ];
  const persisted = routeDraftAuthority.project(route, services, { purpose: 'persist' });
  const probe = routeDraftAuthority.project(route, services, { purpose: 'test' });

  assert.equal(persisted.primary, '');
  assert.equal(persisted.allowConditional, false);
  assert.equal(probe.primary, 'openrouter/conditional-primary');
  assert.equal(probe.allowConditional, true);
  assert.equal(probe.humanReviewRequired, true);
});
