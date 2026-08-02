'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../services/modelRegistry');

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

test('models API exposes brain routing diagnostics and controlled budget policy update', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'models.js'), 'utf8');
  assert.match(source, /router\.get\('\/brain-routing'/u);
  assert.match(source, /router\.patch\('\/budget-policy'/u);
  assert.match(source, /replyChampionAuthority\.decide/u);
  assert.match(source, /workloadPlacementAuthority\.rankCandidates/u);
  assert.match(source, /registry\.setAiBudgetPolicy/u);
});

test('model registry accumulates metered cloud invocation cost in the protected budget ledger', async () => {
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
  const state = await registry.recordInvocation('paid-cloud', { promptTokens: 1_000_000, outputTokens: 500_000 });
  assert.equal(state.aiBudgetUsage.spentUsd, 3);
  assert.equal(state.aiBudgetUsage.periodStartedAt, '2026-07-01T00:00:00.000Z');
});
