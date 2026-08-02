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

const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');
const { startModelExecution } = require('../services/modelExecutionHost');

getR32Store();

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('production worker reaches protocol readiness while the parent owns SQLite', async () => {
  const handle = startModelExecution({
    model: { id: 'local-fixture', provider: 'ollama', name: 'missing-fixture', endpoint: 'http://127.0.0.1:1' },
    task: 'translation',
    messages: [],
    options: { timeoutMs: 100 },
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
    messages: [], options: { timeoutMs: 100 },
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
