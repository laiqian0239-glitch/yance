'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiGateway = require('../services/aiGateway');
const routing = require('../services/modelRoutingIntegrityService');

function model(id, overrides = {}) {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    available: true,
    qualification: 'verified',
    allowedTasks: ['translation'],
    catalogMetadata: { taskEligibility: { translation: true } },
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
      model('cloud-free'),
      model('cloud-paid'),
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

test('AI workbench no longer hard-codes a tiny 6/3 benchmark or treats automatic routes as conditional trials', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /maxModels\s*:\s*6/u);
  assert.doesNotMatch(source, /maxReplyModels\s*:\s*3/u);
  assert.match(source, /benchmarkPlan/u);
  assert.match(source, /未评估目录/u);
  assert.match(source, /allowConditional:replyTask&&conditionalSelected&&primarySelection==='manual'/u);
});
