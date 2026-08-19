'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removePathWithRetries } = require('../../../../tests/test-support/windows-cleanup');
const {
  requireSchema23StartupRegistration
} = require('../../../../shared/release/wpBM1RedEvidenceAuthority');

const STORE_PATH = require.resolve('../../../lib/r32SqliteStore');
const STORE_ENGINE_PATH = require.resolve('../../../lib/r32SqliteStoreEngine');
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOW_PATH = path.join(REPOSITORY_ROOT, '.github', 'workflows', 'wp-b-validation.yml');
const HISTORICAL_RED_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-m1-red-evidence.json'
);

function withStore(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-startup-v23-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let store = null;
  try {
    const { R32SqliteStore } = require(STORE_PATH);
    store = new R32SqliteStore({
      dbPath,
      ownershipPid: 9876,
      ownershipPidAlive: pid => pid === 9876
    });
    return work(store);
  } finally {
    try { store?.close(); } catch (_) {}
    removePathWithRetries(root);
  }
}

function activeHost(store) {
  const row = store.db.prepare(`SELECT owner_instance_id,host_generation,fencing_token
    FROM authority_write_host_lease WHERE singleton_id=1 AND state='ACTIVE'`).get();
  assert.ok(row, 'active AuthorityWriteHost lease required');
  return Object.freeze({
    hostId: String(row.owner_instance_id),
    hostGeneration: Number(row.host_generation),
    fencingToken: Number(row.fencing_token)
  });
}

function createExecution(authority, overrides = {}) {
  return authority.createExecution({
    executionId: 'review-execution-1',
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: 'review-execution-key-1',
    traceId: 'review-trace-1',
    command: { recipientReference: 'recipient-review-1', bodyReference: 'body-review-1' },
    metadata: { reviewGate: 1 },
    maxAttempts: 3,
    deadlineAt: '2026-08-03T08:00:00.000Z',
    authorityTimestamp: '2026-08-03T06:00:00.000Z',
    ...overrides
  });
}

test('immutable RED authority explicitly permits Schema 23 startup registration', () => {
  const report = requireSchema23StartupRegistration();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.schema23StartupRegistrationAuthorized, true);
});

