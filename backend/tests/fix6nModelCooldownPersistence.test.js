'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6n-cooldown-'));
process.env.YANCE_DATA_DIR = dataRoot;

const registry = require('../services/modelRegistry');

test.after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('a Retry-After cooldown is persisted immediately even before the circuit failure threshold', async () => {
  const cooldownUntil = '2099-08-01T00:01:00.000Z';
  registry.write({
    schemaVersion: 3,
    models: [{
      id: 'rate-limited-model',
      provider: 'openrouter',
      modelSlug: 'anthropic/claude-opus',
      available: true,
      consecutiveFailureCount: 0,
      circuitOpenedAt: '',
      circuitOpenedUntil: ''
    }],
    routes: {},
    history: [],
    aiBudgetPolicy: { totalBudgetUsd: 100, championReserveUsd: 0, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 0, periodStartedAt: '' }
  });

  await registry.recordInvocationFailure(
    'rate-limited-model',
    Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED', status: 429 }),
    { countForCircuit: true, cooldownUntil }
  );

  const model = registry.read().models.find(row => row.id === 'rate-limited-model');
  assert.equal(model.consecutiveFailureCount, 1);
  assert.equal(model.circuitOpenedUntil, cooldownUntil);
  assert.ok(model.circuitOpenedAt);
});
