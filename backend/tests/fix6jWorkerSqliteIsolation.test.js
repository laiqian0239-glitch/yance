'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6j-worker-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.YANCE_LEGACY_DATA_DIR = path.join(dataRoot, 'legacy');
process.env.NODE_ENV = 'test';
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
  instanceId: `fix6j-worker-sqlite-isolation-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');
const { startModelExecution } = require('../services/modelExecutionHost');

getR32Store();

// Current host contract: the parent persists a durable attempt envelope before
// the isolated worker is allowed to fork (WP_B_MODEL_EXECUTION_PERSISTED_ATTEMPT).
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep(value[key]);
  }
  return value;
}
function makePersistedAttempt(overrides = {}) {
  return freezeDeep({
    executionId: overrides.executionId || 'exec-fix6j-001',
    intentId: overrides.intentId || 'intent-fix6j-001',
    attemptId: overrides.attemptId || 'attempt-fix6j-001',
    idempotencyKey: overrides.idempotencyKey || 'idem-fix6j-001',
    ownerId: overrides.ownerId || 'owner-fix6j-001',
    claimId: overrides.claimId || 'claim-fix6j-001',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    request: overrides.request || { task: 'translation' }
  });
}

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('production worker reaches protocol readiness while the parent owns SQLite', async () => {
  const handle = startModelExecution({
    model: { id: 'local-fixture', provider: 'ollama', name: 'missing-fixture', endpoint: 'http://127.0.0.1:1' },
    task: 'translation',
    messages: [],
    // Generous deadline: the worker rejects an expired envelope before resolving the spec, so a tight
    // 100ms budget races process fork/IPC under a full-corpus run and masks the UNSUPPORTED_PROVIDER path
    // this test actually asserts. The fast unsupported path still settles immediately (no wait).
    options: { timeoutMs: 10000 },
    persistedAttempt: makePersistedAttempt({
      executionId: 'exec-fix6j-readiness-001',
      request: { task: 'translation', modelName: 'missing-fixture' }
    }),
    resolveExecutionSpec() {
      return Object.freeze({ provider: 'unsupported-after-start', endpoint: '', modelName: 'missing-fixture', modelId: 'local-fixture' });
    }
  });
  handle.result.catch(() => {});
  const started = await handle.started;
  assert.equal(started.workerStarted, true);
  await assert.rejects(handle.result, error => error.code === 'UNSUPPORTED_MODEL_PROVIDER');
  const receipt = await handle.exit;
  assert.equal(receipt.workerStarted, true);
  assert.equal(receipt.stderrTail.includes('SQLITE_OWNERSHIP_CONFLICT'), false);
});

test('credential canary never appears in the execution receipt or captured process output', async () => {
  const canary = 'fix6j-secret-canary-7f4d9e';
  const handle = startModelExecution({
    model: { id: 'cloud-fixture', provider: 'cloud', name: 'missing', credentialRef: 'fixture' },
    task: 'translation',
    messages: [], options: { timeoutMs: 10000 },
    persistedAttempt: makePersistedAttempt({
      executionId: 'exec-fix6j-canary-001',
      request: { task: 'translation', modelName: 'missing' }
    }),
    resolveExecutionSpec() {
      return Object.freeze({ provider: 'cloud', endpoint: 'http://127.0.0.1:1/v1', modelName: 'missing', modelId: 'cloud-fixture', credential: Object.freeze({ apiKey: canary }) });
    }
  });
  handle.result.catch(() => {});
  await handle.started;
  await assert.rejects(handle.result);
  const receipt = await handle.exit;
  assert.equal(JSON.stringify(receipt).includes(canary), false);
  assert.equal(receipt.stdoutTail.includes(canary), false);
  assert.equal(receipt.stderrTail.includes(canary), false);
});

test('production worker runtime dependency closure excludes store and SQLite authorities', () => {
  const workerPath = path.join(__dirname, '..', 'services', 'modelExecutionWorker.js');
  const script = `
    require(${JSON.stringify(workerPath)});
    const modules = Object.keys(require.cache).map(value => value.toLowerCase());
    process.stdout.write(JSON.stringify(modules));
    process.exit(0);
  `;
  const probe = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, NODE_ENV: 'test' },
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(probe.status, 0, probe.stderr);
  const modules = JSON.parse(probe.stdout);
  const forbidden = ['sqlite', 'systempolicy', 'securityguardsingleton', 'r32storesingleton', 'storeprovider'];
  const hits = modules.filter(modulePath => forbidden.some(fragment => modulePath.includes(fragment)));
  assert.deepEqual(hits, []);
});
