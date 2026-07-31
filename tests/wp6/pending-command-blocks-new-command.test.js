'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeControlCommandGateway } = require('../../backend/runtime/RuntimeControlCommandGateway');
const { createAuthorityHarness } = require('../wp5/helpers');
const { uuid } = require('./helpers');

test('a recoverable runtime control intent blocks a different command', async () => {
  const h = await createAuthorityHarness({ buildId: 'wp6-pending-test' });
  try {
    const state = h.store.snapshot();
    const first = { contractVersion:2, commandId:uuid('pending-first'), commandType:'runtime.suspend', expectedStateVersion:state.stateVersion, issuedAtUtc:'2026-07-05T00:00:00.000Z', payload:{reason:'first'} };
    const gateway = new RuntimeControlCommandGateway({ store:h.store, ownership:h.ownership, apply:async()=>{ throw new Error('injected'); } });
    await assert.rejects(() => gateway.execute(first), e => e.reasonCode === 'RUNTIME_CONTROL_APPLY_FAILED');
    const second = { contractVersion:2, commandId:uuid('pending-second'), commandType:'runtime.resume', expectedStateVersion:h.store.snapshot().stateVersion, issuedAtUtc:'2026-07-05T00:00:01.000Z', payload:{reason:'second'} };
    await assert.rejects(() => gateway.execute(second), e => e.reasonCode === 'RUNTIME_CONTROL_RECOVERY_REQUIRED');
  } finally { await h.close(); }
});
