'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialRuntime } = require('./helpers');
test('external worker failure only updates capability state and never revokes local_ready', async () => {
  const created = await createCredentialRuntime({ externalWorkerStarters: { ai_provider_worker: async () => { throw new Error('provider unavailable'); } } });
  await created.runtime.externalWorkersPromise;
  const snapshot = created.runtime.snapshot();
  assert.equal(snapshot.runtime.localReady, true);
  assert.equal(snapshot.externalWorkers.ai_provider_worker, 'temporarily_unavailable');
  assert.equal(snapshot.capabilities.ai_provider_worker, 'temporarily_unavailable');
  await created.close();
});
