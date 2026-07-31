'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialRuntime } = require('./helpers');
test('offline startup reaches local_ready without waiting for external providers', async () => {
  const failing = async () => { throw new Error('offline'); };
  const created = await createCredentialRuntime({ externalWorkerStarters: { telegram_connector_worker: failing, facebook_connector_worker: failing, ai_provider_worker: failing, translation_provider_worker: failing } });
  assert.equal(created.runtime.snapshot().runtime.localReady, true);
  await created.runtime.externalWorkersPromise;
  assert.ok(Object.values(created.runtime.externalWorkerState).every(value => value === 'temporarily_unavailable'));
  await created.close();
});
