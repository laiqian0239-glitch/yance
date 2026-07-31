'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('stale owner cannot claim acknowledge or retry Outbox work', async () => {
  const root = temporaryRoot();
  let oldOwner = null;
  let newOwner = null;
  try {
    oldOwner = await createOwnership(root);
    const oldGuard = oldOwner.guard();
    const queued = oldOwner.store.enqueueOutbox({ ...oldGuard, eventType: 'test.delivery', payload: { n: 1 } });
    await oldOwner.mutex.release();
    newOwner = await createOwnership(root);
    const claimed = newOwner.store.claimOutbox(newOwner.guard());
    assert.equal(claimed.event_id, queued.eventId);
    assert.throws(() => oldOwner.store.claimOutbox(oldGuard), error => error.reasonCode === 'STALE_FENCING_TOKEN');
    assert.throws(() => oldOwner.store.acknowledgeOutbox({ ...oldGuard, eventId: queued.eventId }), error => error.reasonCode === 'STALE_FENCING_TOKEN');
    assert.throws(() => oldOwner.store.retryOutbox({ ...oldGuard, eventId: queued.eventId }), error => error.reasonCode === 'STALE_FENCING_TOKEN');
  } finally {
    await newOwner?.release().catch(() => {});
    // Releasing only the mutex intentionally creates the stale owner. The
    // RuntimeStateStore itself does not own the SQLite handle, so calling
    // store.close() cannot release the private SqliteConnectionBroker on
    // Windows. Complete the ownership lifecycle without touching the newer
    // fencing token, which closes the real broker before deleting the fixture.
    await oldOwner?.release({ releaseLease: false }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
