'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeHarness, uuid } = require('./helpers');

test('same runtime control command shares one side effect and conflicting envelope is rejected', async () => {
  const h = await createRuntimeHarness();
  try {
    const commandId = uuid('idempotent-network');
    const state = h.authority.store.snapshot();
    const envelope = { contractVersion: 2, commandId, commandType: 'runtime.setNetwork', expectedStateVersion: state.stateVersion, issuedAtUtc: '2026-07-05T00:00:00.000Z', payload: { online: false, reason: 'test' } };
    const [a, b] = await Promise.all([h.runtime.executeCommand(envelope), h.runtime.executeCommand(envelope)]);
    assert.equal(h.sideEffects.filter(x => x === 'offline').length, 1);
    assert.equal(a.commandId, commandId); assert.equal(b.commandId, commandId);
    await assert.rejects(() => h.runtime.executeCommand({ ...envelope, payload: { online: true, reason: 'conflict' } }), error => error.reasonCode === 'COMMAND_ID_REUSE_MISMATCH');
  } finally { await h.close(); }
});
