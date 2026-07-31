'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeHarness } = require('./helpers');

test('legacy business command surface cannot mutate lifecycle or safe mode', async () => {
  const h = await createRuntimeHarness();
  try {
    for (const command of ['lifecycle.setNetwork','lifecycle.suspend','lifecycle.resume','lifecycle.enterSafeMode','lifecycle.exitSafeMode','recovery.enterSafeMode','recovery.clearSafeMode']) {
      await assert.rejects(() => h.runtime.executeBusinessCommand({ command, payload: {}, context: { actor: 'test', correlationId: command } }), error => (error.reasonCode || error.code) === 'RUNTIME_CONTROL_API_V2_REQUIRED');
    }
    assert.equal(typeof h.runtime.executeLegacy, 'undefined');
    assert.equal(typeof h.runtime.execute, 'undefined');
  } finally { await h.close(); }
});
