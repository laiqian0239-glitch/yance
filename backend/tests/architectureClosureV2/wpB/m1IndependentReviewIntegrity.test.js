'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removePathWithRetries } = require('../../../../tests/test-support/windows-cleanup');

function withStore(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-m1-review-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let store = null;
  try {
    const { R32SqliteStore } = require('../../../lib/r32SqliteStore');
    store = new R32SqliteStore({
      dbPath,
      ownershipPid: 9917,
      ownershipPidAlive: pid => pid === 9917
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

function setupAttempt(store, suffix, options = {}) {
  const { DurableExecutionAuthority } = require('../../../services/durableExecutionAuthority');
  const { ExternalActionOutboxAuthority } = require('../../../services/externalActionOutboxAuthority');
  const executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  const outbox = new ExternalActionOutboxAuthority({ storeProvider: () => store });
  const host = activeHost(store);
  const execution = executionAuthority.createExecution({
    executionId: `m1-review-execution-${suffix}`,
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: `m1-review-execution-key-${suffix}`,
    traceId: `m1-review-trace-${suffix}`,
    command: { bodyReference: `body-${suffix}` },
    metadata: { reviewGate: 1 },
    authorityTimestamp: options.executionAt || '2026-08-03T07:00:00.000Z'
  });
  const intent = outbox.createIntent({
    intentId: `m1-review-intent-${suffix}`,
    executionId: execution.executionId,
    actionKind: 'MESSAGE_SEND',
    idempotencyKey: `m1-review-intent-key-${suffix}`,
    payload: { recipientReference: `recipient-${suffix}` },
    authorityTimestamp: options.intentAt || '2026-08-03T07:00:01.000Z'
  });
  const claim = outbox.claimIntent({
    intentId: intent.intentId,
    stateVersion: intent.claim.stateVersion,
    generation: intent.claim.generation,
    ownerId: `worker-${suffix}`,
    claimId: `claim-${suffix}`,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: options.leaseStartedAt || '2026-08-03T07:00:02.000Z',
    leaseExpiresAt: options.leaseExpiresAt || '2026-08-03T08:00:00.000Z'
  });
  const attempt = outbox.startAttempt({
    intentId: intent.intentId,
    stateVersion: claim.claim.stateVersion,
    generation: claim.claim.generation,
    ownerId: claim.claim.ownerId,
    claimId: claim.claim.claimId,
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    request: { bodyReference: `body-${suffix}` },
    authorityTimestamp: options.attemptAt || '2026-08-03T07:00:03.000Z'
  });
  return Object.freeze({ executionAuthority, outbox, host, execution, intent, claim, attempt });
}

function hasCompositeAttemptIntentForeignKey(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.id);
    const group = byId.get(id) || [];
    group.push({
      sequence: Number(row.seq),
      target: String(row.table || ''),
      from: String(row.from || ''),
      to: String(row.to || '')
    });
    byId.set(id, group);
  }
  return [...byId.values()].some(group => {
    const normalized = group
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ target, from, to }) => `${target}:${from}:${to}`);
    return normalized.length === 2
      && normalized.includes('external_action_attempts:attempt_id:attempt_id')
      && normalized.includes('external_action_attempts:intent_id:intent_id');
  });
}

test('Schema 23 binds receipts and reconciliations to one exact attempt-intent pair', () => withStore(store => {
  const receiptForeignKeys = store.db.prepare(
    'PRAGMA foreign_key_list(external_action_receipts)'
  ).all();
  const reconciliationForeignKeys = store.db.prepare(
    'PRAGMA foreign_key_list(external_outcome_reconciliations)'
  ).all();
  assert.equal(hasCompositeAttemptIntentForeignKey(receiptForeignKeys), true);
  assert.equal(hasCompositeAttemptIntentForeignKey(reconciliationForeignKeys), true);
}));

test('Schema 23 reconciliation facts carry a versioned canonical content hash', () => withStore(store => {
  const columns = new Set(store.db.prepare(
    'PRAGMA table_info(external_outcome_reconciliations)'
  ).all().map(row => String(row.name || '')));
  assert.equal(columns.has('reconciliation_content_sha256'), true);
  assert.equal(columns.has('content_hash_version'), true);
}));

test('an expired outbox lease cannot issue a terminal receipt', () => withStore(store => {
  const setup = setupAttempt(store, 'expired', {
    leaseStartedAt: '2026-08-03T07:00:02.000Z',
    leaseExpiresAt: '2026-08-03T07:05:00.000Z',
    attemptAt: '2026-08-03T07:00:03.000Z'
  });
  assert.throws(
    () => setup.outbox.recordReceipt({
      intentId: setup.intent.intentId,
      attemptId: setup.attempt.attemptId,
      stateVersion: setup.attempt.stateVersion,
      generation: setup.attempt.generation,
      ownerId: setup.attempt.ownerId,
      claimId: setup.attempt.claimId,
      hostId: setup.host.hostId,
      hostGeneration: setup.attempt.hostGeneration,
      fencingToken: setup.attempt.fencingToken,
      providerReceiptId: 'provider-expired',
      evidenceReference: 'provider:expired',
      result: { accepted: true },
      authorityTimestamp: '2026-08-03T07:05:01.000Z'
    }),
    error => error?.code === 'WP_B_OUTBOX_RECEIPT_CAS_REJECTED'
  );
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(setup.intent.intentId).count, 0);
  assert.equal(store.db.prepare(`SELECT state FROM external_action_claims
    WHERE intent_id=?`).get(setup.intent.intentId).state, 'ATTEMPTED');
}));

