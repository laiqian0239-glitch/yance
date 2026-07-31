'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthorityHarness } = require('../wp5/helpers');

test('runtime event sequence remains durable across store reopen', async () => {
  const h = await createAuthorityHarness({ buildId: 'wp6-sequence-test' });
  const dbPath = h.ownership.dbPath; const guard = h.ownership.guard();
  try {
    const before = h.store.snapshot().lastEventSequence;
    h.store.updateRuntimeState({ ...guard, patch: { diagnosticsSummary: { marker: 1 } }, eventType: 'runtime.state_updated', eventPayload: { marker: 1 } });
    const after = h.store.snapshot().lastEventSequence;
    assert.ok(after > before);
    const { RuntimeStateStore } = require('../../backend/runtime/RuntimeStateStore');
    const reopened = new RuntimeStateStore({ dbPath });
    try { assert.equal(reopened.snapshot().lastEventSequence, after); } finally { reopened.close(); }
  } finally { await h.close(); }
});
