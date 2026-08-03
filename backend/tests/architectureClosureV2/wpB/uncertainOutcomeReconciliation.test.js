'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function reconciliationModule() {
  delete require.cache[require.resolve('../../../services/externalOutcomeReconciliation')];
  return require('../../../services/externalOutcomeReconciliation');
}

function provenSuccess() {
  return {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    provider: 'facebook',
    operationId: 'operation-1',
    evidenceReference: 'provider-receipt:remote-1',
    remoteReceiptId: 'remote-1',
    observedAt: '2026-08-03T02:45:00.000Z',
    result: { postId: 'post-1' }
  };
}

test('reconciliation accepts only success, absence or unknown observations', () => {
  const { OUTCOMES, normalizeReconciliationObservation } = reconciliationModule();
  assert.deepEqual(OUTCOMES, {
    REMOTE_SUCCESS_PROVEN: 'REMOTE_SUCCESS_PROVEN',
    REMOTE_ABSENCE_PROVEN: 'REMOTE_ABSENCE_PROVEN',
    REMOTE_RESULT_UNKNOWN: 'REMOTE_RESULT_UNKNOWN'
  });
  assert.throws(
    () => normalizeReconciliationObservation({ outcome: 'FAILED' }),
    error => error?.code === 'WP_B_RECONCILIATION_OUTCOME_INVALID'
  );
});

test('normalized observations are exact, canonical and deeply immutable', () => {
  const { normalizeReconciliationObservation } = reconciliationModule();
  const observation = normalizeReconciliationObservation(provenSuccess());
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.result), true);
  assert.equal(observation.observedAt, '2026-08-03T02:45:00.000Z');
  assert.throws(
    () => normalizeReconciliationObservation({ ...provenSuccess(), unregistered: true }),
    error => error?.code === 'WP_B_RECONCILIATION_OBSERVATION_INVALID'
  );
  assert.throws(
    () => normalizeReconciliationObservation({ ...provenSuccess(), remoteReceiptId: '' }),
    error => error?.code === 'WP_B_RECONCILIATION_PROOF_REQUIRED'
  );
});

test('remote success records one trusted receipt before terminal transition', () => {
  const { reconcileExternalOutcome } = reconciliationModule();
  const calls = [];
  const result = reconcileExternalOutcome({
    observation: provenSuccess(),
    authorityTimestamp: '2026-08-03T02:45:01.000Z',
    recordReceipt(receipt) {
      calls.push(['recordReceipt', receipt]);
      return { receiptId: 'trusted-receipt-1' };
    },
    transitionExecution(transition) {
      calls.push(['transitionExecution', transition]);
      return { state: transition.state };
    }
  });

  assert.deepEqual(calls.map(([name]) => name), ['recordReceipt', 'transitionExecution']);
  assert.equal(calls[1][1].state, 'SUCCEEDED');
  assert.equal(calls[1][1].trustedReceiptId, 'trusted-receipt-1');
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(Object.isFrozen(result), true);
});

test('receipt persistence failure prevents a terminal transition', () => {
  const { reconcileExternalOutcome } = reconciliationModule();
  let transitionCount = 0;
  assert.throws(
    () => reconcileExternalOutcome({
      observation: provenSuccess(),
      authorityTimestamp: '2026-08-03T02:45:01.000Z',
      recordReceipt() {
        throw Object.assign(new Error('storage failed'), { code: 'STORAGE_FAILED' });
      },
      transitionExecution() {
        transitionCount += 1;
      }
    }),
    error => error?.code === 'STORAGE_FAILED'
  );
  assert.equal(transitionCount, 0);
});

test('remote absence is the only observation that permits another physical attempt', () => {
  const { canScheduleAnotherAttempt, OUTCOMES } = reconciliationModule();
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_ABSENCE_PROVEN), true);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_SUCCESS_PROVEN), false);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_RESULT_UNKNOWN), false);
  assert.throws(
    () => canScheduleAnotherAttempt('FAILED'),
    error => error?.code === 'WP_B_RECONCILIATION_OUTCOME_INVALID'
  );
});

test('absence and unknown outcomes remain nonterminal and side-effect free', () => {
  const { reconcileExternalOutcome, OUTCOMES } = reconciliationModule();
  for (const [outcome, retryAllowed] of [
    [OUTCOMES.REMOTE_ABSENCE_PROVEN, true],
    [OUTCOMES.REMOTE_RESULT_UNKNOWN, false]
  ]) {
    let receiptCount = 0;
    let transitionCount = 0;
    const result = reconcileExternalOutcome({
      observation: {
        outcome,
        provider: 'facebook',
        operationId: 'operation-1',
        evidenceReference: 'query:remote-1',
        observedAt: '2026-08-03T02:45:00.000Z',
        result: {}
      },
      authorityTimestamp: '2026-08-03T02:45:01.000Z',
      recordReceipt() { receiptCount += 1; },
      transitionExecution() { transitionCount += 1; }
    });
    assert.equal(result.terminal, false);
    assert.equal(result.retryAllowed, retryAllowed);
    assert.equal(receiptCount, 0);
    assert.equal(transitionCount, 0);
  }
});

test('manual resolution is an append-only deeply immutable receipt', () => {
  const { createManualResolutionReceipt } = reconciliationModule();
  const receipt = createManualResolutionReceipt({
    operationId: 'operation-1',
    outcome: 'REMOTE_ABSENCE_PROVEN',
    actor: 'operator:alice',
    reasonCode: 'PROVIDER_CONFIRMED_ABSENCE',
    evidenceReference: 'ticket:123',
    authorityTimestamp: '2026-08-03T02:46:00.000Z'
  });
  assert.equal(receipt.receiptType, 'MANUAL_RESOLUTION');
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(receipt.appendOnly, true);
  assert.throws(
    () => createManualResolutionReceipt({
      operationId: 'operation-1',
      outcome: 'REMOTE_RESULT_UNKNOWN',
      actor: '',
      reasonCode: 'UNKNOWN',
      evidenceReference: 'ticket:123',
      authorityTimestamp: '2026-08-03T02:46:00.000Z'
    }),
    error => error?.code === 'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
  );
});
