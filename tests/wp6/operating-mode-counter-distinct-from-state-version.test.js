'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthorityHarness } = require('../wp5/helpers');

test('non-mode runtime events advance stateVersion without advancing operatingModeRevision', async () => {
  const h = await createAuthorityHarness({ buildId: 'wp6-revision-test' });
  try {
    const before = h.store.snapshot();
    h.store.updateRuntimeState({ ...h.ownership.guard(), patch: { diagnosticsSummary: { heartbeat: true } }, eventType: 'runtime.state_updated', eventPayload: {} });
    const after = h.store.snapshot();
    assert.equal(after.stateVersion, before.stateVersion + 1);
    assert.equal(after.runtime.operatingModeRevision, before.runtime.operatingModeRevision);
  } finally { await h.close(); }
});
