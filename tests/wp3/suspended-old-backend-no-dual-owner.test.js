'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('suspended old backend holding the mutex cannot create a dual owner', async () => {
  const root = temporaryRoot(); const suspended = await createOwnership(root); suspended.stopHeartbeat();
  suspended.store.db.prepare("UPDATE runtime_lease SET heartbeat_at_utc='2000-01-01T00:00:00.000Z',lease_expires_at_utc='2000-01-01T00:00:01.000Z' WHERE lease_name=?").run(suspended.leaseName);
  await assert.rejects(createOwnership(root), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
  const lease = suspended.store.db.prepare('SELECT owner_instance_id,fencing_token FROM runtime_lease WHERE lease_name=?').get(suspended.leaseName);
  assert.equal(lease.owner_instance_id, suspended.ownerInstanceId); assert.equal(lease.fencing_token, suspended.guard().fencingToken);
  await suspended.release(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
