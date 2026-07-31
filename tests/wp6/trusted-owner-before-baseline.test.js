'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness } = require('./helpers');

test('candidate validation never creates trusted baseline before durable owner acceptance', async () => {
  const h = createProjectionHarness();
  const candidate = await h.coordinator.validateCandidateProjection();
  assert.equal(candidate.candidateOnly, true);
  assert.equal(h.coordinator.snapshot().trustedOwnerBound, false);
  assert.throws(() => h.coordinator._backend({ requireTrusted: true }), error => error.reasonCode === 'WP6_TRUSTED_OWNER_REQUIRED');
  await assert.rejects(() => h.coordinator.bindTrustedOwnerBaseline(), error => error.reasonCode === 'WP6_TRUSTED_OWNER_REQUIRED');
  h.setBackend({ ownerTrusted: true });
  const bound = await h.coordinator.bindTrustedOwnerBaseline();
  assert.equal(bound.trustedOwnerBound, true);
});
