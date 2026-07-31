'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialRuntime } = require('./helpers');
test('empty credential snapshot hydrates successfully before local_ready', async () => {
  const created = await createCredentialRuntime();
  assert.equal(created.runtime.snapshot().runtime.lifecycleState, 'local_ready');
  assert.equal(created.runtime.credentialMetadata().entryCount, 0);
  assert.equal(created.coordinator.ownership.store.getCredentialHydrationState().hydrated, true);
  await created.close();
});
