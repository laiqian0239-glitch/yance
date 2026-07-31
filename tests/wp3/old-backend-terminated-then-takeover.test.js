'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('new owner opens writable SQLite only after old backend releases the mutex', async () => {
  const root = temporaryRoot(); const first = await createOwnership(root); const old = first.snapshot(); await first.release();
  const second = await createOwnership(root); const current = second.snapshot();
  assert.notEqual(current.ownerInstanceId, old.ownerInstanceId); assert.ok(current.fencingToken > old.fencingToken); assert.equal(current.mutex.held, true);
  await second.release(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
