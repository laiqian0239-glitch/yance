'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-champion-brain-registry-'));
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
  instanceId: `champion-brain-registry-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const registry = require('../services/modelRegistry');
const { closeR32Store } = require('../lib/r32StoreSingleton');

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('model registry persists validated champion budget policy', async () => {
  await registry.write({ schemaVersion: 1, models: [], routes: {}, history: [] });
  const updated = await registry.setAiBudgetPolicy({
    totalBudgetUsd: 15,
    championReserveUsd: 5,
    backgroundPaidEnabled: true
  });
  assert.deepEqual(updated.aiBudgetPolicy, {
    totalBudgetUsd: 15,
    championReserveUsd: 5,
    backgroundPaidEnabled: true,
    updatedAt: updated.aiBudgetPolicy.updatedAt,
    source: 'user-configured'
  });
  const read = registry.read();
  assert.equal(read.aiBudgetPolicy.totalBudgetUsd, 15);
  assert.equal(read.aiBudgetPolicy.championReserveUsd, 5);
  assert.equal(read.aiBudgetUsage.spentUsd, 0);
});

test('model registry rejects a reserve larger than total budget', async () => {
  await assert.rejects(
    registry.setAiBudgetPolicy({ totalBudgetUsd: 5, championReserveUsd: 6 }),
    error => error.code === 'AI_BUDGET_POLICY_INVALID'
  );
});

test('models API exposes model-brain diagnostics and adaptive-local candidate ranking', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'models.js'), 'utf8');
  assert.match(source, /router\.get\('\/model-brain\/status'/u);
  assert.match(source, /router\.get\('\/audit'/u);
  assert.match(source, /replyBrainAuthority\.audit/u);
  assert.match(source, /planner\.rankCandidates/u);
});

test('model registry records metered cloud invocation cost on the per-model ledger', async () => {
  await registry.write({
    schemaVersion: 1,
    models: [{
      id: 'paid-cloud',
      provider: 'openrouter',
      catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2, request: 0 } }
    }],
    routes: {},
    history: [],
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 1, periodStartedAt: '2026-07-01T00:00:00.000Z' }
  });
  // Cost is computed by the upper Model Brain/LiteLLM layer and supplied explicitly;
  // the registry is the durable metered recorder, not the pricing calculator.
  const first = await registry.recordInvocation('paid-cloud', {
    promptTokens: 1_000_000,
    outputTokens: 500_000,
    costUsd: 2
  });
  let model = first.models.find(row => row.id === 'paid-cloud');
  assert.equal(model.totalCostUsd, 2);
  assert.equal(model.callCount, 1);
  assert.equal(model.lastSuccessfulInvocation.costUsd, 2);
  assert.equal(model.lastSuccessfulInvocation.promptTokens, 1_000_000);
  assert.equal(model.lastSuccessfulInvocation.outputTokens, 500_000);
  const second = await registry.recordInvocation('paid-cloud', { costUsd: 1 });
  model = second.models.find(row => row.id === 'paid-cloud');
  assert.equal(model.totalCostUsd, 3);
  assert.equal(model.callCount, 2);
  // The global budget usage window is owned upstream and is not recomputed by the recorder.
  assert.equal(second.aiBudgetUsage.spentUsd, 1);
  assert.equal(second.aiBudgetUsage.periodStartedAt, '2026-07-01T00:00:00.000Z');
});