test('R32SqliteStore preserves Schema 23 in the monotonically advancing startup migration chain', () => {
  delete require.cache[STORE_PATH];
  const { SCHEMA_VERSION } = require(STORE_PATH);
  assert.ok(SCHEMA_VERSION >= 23, 'current schema must include the historical Schema 23 startup layer');

  withStore(store => {
    assert.equal(Number(store.getMeta('schema_version', null)), SCHEMA_VERSION);
    assert.equal(Number(store.getMeta('schemaVersion', null)), SCHEMA_VERSION);
    const migration = store.db.prepare(`SELECT migration_id,target_schema_version,status,checksum
      FROM r32_schema_migrations WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    assert.equal(migration.migration_id, '023_architecture_closure_v2_wp_b');
    assert.equal(migration.target_schema_version, 23);
    assert.equal(migration.status, 'completed');
    assert.match(migration.checksum, /^[a-f0-9]{64}$/u);
    for (const table of [
      'external_action_intents',
      'external_action_claims',
      'external_action_attempts',
      'external_action_receipts',
      'external_outcome_reconciliations',
      'durable_execution_checkpoints'
    ]) {
      assert.equal(Boolean(store.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table)), true, table);
    }
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('startup assembly verifies RED evidence after the Engine WP-A chain and before WP-B', () => {
  const source = fs.readFileSync(STORE_PATH, 'utf8');
  const engineSource = fs.readFileSync(STORE_ENGINE_PATH, 'utf8');
  const engineCall = source.indexOf('ENGINE_PROTOTYPE.ensureSchema.call(store)');
  const evidenceImport = source.indexOf('requireSchema23StartupRegistration');
  const wpBImport = source.indexOf('applyArchitectureClosureV2WpB');
  const evidenceCall = source.lastIndexOf('requireSchema23StartupRegistration(');
  const wpBCall = source.indexOf('applyArchitectureClosureV2WpB(store.db');
  const projectionCall = source.indexOf('ensureCanonicalProjectionReceiptSchema(store.db)');
  const wpACall = engineSource.indexOf('applyArchitectureClosureV2WpA(this.db)');
  const engineProjectionCall = engineSource.indexOf('ensureCanonicalProjectionReceiptSchema(this.db)');

  assert.ok(evidenceImport >= 0, 'RED authority import missing');
  assert.ok(wpBImport >= 0, 'Schema 23 migration import missing');
  assert.ok(wpACall >= 0, 'Engine Schema 22 call missing');
  assert.ok(engineProjectionCall > wpACall, 'Engine projection finalization must follow Schema 22');
  assert.ok(engineCall >= 0, 'Engine startup chain call missing');
  assert.ok(evidenceCall > engineCall, 'RED authority must be checked after the Engine WP-A chain');
  assert.ok(wpBCall > evidenceCall, 'Schema 23 must run only after RED authority');
  assert.ok(projectionCall > wpBCall, 'projection schema finalization must run after Schema 23');
  assert.match(source.slice(wpBCall, projectionCall), /at:\s*nowIso\(\)/u);
});

test('current WP-B validation truth records Schema 23 applied without rewriting historical RED evidence', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const historicalRed = JSON.parse(fs.readFileSync(HISTORICAL_RED_PATH, 'utf8'));

  assert.equal(
    historicalRed.governance.schema23AppliedToProductionStartup,
    false,
    'historical RED evidence must remain immutable'
  );
  assert.match(workflow, /echo '- schema23Applied=true'/u);
  assert.doesNotMatch(workflow, /echo '- schema23Applied=false'/u);
  assert.match(workflow, /echo '- thirdPartyProductionUseAuthorized=false'/u);
  assert.match(workflow, /echo '- wpCAuthorized=false'/u);
  assert.match(workflow, /echo '- formalRelease=false'/u);
  assert.match(workflow, /echo '- publish=false'/u);
});

test('Schema 23 remaining lifecycle facades fail closed with an explicit Milestone 2 boundary', () => {
  const modulePath = require.resolve('../../../services/durableExecutionAuthority');
  delete require.cache[modulePath];
  const { DurableExecutionAuthority } = require(modulePath);
  const store = {
    db: {
      prepare(sql) {
        assert.match(sql, /r32_schema_migrations/u);
        return { get: () => ({ status: 'completed' }) };
      }
    }
  };
  const authority = new DurableExecutionAuthority({ storeProvider: () => store });
  for (const operation of [
    'heartbeat',
    'waitRemote',
    'succeed',
    'fail',
    'requestCancel',
    'acknowledgeCancel',
    'retry',
    'deadLetter'
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DurableExecutionAuthority.prototype, operation),
      true,
      `${operation} must be owned by the Schema 23 facade`
    );
    assert.throws(
      () => authority[operation]({ executionId: 'execution-review-gate' }),
      error => error?.code === 'WP_B_M2_OPERATION_NOT_YET_AUTHORIZED'
        && error?.operation === operation
    );
  }
});

test('expired external action claims expose one fenced reclaim CAS', () => {
  const modulePath = require.resolve('../../../services/externalActionOutboxAuthority');
  delete require.cache[modulePath];
  const { ExternalActionOutboxAuthority } = require(modulePath);
  const calls = [];
  const store = {
    db: {
      prepare(sql) {
        if (/r32_schema_migrations/u.test(sql)) {
          return { get: () => ({ status: 'completed' }) };
        }
        return {
          run(...parameters) {
            calls.push({ sql, parameters });
            return { changes: 1 };
          }
        };
      }
    },
    transaction(callback) { return callback(); }
  };
  const authority = new ExternalActionOutboxAuthority({ storeProvider: () => store });
  assert.equal(typeof authority.reclaimExpiredClaim, 'function');
  const result = authority.reclaimExpiredClaim({
    intentId: 'intent-review-reclaim',
    stateVersion: 4,
    generation: 2,
    expiredOwnerId: 'worker-old',
    expiredClaimId: 'claim-old',
    expiredHostGeneration: 7,
    expiredFencingToken: 19,
    hostId: 'authority-host-new',
    hostGeneration: 8,
    fencingToken: 20,
    authorityTimestamp: '2026-08-03T05:00:00.000Z'
  });

  assert.equal(calls.length, 1);
  const sql = calls[0].sql.replace(/\s+/gu, ' ');
  for (const marker of [
    "state='READY'",
    'state_version=state_version+1',
    'generation=generation+1',
    "owner_id=''",
    "claim_id=''",
    'host_generation=0',
    'fencing_token=0',
    'lease_expires_at<?',
    'authority_write_host_lease'
  ]) assert.ok(sql.includes(marker), marker);
  assert.equal(result.state, 'READY');
  assert.equal(result.stateVersion, 5);
  assert.equal(result.generation, 3);
  assert.equal(Object.isFrozen(result), true);
});

test('remote success reconciliation requires one caller-supplied authority transaction', () => {
  const modulePath = require.resolve('../../../services/externalOutcomeReconciliation');
  delete require.cache[modulePath];
  const { reconcileExternalOutcome } = require(modulePath);
  const observation = {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    provider: 'facebook',
    operationId: 'operation-review-transaction',
    evidenceReference: 'provider-receipt:review-transaction',
    remoteReceiptId: 'remote-review-transaction',
    observedAt: '2026-08-03T05:10:00.000Z',
    result: { postId: 'post-review-transaction' }
  };

  assert.throws(
    () => reconcileExternalOutcome({
      intentId: 'intent-review-transaction',
      attemptId: 'attempt-review-transaction',
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      recordReconciliation: () => ({ reconciliationId: 'reconciliation-review-transaction' }),
      recordReceipt: () => ({ receiptId: 'receipt-review-transaction' }),
      transitionExecution: () => ({ state: 'SUCCEEDED' })
    }),
    error => error?.code === 'WP_B_RECONCILIATION_TRANSACTION_REQUIRED'
  );

  const calls = [];
  const result = reconcileExternalOutcome({
    intentId: 'intent-review-transaction',
    attemptId: 'attempt-review-transaction',
    observation,
    authorityTimestamp: '2026-08-03T05:10:01.000Z',
    transaction(callback) {
      calls.push('transaction-begin');
      const value = callback();
      calls.push('transaction-commit');
      return value;
    },
    recordReconciliation() {
      calls.push('recordReconciliation');
      return { reconciliationId: 'reconciliation-review-transaction' };
    },
    recordReceipt() {
      calls.push('recordReceipt');
      return { receiptId: 'receipt-review-transaction' };
    },
    transitionExecution() {
      calls.push('transitionExecution');
      return { state: 'SUCCEEDED' };
    }
  });
  assert.deepEqual(calls, [
    'transaction-begin',
    'recordReconciliation',
    'recordReceipt',
    'transitionExecution',
    'transaction-commit'
  ]);
  assert.equal(result.reconciliationId, 'reconciliation-review-transaction');
  assert.equal(result.state, 'SUCCEEDED');

  const durable = { reconciliation: false, receipt: false };
  assert.throws(
    () => reconcileExternalOutcome({
      intentId: 'intent-review-transaction',
      attemptId: 'attempt-review-transaction',
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      transaction(callback) {
        const before = { ...durable };
        try {
          return callback();
        } catch (error) {
          durable.reconciliation = before.reconciliation;
          durable.receipt = before.receipt;
          throw error;
        }
      },
      recordReconciliation() {
        durable.reconciliation = true;
        return { reconciliationId: 'reconciliation-review-rollback' };
      },
      recordReceipt() {
        durable.receipt = true;
        return { receiptId: 'receipt-review-rollback' };
      },
      transitionExecution() {
        throw Object.assign(new Error('transition rejected'), { code: 'TRANSITION_REJECTED' });
      }
    }),
    error => error?.code === 'TRANSITION_REJECTED'
  );
  assert.deepEqual(durable, { reconciliation: false, receipt: false });
});

test('real SQLite reclaim invalidates the expired claimant and permits one fresh claim', () => withStore(store => {
  const { DurableExecutionAuthority } = require('../../../services/durableExecutionAuthority');
  const { ExternalActionOutboxAuthority } = require('../../../services/externalActionOutboxAuthority');
  const executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  const outbox = new ExternalActionOutboxAuthority({ storeProvider: () => store });
  const host = activeHost(store);
  const execution = createExecution(executionAuthority, {
    executionId: 'review-reclaim-execution',
    idempotencyKey: 'review-reclaim-execution-key'
  });
  const intent = outbox.createIntent({
    intentId: 'review-reclaim-intent',
    executionId: execution.executionId,
    actionKind: 'MESSAGE_SEND',
    idempotencyKey: 'review-reclaim-intent-key',
    payload: { recipientReference: 'recipient-review-reclaim' },
    authorityTimestamp: '2026-08-03T06:00:01.000Z'
  });
  const oldClaim = outbox.claimIntent({
    intentId: intent.intentId,
    stateVersion: intent.claim.stateVersion,
    generation: intent.claim.generation,
    ownerId: 'worker-review-old',
    claimId: 'claim-review-old',
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: '2026-08-03T06:00:02.000Z',
    leaseExpiresAt: '2026-08-03T06:05:00.000Z'
  });

  const reclaimed = outbox.reclaimExpiredClaim({
    intentId: intent.intentId,
    stateVersion: oldClaim.claim.stateVersion,
    generation: oldClaim.claim.generation,
    expiredOwnerId: oldClaim.claim.ownerId,
    expiredClaimId: oldClaim.claim.claimId,
    expiredHostGeneration: oldClaim.claim.hostGeneration,
    expiredFencingToken: oldClaim.claim.fencingToken,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    authorityTimestamp: '2026-08-03T06:05:01.000Z'
  });
  assert.equal(reclaimed.state, 'READY');
  assert.equal(reclaimed.stateVersion, 2);
  assert.equal(reclaimed.generation, 2);

  const freshClaim = outbox.claimIntent({
    intentId: intent.intentId,
    stateVersion: reclaimed.stateVersion,
    generation: reclaimed.generation,
    ownerId: 'worker-review-new',
    claimId: 'claim-review-new',
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: '2026-08-03T06:05:02.000Z',
    leaseExpiresAt: '2026-08-03T06:15:00.000Z'
  });
  assert.equal(freshClaim.claim.state, 'CLAIMED');
  assert.equal(freshClaim.claim.stateVersion, 3);
  assert.equal(freshClaim.claim.generation, 3);
  assert.equal(freshClaim.claim.ownerId, 'worker-review-new');

  assert.throws(
    () => outbox.startAttempt({
      intentId: intent.intentId,
      stateVersion: oldClaim.claim.stateVersion,
      generation: oldClaim.claim.generation,
      ownerId: oldClaim.claim.ownerId,
      claimId: oldClaim.claim.claimId,
      hostId: host.hostId,
      hostGeneration: oldClaim.claim.hostGeneration,
      fencingToken: oldClaim.claim.fencingToken,
      request: { bodyReference: 'stale-body' },
      authorityTimestamp: '2026-08-03T06:06:00.000Z'
    }),
    error => error?.code === 'WP_B_OUTBOX_ATTEMPT_CAS_REJECTED'
  );
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_attempts
    WHERE intent_id=?`).get(intent.intentId).count, 0);
}));

