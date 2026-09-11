'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6n-cooldown-'));
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
  instanceId: `fix6n-cooldown-${process.pid}`
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

test('a 429 rate-limited invocation failure is persisted immediately with its normalized status', async () => {
  registry.write({
    schemaVersion: 3,
    models: [{
      id: 'rate-limited-model',
      provider: 'openrouter',
      modelSlug: 'anthropic/claude-opus',
      available: true,
      failureCount: 0
    }],
    routes: {},
    history: [],
    aiBudgetPolicy: { totalBudgetUsd: 100, championReserveUsd: 0, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 0, periodStartedAt: '' }
  });

  await registry.recordInvocationFailure(
    'rate-limited-model',
    Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED', status: 429 })
  );

  const model = registry.read().models.find(row => row.id === 'rate-limited-model');
  assert.equal(model.failureCount, 1);
  assert.equal(model.lastErrorCode, 'RATE_LIMITED');
  assert.equal(model.lastHttpStatus, 429);
  assert.equal(model.lastInvocationStatus, 'failed');
  assert.ok(model.lastFailedAt);
});
