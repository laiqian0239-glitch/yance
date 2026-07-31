'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeControlCommandGateway } = require('../../backend/runtime/RuntimeControlCommandGateway');
const { createAuthorityHarness } = require('../wp5/helpers');
const { uuid } = require('./helpers');

test('persisted apply failure is recovered with same command id without creating a second intent', async () => {
  const h = await createAuthorityHarness({ buildId: 'wp6-crash-test' });
  try {
    const commandId = uuid('crash-recovery');
    const envelope = { contractVersion: 2, commandId, commandType: 'runtime.suspend', expectedStateVersion: h.store.snapshot().stateVersion, issuedAtUtc: '2026-07-05T00:00:00.000Z', payload: { reason: 'crash' } };
    const failing = new RuntimeControlCommandGateway({ store: h.store, ownership: h.ownership, apply: async () => { throw Object.assign(new Error('crash-window'), { code: 'INJECTED_CRASH' }); } });
    await assert.rejects(() => failing.execute(envelope), error => error.reasonCode === 'RUNTIME_CONTROL_APPLY_FAILED');
    assert.equal(h.store.listRecoverableRuntimeControlCommands().length, 1);
    let applies = 0;
    const recovered = new RuntimeControlCommandGateway({ store: h.store, ownership: h.ownership, apply: async () => { applies += 1; return { eventType: 'runtime.suspended', result: { suspended: true } }; } });
    const result = await recovered.reconcile();
    assert.equal(result.commandId, commandId);
    assert.equal(applies, 1);
    assert.equal(h.store.listRecoverableRuntimeControlCommands().length, 0);
  } finally { await h.close(); }
});
