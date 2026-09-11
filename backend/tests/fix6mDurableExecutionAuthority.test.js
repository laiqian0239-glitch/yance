'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../migrations/batch41Fix6MArchitectureReferenceClosure');
const { applyArchitectureClosureV2WpA } = require('../migrations/architectureClosureV2WpA');
const { applyArchitectureClosureV2WpB } = require('../migrations/architectureClosureV2WpB');
const { DurableExecutionAuthority } = require('../services/durableExecutionAuthority');
const { ExternalActionOutboxAuthority } = require('../services/externalActionOutboxAuthority');
const privacy = require('../services/privacy');

// Schema 23 durable execution is host-fenced: every owned CAS binds owner/claim/host-generation/
// fencing-token and an ACTIVE authority_write_host_lease. These helpers build that exact contract.
function withDatabase(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-durable-'));
  const dbPath = path.join(root, 'schema23.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(`CREATE TABLE r32_meta(
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`);
    applyBatch41Fix6MArchitectureReferenceClosure(db);
    applyArchitectureClosureV2WpA(db);
    applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:41:00.000Z' });
    const host = Object.freeze({ hostId: 'host-1', hostGeneration: 7, fencingToken: 19 });
    const at = '2026-08-03T03:40:00.000Z';
    db.prepare(`INSERT INTO authority_write_host_lease(
      singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
      host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
      acquired_at,heartbeat_at,updated_at
    ) VALUES(1,?,1234,'fix6m-host','fix6m-nonce',?,?,'ACTIVE',?,?,?,?,?)`).run(
      host.hostId, host.hostGeneration, host.fencingToken,
      Date.parse(at), Date.parse(at), at, at, at
    );
    const store = (() => {
      let transactionDepth = 0;
      return {
        db,
        transaction(callback) {
          if (typeof callback !== 'function') throw new TypeError('transaction callback required');
          if (transactionDepth > 0) return callback();
          db.exec('BEGIN IMMEDIATE');
          transactionDepth += 1;
          try {
            const result = callback();
            db.exec('COMMIT');
            return result;
          } catch (error) {
            try { db.exec('ROLLBACK'); } catch (_) {}
            throw error;
          } finally {
            transactionDepth -= 1;
          }
        }
      };
    })();
    return work(db, store, host);
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function makeHarness(store, host) {
  const authority = new DurableExecutionAuthority({ storeProvider: () => store });
  let idSequence = 0;
  const outbox = new ExternalActionOutboxAuthority({
    storeProvider: () => store,
    idFactory(prefix) { return `${prefix}-fix6m-${idSequence++}`; }
  });
  let tick = 0;
  // Monotonic, canonical (millisecond-padded, Z-suffixed) authority timestamps.
  const ts = () => {
    const seconds = 42 * 60 + tick++;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `2026-08-03T03:${mm}:${ss}.000Z`;
  };
  const H = () => ({ hostId: host.hostId, hostGeneration: host.hostGeneration, fencingToken: host.fencingToken });

  function create(input) {
    return authority.createExecution({ ...input, authorityTimestamp: ts() });
  }
  function schedule(exec) {
    const cur = authority.get(exec.executionId);
    return authority.schedule({
      executionId: exec.executionId,
      expectedStateVersion: cur.stateVersion,
      generation: cur.generation,
      ...H(),
      operationKind: exec.operationKind,
      authorityTimestamp: ts()
    });
  }
  // Schema 23 splits first claim (-> CLAIMED) from worker start (CLAIMED -> RUNNING).
  function claimToRunning(exec, ownerId) {
    const scheduled = authority.get(exec.executionId);
    const claimId = `claim-${exec.executionId}`;
    const start = ts();
    const expiry = new Date(Date.parse(start) + 3600_000).toISOString();
    const claimed = authority.claim({
      executionId: exec.executionId,
      expectedStateVersion: scheduled.stateVersion,
      generation: scheduled.generation,
      ownerId,
      claimId,
      ...H(),
      leaseStartedAt: start,
      leaseExpiresAt: expiry,
      authorityTimestamp: start
    });
    return authority.transition({
      executionId: exec.executionId,
      expectedStateVersion: claimed.stateVersion,
      allowedStates: ['CLAIMED'],
      targetState: 'RUNNING',
      generation: claimed.generation,
      ownerId,
      claimId,
      ...H(),
      authorityTimestamp: ts(),
      eventType: 'started'
    });
  }
  // Owned transition that reads the current row so callers only state the target/source states.
  function advance(execId, targetState, allowedStates, overrides = {}) {
    const cur = authority.get(execId);
    return authority.transition({
      executionId: execId,
      expectedStateVersion: overrides.expectedStateVersion ?? cur.stateVersion,
      allowedStates,
      targetState,
      generation: overrides.generation ?? cur.generation,
      ownerId: overrides.ownerId ?? cur.ownerId,
      claimId: overrides.claimId ?? cur.claimId,
      ...H(),
      authorityTimestamp: ts(),
      eventType: overrides.eventType,
      reasonCode: overrides.reasonCode,
      payload: overrides.payload
    });
  }
  // Persist the external intent -> claim -> attempt -> provider receipt evidence chain that
  // settleExternalAttempt requires before a remote outcome may move a WAITING_REMOTE execution.
  function providerFailureReceipt(exec, ownerId) {
    const cur = authority.get(exec.executionId);
    const intent = outbox.createIntent({
      intentId: `intent-${exec.executionId}`,
      executionId: exec.executionId,
      actionKind: exec.operationKind,
      idempotencyKey: `intent-key-${exec.executionId}`,
      payload: { recipientReference: 'recipient-1' },
      authorityTimestamp: ts()
    });
    const intentLeaseStart = ts();
    const claimedIntent = outbox.claimIntent({
      intentId: intent.intentId,
      stateVersion: 0,
      generation: 0,
      ownerId,
      ...H(),
      claimId: `outbox-claim-${exec.executionId}`,
      leaseStartedAt: intentLeaseStart,
      leaseExpiresAt: new Date(Date.parse(intentLeaseStart) + 3600_000).toISOString(),
      authorityTimestamp: intentLeaseStart
    });
    const attempt = outbox.startAttempt({
      intentId: intent.intentId,
      stateVersion: claimedIntent.claim.stateVersion,
      generation: claimedIntent.claim.generation,
      ownerId,
      ...H(),
      claimId: claimedIntent.claim.claimId,
      request: { providerBodyReference: 'provider-body-1' },
      authorityTimestamp: ts()
    });
    const receipt = outbox.recordFailureReceipt({
      intentId: intent.intentId,
      attemptId: attempt.attemptId,
      stateVersion: attempt.stateVersion,
      generation: attempt.generation,
      ownerId,
      ...H(),
      claimId: attempt.claimId,
      providerReceiptId: `provider-receipt-${exec.executionId}`,
      evidenceReference: `provider:provider-receipt-${exec.executionId}`,
      result: { accepted: false },
      retryable: true,
      authorityTimestamp: ts()
    });
    return { receipt, current: cur };
  }
  function settleFailure(exec, ownerId, options = {}) {
    const { receipt, current } = providerFailureReceipt(exec, ownerId);
    const settled = authority.settleExternalAttempt({
      executionId: exec.executionId,
      outcome: 'FAILURE',
      receiptId: receipt.receiptId,
      stateVersion: options.stateVersion ?? current.stateVersion,
      generation: options.generation ?? current.generation,
      ownerId: options.ownerId ?? current.ownerId,
      claimId: options.claimId ?? current.claimId,
      ...H(),
      retryable: options.retryable === true,
      retryDelayMs: options.retryDelayMs ?? 0,
      authorityTimestamp: ts()
    });
    return { settled, receiptId: receipt.receiptId };
  }
  return { authority, outbox, host, store, ts, create, schedule, claimToRunning, advance, settleFailure };
}

test('durable execution persists legal transitions, heartbeats and append-only history', () => withDatabase((db, store, host) => {
  const h = makeHarness(store, host);
  // Callers sanitize secrets at the boundary; the authority persists those canonical bytes verbatim.
  const safeMetadata = privacy.sanitizeObject({ platform: 'telegram', apiKey: 'SECRET' });
  const created = h.create({
    executionId: 'exec-fixed',
    traceId: 'trace-fixed',
    operationKind: 'channel-history-sync',
    idempotencyKey: 'telegram:account-1:history',
    maxAttempts: 3,
    metadata: safeMetadata
  });
  const duplicate = h.create({
    executionId: 'different-id-must-not-win',
    traceId: 'trace-fixed',
    operationKind: 'channel-history-sync',
    idempotencyKey: 'telegram:account-1:history',
    maxAttempts: 9
  });
  assert.equal(created.executionId, 'exec-fixed');
  assert.equal(duplicate.executionId, 'exec-fixed');
  assert.equal(created.state, 'CREATED');

  h.schedule(created);
  const running = h.claimToRunning(created, 'worker-a');
  assert.equal(running.state, 'RUNNING');
  assert.equal(running.generation, 1);
  assert.equal(running.ownerId, 'worker-a');

  // A stale writer (a legal but mismatched prior generation) is rejected by the CAS predicate.
  assert.throws(
    () => h.advance(created.executionId, 'RUNNING', ['RUNNING'], { generation: 99, ownerId: 'worker-a', eventType: 'heartbeat' }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );
  const heartbeat = h.advance(created.executionId, 'RUNNING', ['RUNNING'], {
    ownerId: 'worker-a',
    eventType: 'heartbeat',
    payload: privacy.sanitizeObject({ checkpoint: 'page-2', apiKey: 'SECRET' })
  });
  assert.equal(heartbeat.state, 'RUNNING');

  h.advance(created.executionId, 'WAITING_REMOTE', ['RUNNING'], {
    ownerId: 'worker-a', eventType: 'waiting-remote', reasonCode: 'WAITING_TELEGRAM_PAGE'
  });
  const succeeded = h.advance(created.executionId, 'SUCCEEDED', ['WAITING_REMOTE'], {
    ownerId: 'worker-a', eventType: 'succeeded', payload: { receiptId: 'sync-receipt-1' }
  });
  assert.equal(succeeded.state, 'SUCCEEDED');

  const reloaded = new DurableExecutionAuthority({ storeProvider: () => store }).get(created.executionId);
  assert.equal(reloaded.state, 'SUCCEEDED');
  assert.deepEqual(
    reloaded.history.map(row => row.toState),
    ['CREATED', 'SCHEDULED', 'CLAIMED', 'RUNNING', 'RUNNING', 'WAITING_REMOTE', 'SUCCEEDED']
  );
  const serialized = JSON.stringify(reloaded);
  assert.doesNotMatch(serialized, /SECRET/u);
  assert.match(serialized, /page-2|sync-receipt-1/u);

  assert.throws(
    () => store.db.prepare('UPDATE durable_execution_events SET event_type=? WHERE execution_id=?').run('tampered', created.executionId),
    /append-only/i
  );
  assert.throws(
    () => store.db.prepare('DELETE FROM durable_execution_events WHERE execution_id=?').run(created.executionId),
    /append-only/i
  );
}));

test('cancellation is durable and prevents a worker from completing after cancel request', () => withDatabase((db, store, host) => {
  const h = makeHarness(store, host);
  const created = h.create({ traceId: 'trace-cancel', operationKind: 'media-fetch', idempotencyKey: 'avatar:wa:1' });
  h.schedule(created);
  const claimed = h.claimToRunning(created, 'media-worker');

  const requested = h.advance(created.executionId, 'CANCEL_REQUESTED', ['RUNNING'], {
    ownerId: 'media-worker', eventType: 'cancel-requested', reasonCode: 'USER_CANCELLED'
  });
  assert.equal(requested.state, 'CANCEL_REQUESTED');
  // Once cancellation is requested, a transition straight to SUCCEEDED is CAS-rejected.
  assert.throws(
    () => h.advance(created.executionId, 'SUCCEEDED', ['RUNNING'], { ownerId: 'media-worker', eventType: 'succeeded' }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );
  const cancelled = h.advance(created.executionId, 'CANCELLED', ['CANCEL_REQUESTED'], {
    ownerId: 'media-worker', eventType: 'cancel-acknowledged', reasonCode: 'CANCEL_ACKNOWLEDGED'
  });
  assert.equal(cancelled.state, 'CANCELLED');
  assert.equal(claimed.generation, cancelled.generation);
}));

test('retryable failure is requeued with the lease released, stale writers are fenced, and max attempts dead-letters', () => withDatabase((db, store, host) => {
  const h = makeHarness(store, host);

  // maxAttempts=3: first retryable failure from WAITING_REMOTE becomes RETRY_SCHEDULED and
  // releases the worker lease so a later claim can pick it up.
  // Drive a fresh execution to WAITING_REMOTE and settle its first retryable provider failure.
  const driveToWaiting = (id, ownerId, maxAttempts) => {
    const created = h.create({
      traceId: `trace-${id}`, operationKind: 'message-delivery', idempotencyKey: `delivery:${id}`, maxAttempts
    });
    h.schedule(created);
    const claim = h.claimToRunning(created, ownerId);
    h.advance(created.executionId, 'WAITING_REMOTE', ['RUNNING'], { ownerId, eventType: 'waiting-remote' });
    return { created, claim };
  };

  // maxAttempts=3: first retryable failure becomes RETRY_SCHEDULED and releases the worker lease.
  const retryable = driveToWaiting('retry', 'sender-a', 3);
  const retried = h.settleFailure(retryable.created, 'sender-a', { retryable: true }).settled;
  assert.equal(retried.state, 'RETRY_SCHEDULED');
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.ownerId, '');
  assert.equal(retried.claimId, '');

  // A stale writer presenting a mismatched generation against a still-WAITING_REMOTE row is fenced
  // by the settlement CAS predicate (the row is left untouched).
  const stale = driveToWaiting('stale', 'sender-a', 3);
  assert.throws(
    () => h.settleFailure(stale.created, 'sender-a', { generation: 99, retryable: true }),
    error => error?.code === 'WP_B_EXECUTION_SETTLEMENT_CAS_REJECTED'
  );
  assert.equal(h.authority.get(stale.created.executionId).state, 'WAITING_REMOTE');

  // maxAttempts=1: the first retryable failure already exhausts attempts and dead-letters.
  const deadCase = driveToWaiting('dead', 'sender-b', 1);
  const dead = h.settleFailure(deadCase.created, 'sender-b', { retryable: true }).settled;
  assert.equal(dead.state, 'DEAD_LETTERED');
  assert.equal(dead.retryCount, 1);
}));
