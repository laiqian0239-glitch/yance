'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('successful ownership takeover increments fencingToken monotonically', async () => {
  const root = temporaryRoot(); const first = await createOwnership(root); const one = first.guard().fencingToken; await first.release();
  const second = await createOwnership(root); const two = second.guard().fencingToken; assert.ok(two > one); await second.release(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
