'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness } = require('./helpers');

test('owner transition between candidate and acceptance invalidates candidate', async () => {
  const h = createProjectionHarness();
  await h.coordinator.validateCandidateProjection();
  h.setBackend({ ownerTrusted: true, backendPid: 2200, backendSessionId: 'session-2', startupNonce: 'nonce-2', ownerSessionId: 'owner-2', fd6PipeInstanceId: 'fd6-2', apiSessionToken: 'token-2' });
  await assert.rejects(() => h.coordinator.bindTrustedOwnerBaseline(), error => error.reasonCode === 'WP6_STALE_OWNER_EVENT');
  assert.equal(h.coordinator.snapshot().trustedOwnerBound, false);
});