test('a terminal receipt cannot borrow an attempt from another intent', () => withStore(store => {
  const left = setupAttempt(store, 'binding-left');
  const right = setupAttempt(store, 'binding-right', {
    executionAt: '2026-08-03T07:10:00.000Z',
    intentAt: '2026-08-03T07:10:01.000Z',
    leaseStartedAt: '2026-08-03T07:10:02.000Z',
    leaseExpiresAt: '2026-08-03T08:10:00.000Z',
    attemptAt: '2026-08-03T07:10:03.000Z'
  });
  assert.throws(
    () => left.outbox.recordReceipt({
      intentId: left.intent.intentId,
      attemptId: right.attempt.attemptId,
      stateVersion: left.attempt.stateVersion,
      generation: left.attempt.generation,
      ownerId: left.attempt.ownerId,
      claimId: left.attempt.claimId,
      hostId: left.host.hostId,
      hostGeneration: left.attempt.hostGeneration,
      fencingToken: left.attempt.fencingToken,
      providerReceiptId: 'provider-cross-intent',
      evidenceReference: 'provider:cross-intent',
      result: { accepted: true },
      authorityTimestamp: '2026-08-03T07:10:04.000Z'
    }),
    error => error?.code === 'WP_B_OUTBOX_RECEIPT_CAS_REJECTED'
      || error?.code === 'WP_B_OUTBOX_ATTEMPT_BINDING_REJECTED'
  );
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(left.intent.intentId).count, 0);
  assert.equal(store.db.prepare(`SELECT state FROM external_action_claims
    WHERE intent_id=?`).get(left.intent.intentId).state, 'ATTEMPTED');
}));

test('outbox persists reconciliation facts with hash and exact attempt binding', () => withStore(store => {
  const setup = setupAttempt(store, 'reconciliation');
  assert.equal(typeof setup.outbox.recordReconciliation, 'function');
  const reconciliation = setup.outbox.recordReconciliation({
    reconciliationId: 'm1-review-reconciliation-1',
    intentId: setup.intent.intentId,
    attemptId: setup.attempt.attemptId,
    observationOutcome: 'REMOTE_RESULT_UNKNOWN',
    evidenceReference: 'provider-query:unknown',
    remoteReceiptId: '',
    observation: { provider: 'facebook', operationId: setup.execution.executionId },
    observedAt: '2026-08-03T07:20:00.000Z',
    authorityTimestamp: '2026-08-03T07:20:01.000Z'
  });
  assert.match(reconciliation.reconciliationContentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(reconciliation.contentHashVersion, 1);
  assert.equal(Object.isFrozen(reconciliation), true);
  const row = store.db.prepare(`SELECT reconciliation_content_sha256,content_hash_version
    FROM external_outcome_reconciliations WHERE reconciliation_id=?`)
    .get(reconciliation.reconciliationId);
  assert.equal(row.reconciliation_content_sha256, reconciliation.reconciliationContentSha256);
  assert.equal(row.content_hash_version, 1);
}));

test('reconciliation orchestration persists the observation before returning a retry decision', () => {
  const { reconcileExternalOutcome } = require('../../../services/externalOutcomeReconciliation');
  const calls = [];
  const result = reconcileExternalOutcome({
    intentId: 'intent-reconciliation-order',
    attemptId: 'attempt-reconciliation-order',
    observation: {
      outcome: 'REMOTE_ABSENCE_PROVEN',
      provider: 'facebook',
      operationId: 'operation-reconciliation-order',
      evidenceReference: 'provider-query:absence',
      remoteReceiptId: '',
      observedAt: '2026-08-03T07:30:00.000Z',
      result: {}
    },
    authorityTimestamp: '2026-08-03T07:30:01.000Z',
    transaction(callback) {
      calls.push('transaction-begin');
      const value = callback();
      calls.push('transaction-commit');
      return value;
    },
    recordReconciliation(input) {
      calls.push(['recordReconciliation', input]);
      return { reconciliationId: 'reconciliation-order-1' };
    }
  });
  assert.deepEqual(calls.map(item => Array.isArray(item) ? item[0] : item), [
    'transaction-begin',
    'recordReconciliation',
    'transaction-commit'
  ]);
  assert.equal(result.reconciliationId, 'reconciliation-order-1');
  assert.equal(result.retryAllowed, true);
});
