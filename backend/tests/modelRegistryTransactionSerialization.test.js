'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-model-registry-serialization-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');
const modelRegistry = require('../services/modelRegistry');

test.after(() => {
  closeR32Store();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('model registry writes wait for an unrelated asynchronous SQLite owner', async () => {
  const store = getR32Store();
  let releaseOwner;
  let ownerStarted;
  const release = new Promise(resolve => { releaseOwner = resolve; });
  const started = new Promise(resolve => { ownerStarted = resolve; });

  const owner = store.transactionAsync(async () => {
    store.setMeta('model-registry-owner', { active: true });
    ownerStarted();
    await release;
    store.setMeta('model-registry-owner', { active: false });
  });
  await started;

  let settled = false;
  const merge = modelRegistry.mergeDiscovered({
    online: true,
    scannedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:11434',
    version: 'test',
    models: [{ id: 'ollama:test', name: 'test:latest', provider: 'ollama', available: true }]
  }).finally(() => { settled = true; });

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false, 'model registry write must queue instead of throwing SQLITE_TRANSACTION_BUSY_CONTEXT');

  releaseOwner();
  await owner;
  const registry = await merge;
  assert.equal(registry.models.some(model => model.id === 'ollama:test'), true);
  assert.equal(store.transactions.snapshot().depth, 0);
});
