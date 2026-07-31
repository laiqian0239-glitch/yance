'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness, runtimeSnapshot } = require('./helpers');

test('owner/session reconnect discards old baseline and binds a fresh authority triple', async () => {
  const h = createProjectionHarness({ snapshots: [runtimeSnapshot(), runtimeSnapshot(), runtimeSnapshot({ stateVersion: 9, operatingModeRevision: 4, lastEventSequence: 11, ownerInstanceId: 'owner-2', fencingToken: 2 }), runtimeSnapshot({ stateVersion: 9, operatingModeRevision: 4, lastEventSequence: 11, ownerInstanceId: 'owner-2', fencingToken: 2 })] });
  await h.coordinator.validateCandidateProjection();
  h.setBackend({ ownerTrusted: true });
  await h.coordinator.bindTrustedOwnerBaseline();
  assert.equal(h.coordinator.snapshot().authorityTriple.stateVersion, 5);
  h.coordinator.discardBaseline('BACKEND_RESTART');
  h.setBackend({ ownerTrusted: false, backendPid: 2200, backendSessionId: 'backend-session-2', startupNonce: 'nonce-2', fd6PipeInstanceId: 'fd6-2', ownerSessionId: 'owner-session-2', apiSessionToken: 'token-secret-2' });
  await h.coordinator.validateCandidateProjection();
  h.setBackend({ ownerTrusted: true });
  await h.coordinator.bindTrustedOwnerBaseline();
  const projection = h.coordinator.snapshot();
  assert.equal(projection.authorityTriple.stateVersion, 9);
  assert.equal(projection.authorityTriple.operatingModeRevision, 4);
  assert.equal(projection.authorityTriple.lastEventSequence, 11);
  assert.equal(projection.runtime.ownerInstanceId, 'owner-2');
});
