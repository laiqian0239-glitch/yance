'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness } = require('./helpers');

test('desktop runtime mutation is impossible before trusted API v2 baseline', async () => {
  const h = createProjectionHarness();
  await assert.rejects(() => h.coordinator.setNetwork(false, 'no-baseline'), e => e.reasonCode === 'WP6_RUNTIME_BASELINE_REQUIRED');
});