test('real SQLite rolls back a reconciliation receipt when the terminal transition fails', () => withStore(store => {
  const { DurableExecutionAuthority } = require('../../../services/durableExecutionAuthority');
  const { ExternalActionOutboxAuthority } = require('../../../services/externalActionOutboxAuthority');
  const { reconcileExternalOutcome } = require('../../../services/externalOutcomeReconciliation');
  const executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  const outbox = new ExternalActionOutboxAuthority({ storeProvider: () => store });
  const host = activeHost(store);
  const created = createExecution(executionAuthority, {
    executionId: 'review-reconciliation-execution',
    idempotencyKey: 'review-reconciliation-execution-key'
  });
  const scheduled = executionAuthority.schedule({
    executionId: created.executionId,
    expectedStateVersion: created.stateVersion,
    generation: created.generation,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    authorityTimestamp: '2026-08-03T06:10:01.000Z'
  });
  const claimed = executionAuthority.claim({
    executionId: scheduled.executionId,
    expectedStateVersion: scheduled.stateVersion,
    generation: scheduled.generation,
    ownerId: 'worker-review-reconciliation',
    claimId: 'claim-review-reconciliation',
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: '2026-08-03T06:10:02.000Z',
    leaseExpiresAt: '2026-08-03T07:00:00.000Z'
  });
  const running = executionAuthority.transition({
    executionId: claimed.executionId,
    expectedStateVersion: claimed.stateVersion,
    allowedStates: ['CLAIMED'],
    targetState: 'RUNNING',
    generation: claimed.generation,
    ownerId: claimed.ownerId,
    claimId: claimed.claimId,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    authorityTimestamp: '2026-08-03T06:10:03.000Z',
    eventType: 'started'
  });
  const waiting = executionAuthority.transition({
    executionId: running.executionId,
    expectedStateVersion: running.stateVersion,
    allowedStates: ['RUNNING'],
    targetState: 'WAITING_REMOTE',
    generation: running.generation,
    ownerId: running.ownerId,
    claimId: running.claimId,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    authorityTimestamp: '2026-08-03T06:10:04.000Z',
    eventType: 'waiting-remote'
  });

  const intent = outbox.createIntent({
    intentId: 'review-reconciliation-intent',
    executionId: waiting.executionId,
    actionKind: 'MESSAGE_SEND',
    idempotencyKey: 'review-reconciliation-intent-key',
    payload: { recipientReference: 'recipient-review-reconciliation' },
    authorityTimestamp: '2026-08-03T06:10:05.000Z'
  });
  const outboxClaim = outbox.claimIntent({
    intentId: intent.intentId,
    stateVersion: intent.claim.stateVersion,
    generation: intent.claim.generation,
    ownerId: 'worker-review-reconciliation',
    claimId: 'outbox-claim-review-reconciliation',
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: '2026-08-03T06:10:06.000Z',
    leaseExpiresAt: '2026-08-03T07:00:00.000Z'
  });
  const attempt = outbox.startAttempt({
    intentId: intent.intentId,
    stateVersion: outboxClaim.claim.stateVersion,
    generation: outboxClaim.claim.generation,
    ownerId: outboxClaim.claim.ownerId,
    claimId: outboxClaim.claim.claimId,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    request: { bodyReference: 'review-reconciliation-body' },
    authorityTimestamp: '2026-08-03T06:10:07.000Z'
  });
  const observation = {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    provider: 'facebook',
    operationId: waiting.executionId,
    evidenceReference: 'provider-receipt:review-reconciliation',
    remoteReceiptId: 'remote-review-reconciliation',
    observedAt: '2026-08-03T06:10:08.000Z',
    result: { postId: 'post-review-reconciliation' }
  };

  assert.throws(
    () => reconcileExternalOutcome({
      intentId: intent.intentId,
      attemptId: attempt.attemptId,
      observation,
      authorityTimestamp: '2026-08-03T06:10:09.000Z',
      transaction: callback => store.transaction(callback),
      recordReconciliation: reconciliation => outbox.recordReconciliation(reconciliation),
      recordReceipt: trusted => outbox.recordReceipt({
        intentId: attempt.intentId,
        attemptId: attempt.attemptId,
        stateVersion: attempt.stateVersion,
        generation: attempt.generation,
        ownerId: attempt.ownerId,
        claimId: attempt.claimId,
        hostId: host.hostId,
        hostGeneration: attempt.hostGeneration,
        fencingToken: attempt.fencingToken,
        providerReceiptId: trusted.remoteReceiptId,
        evidenceReference: trusted.evidenceReference,
        result: trusted.result,
        authorityTimestamp: trusted.authorityTimestamp
      }),
      transitionExecution: transition => executionAuthority.transition({
        executionId: waiting.executionId,
        expectedStateVersion: waiting.stateVersion,
        allowedStates: ['WAITING_REMOTE'],
        targetState: 'SUCCEEDED',
        generation: waiting.generation,
        ownerId: 'stale-worker-review-reconciliation',
        claimId: waiting.claimId,
        hostId: host.hostId,
        hostGeneration: host.hostGeneration,
        fencingToken: host.fencingToken,
        authorityTimestamp: transition.authorityTimestamp,
        eventType: 'remote-success',
        payload: { trustedReceiptId: transition.trustedReceiptId }
      })
    }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );

  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 0);
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_outcome_reconciliations
    WHERE intent_id=?`).get(intent.intentId).count, 0);
  const claimAfterRollback = store.db.prepare(`SELECT state,state_version FROM external_action_claims
    WHERE intent_id=?`).get(intent.intentId);
  assert.deepEqual({ ...claimAfterRollback }, { state: 'ATTEMPTED', state_version: 2 });
  assert.equal(executionAuthority.get(waiting.executionId).state, 'WAITING_REMOTE');

  const success = reconcileExternalOutcome({
    intentId: intent.intentId,
    attemptId: attempt.attemptId,
    observation,
    authorityTimestamp: '2026-08-03T06:10:10.000Z',
    transaction: callback => store.transaction(callback),
    recordReconciliation: reconciliation => outbox.recordReconciliation(reconciliation),
    recordReceipt: trusted => outbox.recordReceipt({
      intentId: attempt.intentId,
      attemptId: attempt.attemptId,
      stateVersion: attempt.stateVersion,
      generation: attempt.generation,
      ownerId: attempt.ownerId,
      claimId: attempt.claimId,
      hostId: host.hostId,
      hostGeneration: attempt.hostGeneration,
      fencingToken: attempt.fencingToken,
      providerReceiptId: trusted.remoteReceiptId,
      evidenceReference: trusted.evidenceReference,
      result: trusted.result,
      authorityTimestamp: trusted.authorityTimestamp
    }),
    transitionExecution: transition => executionAuthority.transition({
      executionId: waiting.executionId,
      expectedStateVersion: waiting.stateVersion,
      allowedStates: ['WAITING_REMOTE'],
      targetState: 'SUCCEEDED',
      generation: waiting.generation,
      ownerId: waiting.ownerId,
      claimId: waiting.claimId,
      hostId: host.hostId,
      hostGeneration: host.hostGeneration,
      fencingToken: host.fencingToken,
      authorityTimestamp: transition.authorityTimestamp,
      eventType: 'remote-success',
      payload: { trustedReceiptId: transition.trustedReceiptId }
    })
  });
  assert.equal(success.state, 'SUCCEEDED');
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_outcome_reconciliations
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(store.db.prepare(`SELECT state FROM external_action_claims
    WHERE intent_id=?`).get(intent.intentId).state, 'COMPLETED');
  assert.equal(executionAuthority.get(waiting.executionId).state, 'SUCCEEDED');
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
}));
