'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const recoveryPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'services',
  'durableExecutionRecoveryAuthority.js'
);

function recoveryModule() {
  assert.equal(fs.existsSync(recoveryPath), true, 'WP_B_M2_RECOVERY_AUTHORITY_REQUIRED');
  delete require.cache[require.resolve(recoveryPath)];
  return require(recoveryPath);
}

function execution(overrides = {}) {
  return Object.freeze({
    executionId: 'execution-recovery-1',
    state: 'RUNNING',
    stateVersion: 4,
    generation: 2,
    ownerId: 'stale-owner',
    claimId: 'stale-claim',
    hostGeneration: 3,
    fencingToken: 7,
    leaseExpiresAt: '2026-08-04T02:00:00.000Z',
    deadlineAt: '2026-08-04T04:00:00.000Z',
    nextAttemptAt: '',
    createdAt: '2026-08-04T01:00:00.000Z',
    ...overrides
  });
}

function authorityFixture({ row, attempts = [], rows, now = '2026-08-04T03:00:00.000Z' } = {}) {
  const writes = [];
  const { DurableExecutionRecoveryAuthority } = recoveryModule();
  const authority = new DurableExecutionRecoveryAuthority({
    clock: () => now,
    executionReader: executionId => {
      if (row && row.executionId === executionId) return row;
      return null;
    },
    attemptReader: executionId => attempts.filter(attempt => attempt.executionId === executionId),
    nonterminalReader: () => rows || (row ? [row] : []),
    decisionWriter: input => {
      writes.push(input);
      return Object.freeze({
        executionId: input.execution.executionId,
        fromState: input.execution.state,
        targetState: input.targetState,
        stateVersion: Number(input.execution.stateVersion || 0) + 1
      });
    }
  });
  return { authority, writes };
}

test('M2-REC-007 recovery decision vocabulary is exact and deeply frozen', () => {
  const { DECISIONS } = recoveryModule();
  assert.deepEqual(DECISIONS, {
    REQUEUE_SAFE: 'REQUEUE_SAFE',
    RECONCILE_REQUIRED: 'RECONCILE_REQUIRED',
    CANCEL_CONFIRMATION_REQUIRED: 'CANCEL_CONFIRMATION_REQUIRED',
    DEADLINE_EXPIRED: 'DEADLINE_EXPIRED',
    NO_ACTION: 'NO_ACTION'
  });
  assert.equal(Object.isFrozen(DECISIONS), true);
});

test('M2-REC-008 a persisted attempt overrides expired RUNNING recovery to reconciliation', () => {
  const row = execution({ deadlineAt: '2026-08-04T02:30:00.000Z' });
  const { authority, writes } = authorityFixture({
    row,
    attempts: [Object.freeze({ executionId: row.executionId, attemptId: 'attempt-recovery-1' })]
  });

  const receipt = authority.recoverExecution(row.executionId);
  assert.equal(receipt.decision, 'RECONCILE_REQUIRED');
  assert.equal(receipt.persistedAttemptCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].targetState, 'UNCERTAIN_REMOTE_OUTCOME');
  assert.notEqual(writes[0].targetState, 'SCHEDULED');
  assert.equal(Object.isFrozen(receipt), true);
});

test('M2-REC-009 an expired claim without an attempt is safely requeued through the writer', () => {
  const row = execution({ state: 'CLAIMED' });
  const { authority, writes } = authorityFixture({ row });

  const receipt = authority.recoverExecution(row.executionId);
  assert.equal(receipt.decision, 'REQUEUE_SAFE');
  assert.equal(receipt.persistedAttemptCount, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].targetState, 'SCHEDULED');
  assert.equal(writes[0].clearOwnership, true);
});

test('M2-REC-010 uncertain remote outcomes always require reconciliation and never automatic retry', () => {
  const row = execution({
    state: 'UNCERTAIN_REMOTE_OUTCOME',
    ownerId: '',
    claimId: '',
    hostGeneration: 0,
    fencingToken: 0,
    leaseExpiresAt: ''
  });
  const { authority, writes } = authorityFixture({ row });

  const receipt = authority.recoverExecution(row.executionId);
  assert.equal(receipt.decision, 'RECONCILE_REQUIRED');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].targetState, 'UNCERTAIN_REMOTE_OUTCOME');
  assert.notEqual(writes[0].targetState, 'RETRY_SCHEDULED');
  assert.notEqual(writes[0].targetState, 'SCHEDULED');
});

test('M2-REC-011 cancellation and deadline decisions remain distinct terminal policies', () => {
  const cancelRow = execution({ state: 'CANCEL_REQUESTED' });
  const cancelFixture = authorityFixture({
    row: cancelRow,
    attempts: [Object.freeze({ executionId: cancelRow.executionId, attemptId: 'attempt-cancel-1' })]
  });
  const cancelReceipt = cancelFixture.authority.recoverExecution(cancelRow.executionId);
  assert.equal(cancelReceipt.decision, 'CANCEL_CONFIRMATION_REQUIRED');
  assert.equal(cancelFixture.writes[0].targetState, 'CANCEL_REQUESTED');

  const deadlineRow = execution({
    executionId: 'execution-deadline-1',
    state: 'SCHEDULED',
    ownerId: '',
    claimId: '',
    hostGeneration: 0,
    fencingToken: 0,
    leaseExpiresAt: '',
    deadlineAt: '2026-08-04T02:30:00.000Z'
  });
  const deadlineFixture = authorityFixture({ row: deadlineRow });
  const deadlineReceipt = deadlineFixture.authority.recoverExecution(deadlineRow.executionId);
  assert.equal(deadlineReceipt.decision, 'DEADLINE_EXPIRED');
  assert.equal(deadlineFixture.writes[0].targetState, 'FAILED');
});

test('M2-REC-012 batch recovery is deterministic and returns frozen decision receipts', () => {
  const rows = [
    execution({ executionId: 'execution-b', createdAt: '2026-08-04T01:00:01.000Z', state: 'SCHEDULED', ownerId: '', claimId: '', hostGeneration: 0, fencingToken: 0, leaseExpiresAt: '' }),
    execution({ executionId: 'execution-a', createdAt: '2026-08-04T01:00:00.000Z', state: 'SCHEDULED', ownerId: '', claimId: '', hostGeneration: 0, fencingToken: 0, leaseExpiresAt: '' })
  ];
  const writes = [];
  const { DurableExecutionRecoveryAuthority } = recoveryModule();
  const authority = new DurableExecutionRecoveryAuthority({
    clock: () => '2026-08-04T03:00:00.000Z',
    executionReader: executionId => rows.find(row => row.executionId === executionId) || null,
    attemptReader: () => [],
    nonterminalReader: () => rows,
    decisionWriter: input => {
      writes.push(input.execution.executionId);
      return Object.freeze({ executionId: input.execution.executionId, targetState: input.targetState });
    }
  });

  const receipts = authority.recoverNonterminalExecutions();
  assert.deepEqual(receipts.map(receipt => receipt.executionId), ['execution-a', 'execution-b']);
  assert.deepEqual(writes, ['execution-a', 'execution-b']);
  assert.equal(Object.isFrozen(receipts), true);
  assert.equal(receipts.every(Object.isFrozen), true);
});
