'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { DurableExecutionAuthority } = require('../services/durableExecutionAuthority');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-durable-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({ dbPath });
  let id = 0;
  let tick = 0;
  const authority = new DurableExecutionAuthority({
    storeProvider: () => store,
    idFactory: prefix => `${prefix}-${++id}`,
    clock: () => new Date(Date.UTC(2026, 7, 1, 11, 0, tick++)).toISOString()
  });
  return {
    root,
    dbPath,
    store,
    authority,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

test('durable execution persists legal transitions, heartbeats and append-only history', () => {
  const f = fixture();
  try {
    const created = f.authority.createExecution({
      executionId: 'exec-fixed',
      traceId: 'trace-fixed',
      operationKind: 'channel-history-sync',
      idempotencyKey: 'telegram:account-1:history',
      maxAttempts: 3,
      metadata: { platform: 'telegram', apiKey: 'SECRET' }
    });
    const duplicate = f.authority.createExecution({
      executionId: 'different-id-must-not-win',
      traceId: 'trace-fixed',
      operationKind: 'channel-history-sync',
      idempotencyKey: 'telegram:account-1:history',
      maxAttempts: 9
    });
    assert.equal(created.executionId, 'exec-fixed');
    assert.equal(duplicate.executionId, 'exec-fixed');
    assert.equal(created.state, 'CREATED');

    const scheduled = f.authority.schedule({ executionId: created.executionId, expectedGeneration: 0, actor: 'scheduler' });
    assert.equal(scheduled.state, 'SCHEDULED');
    const claimed = f.authority.claim({ executionId: created.executionId, expectedGeneration: 0, ownerId: 'worker-a' });
    assert.equal(claimed.state, 'RUNNING');
    assert.equal(claimed.generation, 1);
    assert.equal(claimed.ownerId, 'worker-a');

    assert.throws(
      () => f.authority.heartbeat({ executionId: created.executionId, generation: 0, ownerId: 'worker-a' }),
      error => error?.code === 'DURABLE_EXECUTION_STALE_GENERATION'
    );
    const heartbeat = f.authority.heartbeat({ executionId: created.executionId, generation: 1, ownerId: 'worker-a', progress: { checkpoint: 'page-2', apiKey: 'SECRET' } });
    assert.equal(heartbeat.leaseSequence, 1);
    assert.equal(heartbeat.state, 'RUNNING');

    const waiting = f.authority.waitRemote({ executionId: created.executionId, generation: 1, ownerId: 'worker-a', reasonCode: 'WAITING_TELEGRAM_PAGE' });
    assert.equal(waiting.state, 'WAITING_REMOTE');
    const succeeded = f.authority.succeed({ executionId: created.executionId, generation: 1, ownerId: 'worker-a', receiptId: 'sync-receipt-1' });
    assert.equal(succeeded.state, 'SUCCEEDED');

    const reloaded = new DurableExecutionAuthority({ storeProvider: () => f.store }).get(created.executionId);
    assert.equal(reloaded.state, 'SUCCEEDED');
    assert.deepEqual(reloaded.history.map(row => row.toState), ['CREATED', 'SCHEDULED', 'RUNNING', 'RUNNING', 'WAITING_REMOTE', 'SUCCEEDED']);
    const serialized = JSON.stringify(reloaded);
    assert.doesNotMatch(serialized, /SECRET/u);
    assert.match(serialized, /page-2|sync-receipt-1/u);

    assert.throws(
      () => f.store.db.prepare('UPDATE durable_execution_events SET event_type=? WHERE execution_id=?').run('tampered', created.executionId),
      /append-only/i
    );
    assert.throws(
      () => f.store.db.prepare('DELETE FROM durable_execution_events WHERE execution_id=?').run(created.executionId),
      /append-only/i
    );
  } finally { f.close(); }
});

test('cancellation is durable and prevents a worker from completing after cancel request', () => {
  const f = fixture();
  try {
    const created = f.authority.createExecution({ traceId: 'trace-cancel', operationKind: 'media-fetch', idempotencyKey: 'avatar:wa:1' });
    f.authority.schedule({ executionId: created.executionId, expectedGeneration: 0 });
    const claimed = f.authority.claim({ executionId: created.executionId, expectedGeneration: 0, ownerId: 'media-worker' });
    const requested = f.authority.requestCancel({ executionId: created.executionId, generation: claimed.generation, ownerId: 'media-worker', actor: 'user', reasonCode: 'USER_CANCELLED' });
    assert.equal(requested.state, 'CANCEL_REQUESTED');
    assert.throws(
      () => f.authority.succeed({ executionId: created.executionId, generation: claimed.generation, ownerId: 'media-worker' }),
      error => error?.code === 'DURABLE_EXECUTION_TRANSITION_INVALID'
    );
    const cancelled = f.authority.acknowledgeCancel({ executionId: created.executionId, generation: claimed.generation, ownerId: 'media-worker', reasonCode: 'CANCEL_ACKNOWLEDGED' });
    assert.equal(cancelled.state, 'CANCELLED');
  } finally { f.close(); }
});

test('retryable failure becomes retry scheduled and stale claims cannot mutate the new generation', () => {
  const f = fixture();
  try {
    const created = f.authority.createExecution({ traceId: 'trace-retry', operationKind: 'message-delivery', idempotencyKey: 'delivery:1', maxAttempts: 2 });
    f.authority.schedule({ executionId: created.executionId, expectedGeneration: 0 });
    const firstClaim = f.authority.claim({ executionId: created.executionId, expectedGeneration: 0, ownerId: 'sender-a' });
    const retry = f.authority.fail({
      executionId: created.executionId,
      generation: firstClaim.generation,
      ownerId: 'sender-a',
      retryable: true,
      reasonCode: 'REMOTE_TIMEOUT',
      nextAttemptAt: '2026-08-01T11:05:00.000Z'
    });
    assert.equal(retry.state, 'RETRY_SCHEDULED');
    assert.equal(retry.retryCount, 1);

    const secondClaim = f.authority.claim({ executionId: created.executionId, expectedGeneration: firstClaim.generation, ownerId: 'sender-b' });
    assert.equal(secondClaim.generation, 2);
    assert.throws(
      () => f.authority.fail({ executionId: created.executionId, generation: firstClaim.generation, ownerId: 'sender-a', retryable: false, reasonCode: 'STALE' }),
      error => error?.code === 'DURABLE_EXECUTION_STALE_GENERATION'
    );
    const dead = f.authority.fail({ executionId: created.executionId, generation: secondClaim.generation, ownerId: 'sender-b', retryable: true, reasonCode: 'REMOTE_TIMEOUT' });
    assert.equal(dead.state, 'DEAD_LETTERED');
    assert.equal(dead.retryCount, 2);
  } finally { f.close(); }
});
