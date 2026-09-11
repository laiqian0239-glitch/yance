'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round2-model-truth-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `round2-model-truth-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const { closeR32Store } = require('../lib/r32StoreSingleton');
const registry = require('../services/modelRegistry');
const projection = require('../services/modelStatusProjection');
const cloud = require('../services/openAiCompatibleClient');

const endpoint = 'https://openrouter.ai/api/v1';
const credentialRef = 'model:openrouter:test';

function catalogMetadata(prompt = 1, completion = 2) {
  return {
    pricing: { promptPerMillion: prompt, completionPerMillion: completion, request: 0, known: true, requestKnown: true },
    free: prompt === 0 && completion === 0,
    contextLength: 131072
  };
}

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('OpenRouter catalog synchronization disables disappeared models and preserves current models', async () => {
  await registry.upsertCloudModel({ provider: 'openai-compatible', endpoint, credentialRef, name: 'provider/current', displayName: 'Current', source: 'openrouter-auto', resetValidation: false, catalogMetadata: catalogMetadata() });
  await registry.upsertCloudModel({ provider: 'openai-compatible', endpoint, credentialRef, name: 'provider/removed', displayName: 'Removed', source: 'openrouter-auto', resetValidation: false, catalogMetadata: catalogMetadata() });

  const state = await registry.synchronizeOpenRouterCatalog({
    endpoint,
    credentialRef,
    models: [{ name: 'provider/current', displayName: 'Current Updated', capabilities: ['text', 'structured-output'], catalogMetadata: catalogMetadata(0.5, 1.5) }]
  });
  const current = state.models.find(row => row.name === 'provider/current');
  const removed = state.models.find(row => row.name === 'provider/removed');
  assert.equal(current.available, true);
  assert.equal(current.catalogAvailable, true);
  assert.equal(current.displayName, 'Current Updated');
  assert.equal(current.catalogMetadata.pricing.promptPerMillion, 0.5);
  assert.equal(removed.available, false);
  assert.equal(removed.catalogAvailable, false);
  // Current contract: catalog removal only flips catalog availability flags and
  // stamps catalogMissingSince; it must not hijack the qualification blockedReason.
  assert.equal(removed.blockedReason, '等待真实调用测试');
  assert.ok(removed.catalogMissingSince);
});

test('model invocation records provider-reported cost and accumulates tracked cost', async () => {
  let state = registry.read();
  const current = state.models.find(row => row.name === 'provider/current');
  await registry.recordInvocation(current.id, { promptTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.0042, returnedModel: 'provider/current' });
  state = registry.read();
  let recorded = state.models.find(row => row.id === current.id);
  assert.equal(recorded.lastSuccessfulInvocation.costUsd, 0.0042);
  assert.equal(recorded.totalCostUsd, 0.0042);
  assert.equal(recorded.callCount, 1);

  // Catalog-estimate fallback is retired: callers supply authoritative cost explicitly.
  await registry.recordInvocation(current.id, { promptTokens: 1000, outputTokens: 1000, totalTokens: 2000, costUsd: 0.002, returnedModel: 'provider/current' });
  state = registry.read();
  recorded = state.models.find(row => row.id === current.id);
  assert.equal(recorded.lastSuccessfulInvocation.costUsd, 0.002);
  assert.equal(recorded.totalCostUsd, 0.0062);
  assert.equal(recorded.callCount, 2);
});

test('model status returns a sanitized OpenRouter snapshot and tracked cost summary after restart', async () => {
  await registry.recordOpenRouterSnapshot({
    credentialRef,
    endpoint,
    benchmarkStatus: 'completed',
    key: { limitRemaining: 7.5, usageMonthly: 2.5 }
  });
  const state = registry.read();
  const projected = projection.project(state);
  assert.equal(projected.openRouter.credentialConfigured, true);
  assert.equal(projected.openRouter.credentialRef, undefined);
  assert.equal(projected.openRouter.benchmarkStatus, 'completed');
  assert.equal(projected.openRouter.key.limitRemaining, 7.5);
  assert.equal(projected.summary.openRouterConnected, true);
  assert.equal(projected.summary.trackedCloudCostUsd, 0.0062);
});

test('OpenAI-compatible client retains provider-reported usage cost for registry accounting', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '' },
    async text() {
      return JSON.stringify({
        id: 'gen-1', model: 'provider/current', choices: [{ message: { content: 'Hallo' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.00014 }
      });
    }
  });
  t.after(() => { global.fetch = originalFetch; });
  const result = await cloud.chat({ endpoint, apiKey: 'not-persisted', model: 'provider/current', messages: [{ role: 'user', content: 'Hi' }], options: { timeoutMs: 3000 } });
  assert.equal(result.costUsd, 0.00014);
  assert.equal(result.costSource, 'provider-usage');
  assert.equal(result.promptTokens, 10);
  assert.equal(result.outputTokens, 4);
});
