'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../../backend/migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyArchitectureClosureV2WpA
} = require('../../backend/migrations/architectureClosureV2WpA');
const {
  applyArchitectureClosureV2WpB
} = require('../../backend/migrations/architectureClosureV2WpB');
const {
  DurableInternalOperationAuthority
} = require('../../backend/services/durableInternalOperationAuthority');
const {
  decideRecovery
} = require('../../backend/services/durableExecutionRecoveryAuthority');
const {
  ExternalActionDispatcher
} = require('../../backend/services/externalActionDispatcher');

function createStore(db, dbPath) {
  let transactionDepth = 0;
  return {
    db,
    dbPath,
    transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('transaction callback required');
      if (transactionDepth > 0) return callback();
      db.exec('BEGIN IMMEDIATE');
      transactionDepth += 1;
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          throw Object.assign(new Error('async transaction forbidden'), {
            code: 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN'
          });
        }
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
}

function installSchema23(db) {
  db.exec(`CREATE TABLE r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  applyBatch41Fix6MArchitectureReferenceClosure(db);
  const wpA = applyArchitectureClosureV2WpA(db);
  assert.equal(wpA.targetSchemaVersion, 22);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:41:00.000Z' });
}

function installActiveHostLease(db) {
  const token = Object.freeze({
    instanceId: 'coverage-write-host',
    hostGeneration: 7,
    fencingToken: 19
  });
  const at = '2026-08-03T03:41:30.000Z';
  db.prepare(`INSERT INTO authority_write_host_lease(
    singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
    host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
    acquired_at,heartbeat_at,updated_at
  ) VALUES(1,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)
  ON CONFLICT(singleton_id) DO UPDATE SET
    owner_instance_id=excluded.owner_instance_id,
    owner_pid=excluded.owner_pid,
    owner_process_identity=excluded.owner_process_identity,
    startup_nonce=excluded.startup_nonce,
    host_generation=excluded.host_generation,
    fencing_token=excluded.fencing_token,
    state='ACTIVE',
    acquired_at_ms=excluded.acquired_at_ms,
    heartbeat_at_ms=excluded.heartbeat_at_ms,
    acquired_at=excluded.acquired_at,
    heartbeat_at=excluded.heartbeat_at,
    updated_at=excluded.updated_at`).run(
    token.instanceId,
    1234,
    'coverage-process',
    'coverage-startup-nonce',
    token.hostGeneration,
    token.fencingToken,
    Date.parse(at),
    Date.parse(at),
    at,
    at,
    at
  );
  return token;
}

function withSchema23(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-v21-durable-coverage-'));
  const dbPath = path.join(root, 'coverage.db');
  const db = new DatabaseSync(dbPath);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
    installSchema23(db);
    const token = installActiveHostLease(db);
    const store = createStore(db, dbPath);
    const clockState = { ms: Date.parse('2026-08-03T03:42:00.000Z') };
    let sequence = 0;
    const authority = new DurableInternalOperationAuthority({
      storeProvider: () => store,
      tokenProvider: () => token,
      clock: () => new Date(clockState.ms).toISOString(),
      idFactory: prefix => `${prefix}-coverage-${++sequence}`,
      leaseMs: 60000
    });
    const result = work({ db, store, token, clockState, authority });
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createAndStart(authority, operationId, options = {}) {
  const fingerprint = `${operationId}-fingerprint`;
  const created = authority.create({
    operationId,
    operationType: 'ai.coverage',
    scopeKey: `${operationId}-scope`,
    objectFingerprint: fingerprint,
    maxAttempts: options.maxAttempts || 2
  });
  assert.equal(created.operation.state, 'SCHEDULED');
  const started = authority.start(operationId, { progress: 1 }).operation;
  assert.equal(started.state, 'RUNNING');
  return { fingerprint, started };
}

function assertContiguousSequences(db, operationId) {
  const rows = db.prepare(`SELECT sequence FROM durable_execution_events
    WHERE execution_id=? ORDER BY sequence ASC`).all(operationId);
  const sequences = rows.map(row => Number(row.sequence));
  assert.ok(sequences.length >= 3, operationId);
  assert.deepEqual(sequences, Array.from({ length: sequences.length }, (_, index) => index + 1), operationId);
}

test('KF-P0-26 canonical Schema-23 internal authority executes success, failure, cancellation, retry and dead-letter semantics', () => withSchema23(({ db, clockState, authority }) => {
  const success = createAndStart(authority, 'coverage-success');
  const succeeded = authority.succeed('coverage-success', { status: 'ok' }, {
    generation: success.started.generation,
    objectFingerprint: success.fingerprint,
    reasonCode: 'COVERAGE_SUCCESS'
  });
  assert.equal(succeeded.operation.state, 'SUCCEEDED');

  const cancelled = createAndStart(authority, 'coverage-cancel');
  const cancelReceipt = authority.cancel('coverage-cancel', { reasonCode: 'COVERAGE_CANCEL' }, {
    generation: cancelled.started.generation,
    objectFingerprint: cancelled.fingerprint
  });
  assert.equal(cancelReceipt.operation.state, 'CANCELLED');

  const failed = createAndStart(authority, 'coverage-fail');
  const failReceipt = authority.fail('coverage-fail', { errorCode: 'COVERAGE_PERMANENT' }, {
    retryable: false,
    generation: failed.started.generation,
    objectFingerprint: failed.fingerprint
  });
  assert.equal(failReceipt.operation.state, 'FAILED');

  const retry = createAndStart(authority, 'coverage-retry', { maxAttempts: 2 });
  const retryReceipt = authority.fail('coverage-retry', { errorCode: 'COVERAGE_TRANSIENT' }, {
    retryable: true,
    retryDelayMs: 1000,
    generation: retry.started.generation,
    objectFingerprint: retry.fingerprint
  });
  assert.equal(retryReceipt.operation.state, 'RETRY_SCHEDULED');
  const retryRow = db.prepare('SELECT * FROM durable_executions WHERE execution_id=?').get('coverage-retry');
  const dueAt = new Date(clockState.ms + 2000).toISOString();
  const recovery = decideRecovery(retryRow, [], dueAt, []);
  assert.equal(recovery.decision, 'REQUEUE_SAFE');
  assert.equal(recovery.targetState, 'SCHEDULED');

  const dead = createAndStart(authority, 'coverage-dead-letter', { maxAttempts: 1 });
  const deadReceipt = authority.fail('coverage-dead-letter', { errorCode: 'COVERAGE_TRANSIENT_FINAL' }, {
    retryable: true,
    retryDelayMs: 1000,
    generation: dead.started.generation,
    objectFingerprint: dead.fingerprint
  });
  assert.equal(deadReceipt.operation.state, 'DEAD_LETTERED');

  for (const operationId of [
    'coverage-success',
    'coverage-cancel',
    'coverage-fail',
    'coverage-retry',
    'coverage-dead-letter'
  ]) assertContiguousSequences(db, operationId);
}));

test('KF-P0-28 heartbeat extends the real lease, fences a stale pre-heartbeat terminal writer, and current owner terminalizes', () => withSchema23(({ db, clockState, authority, token }) => {
  const active = createAndStart(authority, 'coverage-heartbeat');
  const before = active.started;
  const beforeLease = Date.parse(before.leaseExpiresAt);
  clockState.ms += 10000;

  const heartbeat = authority.heartbeat('coverage-heartbeat').operation;
  assert.equal(heartbeat.state, 'RUNNING');
  assert.equal(heartbeat.heartbeatSequence, before.heartbeatSequence + 1);
  assert.ok(Date.parse(heartbeat.leaseExpiresAt) > beforeLease);
  assert.ok(heartbeat.stateVersion > before.stateVersion);

  assert.throws(
    () => authority.executionAuthority.transition({
      executionId: before.executionId,
      allowedStates: ['RUNNING'],
      targetState: 'SUCCEEDED',
      stateVersion: before.stateVersion,
      generation: before.generation,
      ownerId: before.ownerId,
      claimId: before.claimId,
      hostId: token.instanceId,
      hostGeneration: before.hostGeneration,
      fencingToken: before.fencingToken,
      authorityTimestamp: new Date(clockState.ms).toISOString(),
      eventType: 'stale-terminal-attempt',
      reasonCode: 'STALE_PRE_HEARTBEAT',
      payload: { status: 'stale' }
    }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );

  const current = authority.succeed('coverage-heartbeat', { status: 'ok' }, {
    generation: heartbeat.generation,
    objectFingerprint: active.fingerprint,
    reasonCode: 'CURRENT_OWNER_TERMINAL'
  });
  assert.equal(current.operation.state, 'SUCCEEDED');
  assertContiguousSequences(db, 'coverage-heartbeat');
}));

test('KF-P0-26 canonical ExternalActionDispatcher drives a real fenced RUNNING to WAITING_REMOTE to terminal sequence', async () => withSchema23(async ({ db, clockState, authority, token }) => {
  const active = createAndStart(authority, 'coverage-waiting-remote');
  const running = active.started;
  let issueSequence = 0;
  const outboxAuthority = Object.freeze({
    startAttempt(input) {
      return Object.freeze({
        intentId: input.intentId,
        attemptId: 'coverage-attempt-remote',
        stateVersion: 1,
        generation: running.generation,
        ownerId: running.ownerId,
        claimId: running.claimId,
        hostGeneration: running.hostGeneration,
        fencingToken: running.fencingToken
      });
    },
    recordReceipt(input) {
      assert.equal(input.attemptId, 'coverage-attempt-remote');
      return Object.freeze({ receiptId: 'coverage-receipt-remote', receiptType: 'SUCCESS' });
    },
    recordFailureReceipt() { throw new Error('unexpected failure receipt'); },
    markUncertain() { throw new Error('unexpected uncertain receipt'); }
  });
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority,
    executionAuthority: Object.freeze({
      transition(input) {
        return authority.executionAuthority.transition(input);
      }
    }),
    adapter: Object.freeze({
      async perform(envelope) {
        assert.equal(envelope.executionId, running.executionId);
        assert.equal(envelope.claimId, running.claimId);
        assert.equal(envelope.generation, running.generation);
        assert.equal(envelope.hostGeneration, running.hostGeneration);
        assert.equal(envelope.fencingToken, running.fencingToken);
        return Object.freeze({
          providerReceiptId: 'coverage-provider-receipt',
          evidenceReference: 'coverage-provider-evidence',
          result: Object.freeze({ status: 'accepted' })
        });
      }
    }),
    issueTimestamp() {
      issueSequence += 1;
      return new Date(clockState.ms + issueSequence * 1000).toISOString();
    }
  });

  const receipt = await dispatcher.dispatch({
    executionId: running.executionId,
    intentId: 'coverage-intent-remote',
    idempotencyKey: 'coverage-idempotency-remote',
    executionStateVersion: running.stateVersion,
    executionGeneration: running.generation,
    ownerId: running.ownerId,
    claimId: running.claimId,
    hostId: token.instanceId,
    hostGeneration: running.hostGeneration,
    fencingToken: running.fencingToken,
    leaseExpiresAt: running.leaseExpiresAt,
    request: Object.freeze({ bodyReference: 'coverage-body-reference' })
  });
  assert.equal(receipt.receiptId, 'coverage-receipt-remote');

  const final = authority.read('coverage-waiting-remote');
  assert.equal(final.state, 'SUCCEEDED');
  assert.equal(final.history.some(row => row.toState === 'WAITING_REMOTE'), true);
  assert.equal(final.history.some(row => row.eventType === 'external-action-succeeded'), true);
  assertContiguousSequences(db, 'coverage-waiting-remote');
}));

test('KF-P0-27 event sequences stay contiguous across canonical transactional Schema-23 writes', () => withSchema23(({ db, authority }) => {
  for (let index = 0; index < 8; index += 1) {
    const operationId = `coverage-sequence-${index}`;
    const active = createAndStart(authority, operationId);
    authority.progress(operationId, 10 + index);
    authority.succeed(operationId, { status: 'ok' }, {
      generation: active.started.generation,
      objectFingerprint: active.fingerprint,
      reasonCode: 'SEQUENCE_COVERAGE'
    });
    assertContiguousSequences(db, operationId);
  }

  const duplicates = db.prepare(`SELECT execution_id,sequence,COUNT(*) AS count
    FROM durable_execution_events
    GROUP BY execution_id,sequence HAVING COUNT(*)<>1`).all();
  assert.deepEqual(duplicates, []);
}));
