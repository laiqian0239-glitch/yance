'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('expired database lease cannot bypass a still-held Named Mutex', async () => {
  const root = temporaryRoot(); const first = await createOwnership(root); first.stopHeartbeat();
  first.store.db.prepare("UPDATE runtime_lease SET lease_expires_at_utc='2000-01-01T00:00:00.000Z' WHERE lease_name=?").run(first.leaseName);
  await assert.rejects(createOwnership(root), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
  await first.release(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
