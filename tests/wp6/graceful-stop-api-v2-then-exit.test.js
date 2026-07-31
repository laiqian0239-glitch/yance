'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness } = require('./helpers');

test('graceful desktop stop submits runtime.stop before process custody', async () => {
  const h = createProjectionHarness();
  await h.coordinator.validateCandidateProjection(); h.setBackend({ ownerTrusted: true }); await h.coordinator.bindTrustedOwnerBaseline();
  const response = await h.coordinator.requestStop('test-stop');
  const command = h.calls.find(call => call.url.includes('/commands'));
  assert.ok(command);
  assert.equal(JSON.parse(command.init.body).commandType, 'runtime.stop');
  assert.equal(response.accepted, true);
  assert.equal(h.coordinator.snapshot().state, 'STOP_REQUEST_CONFIRMED');
  assert.equal(h.coordinator.snapshot().stopOperation.status, 'CONFIRMED');
});
