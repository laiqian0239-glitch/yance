'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness, runtimeSnapshot } = require('./helpers');

test('persisted event gap discards incremental baseline and refetches snapshot', async () => {
  const gap = { contractVersion: 2, buildId: 'wp6-test-build', fromSequenceExclusive: 7, lastAvailableSequence: 10, events: [{ eventSequence: 9, eventId: 'e9', eventType: 'runtime.state_changed', stateVersion: 8, occurredAtUtc: '2026-07-05T00:00:01.000Z', payload: {} }] };
  const h = createProjectionHarness({ snapshots: [runtimeSnapshot(), runtimeSnapshot(), runtimeSnapshot({ stateVersion: 8, operatingModeRevision: 3, lastEventSequence: 10 })], eventBatches: [gap] });
  await h.coordinator.validateCandidateProjection();
  h.setBackend({ ownerTrusted: true });
  await h.coordinator.bindTrustedOwnerBaseline();
  const result = await h.coordinator.pollOnce();
  assert.equal(result.authorityTriple.lastEventSequence, 10);
  assert.equal(result.metrics.eventGaps, 1);
  assert.equal(result.metrics.snapshotRefetches, 1);
});
