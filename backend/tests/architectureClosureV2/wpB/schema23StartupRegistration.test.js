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

test('immutable RED authority explicitly permits Schema 23 startup registration', () => {
  const report = requireSchema23StartupRegistration();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.schema23StartupRegistrationAuthorized, true);
});

test('R32SqliteStore registers Schema 23 in the one startup migration chain', () => {
  delete require.cache[STORE_PATH];
  const { SCHEMA_VERSION } = require(STORE_PATH);
  assert.equal(SCHEMA_VERSION, 23);

  withStore(store => {
    assert.equal(store.getMeta('schema_version', null), 23);
    assert.equal(store.getMeta('schemaVersion', null), 23);
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
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      recordReceipt: () => ({ receiptId: 'receipt-review-transaction' }),
      transitionExecution: () => ({ state: 'SUCCEEDED' })
    }),
    error => error?.code === 'WP_B_RECONCILIATION_TRANSACTION_REQUIRED'
  );

  const calls = [];
  const result = reconcileExternalOutcome({
    observation,
    authorityTimestamp: '2026-08-03T05:10:01.000Z',
    transaction(callback) {
      calls.push('transaction-begin');
      const value = callback();
      calls.push('transaction-commit');
      return value;
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
    'recordReceipt',
    'transitionExecution',
    'transaction-commit'
  ]);
  assert.equal(result.state, 'SUCCEEDED');

  const durable = { receipt: false };
  assert.throws(
    () => reconcileExternalOutcome({
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      transaction(callback) {
        const before = durable.receipt;
        try {
          return callback();
        } catch (error) {
          durable.receipt = before;
          throw error;
        }
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
  assert.equal(durable.receipt, false);
});
