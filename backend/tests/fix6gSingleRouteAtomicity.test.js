'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AiGateway } = require('../services/aiGateway');

function conditionalModel(id, provider, score) {
  return {
    id,
    name: id,
    modelSlug: `${provider}/${id}`,
    provider,
    qualification: 'verified',
    available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastSuccessAt: '2026-07-31T12:00:00.000Z',
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      status: 'REPLY_BRAIN_FAILED',
      testedAt: '2026-07-31T12:00:00.000Z',
      completed: true,
      pass: false,
      score,
      qualifyingTasks: [],
      scenarios: []
    }
  };
}

test('modelRegistry.setRoute validates and writes only the target task', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-route-'));
  const script = String.raw`
const registry = require('./backend/services/modelRegistry');
const { closeR32Store } = require('./backend/lib/r32StoreSingleton');
(async () => {
  const model = (id, provider, score) => ({
    id, name: id, modelSlug: provider + '/' + id, provider,
    qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastSuccessAt: '2026-07-31T12:00:00.000Z',
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_FAILED',
      testedAt: '2026-07-31T12:00:00.000Z', completed: true, pass: false,
      score, qualifyingTasks: [], scenarios: []
    }
  });
  await registry.write({
    schemaVersion: 3,
    models: [model('claude-opus-5', 'anthropic', 82), model('gpt-5.6-sol', 'openai', 80)],
    routes: {
      summary: { primary: 'missing-model', primarySelection: 'manual', enabled: true },
      deep_reply: { primary: 'also-missing', primarySelection: 'manual', enabled: true }
    },
    history: []
  });
  const state = await registry.setRoute('quick_reply', {
    primary: 'claude-opus-5', primarySelection: 'manual',
    fallback: 'gpt-5.6-sol', fallbackSelection: 'manual',
    enabled: true, allowConditional: true, humanReviewRequired: true
  });
  if (state.routes.quick_reply.primary !== 'claude-opus-5') throw new Error('TARGET_ROUTE_NOT_WRITTEN');
  if (state.routes.quick_reply.fallback !== 'gpt-5.6-sol') throw new Error('TARGET_FALLBACK_NOT_WRITTEN');
  if (state.routes.summary.primary !== 'missing-model') throw new Error('UNRELATED_ROUTE_MUTATED');
  if (state.routes.deep_reply.primary !== 'also-missing') throw new Error('SECOND_UNRELATED_ROUTE_MUTATED');
  if (state.routes.quick_reply.requested.primary.mode !== 'manual') throw new Error('REQUESTED_INTENT_MISSING');
  closeR32Store();
})().catch(error => { console.error(error); try { closeR32Store(); } catch {} process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, TERM: 'dumb' },
    encoding: 'utf8',
    timeout: 120000
  });
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('AiGateway routeOverride tests a draft without consulting unrelated persisted routes', () => {
  const primary = conditionalModel('claude-opus-5', 'anthropic', 82);
  const fallback = conditionalModel('gpt-5.6-sol', 'openai', 80);
  const registry = {
    read: () => ({
      models: [primary, fallback],
      routes: { quick_reply: { enabled: false }, summary: { primary: 'missing-model', enabled: true } },
      aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
      aiBudgetUsage: { spentUsd: 0 }
    }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({ registry, executeModel: async () => ({ text: 'Hallo!' }) });
  const route = gateway.resolveRoute('quick_reply', '', {
    executionMode: 'candidate-only',
    routeOverride: {
      primary: primary.id,
      fallback: fallback.id,
      primarySelection: 'manual',
      fallbackSelection: 'manual',
      enabled: true,
      allowConditional: true,
      humanReviewRequired: true
    }
  });

  assert.equal(route.primary.id, primary.id);
  assert.equal(route.fallback.id, fallback.id);
  assert.equal(route.route.primary, primary.id);
  assert.equal(route.routeOverrideApplied, true);
});

test('models API exposes per-task PATCH and tests routeDraft without a global routes save', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/models.js'), 'utf8');
  assert.match(source, /router\.patch\('\/routes\/:task'/u);
  assert.match(source, /req\.body\?\.routeDraft/u);
  assert.match(source, /registry\.validateRouteDraft/u);
  const testHandler = source.slice(source.indexOf("router.post('/routes/:task/test'"), source.indexOf("router.post('/routes'"));
  assert.doesNotMatch(testHandler, /registry\.setRoutes/u);
  assert.match(testHandler, /candidateExecutionService\.execute/u);
  assert.match(testHandler, /routeTestId/u);
});
