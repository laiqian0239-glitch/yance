'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('stale owner cannot write runtime_state after a new fencing token is acquired', async () => {
  const root = temporaryRoot();
  let oldOwner = null;
  let newOwner = null;
  try {
    oldOwner = await createOwnership(root);
    const oldGuard = oldOwner.guard();
    await oldOwner.mutex.release();
    newOwner = await createOwnership(root);
    assert.ok(newOwner.guard().fencingToken > oldGuard.fencingToken);
    assert.throws(() => oldOwner.store.updateRuntimeState({ ...oldGuard, patch: { operatingMode: 'stale-write' } }), error => error.reasonCode === 'STALE_FENCING_TOKEN');
  } finally {
    await newOwner?.release().catch(() => {});
    await oldOwner?.release({ releaseLease: false }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
