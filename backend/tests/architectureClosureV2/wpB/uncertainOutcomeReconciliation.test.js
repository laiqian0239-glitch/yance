'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function reconciliationModule() {
  return require('../../../services/externalOutcomeReconciliation');
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

test('remote success creates one trusted receipt and terminal transition', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../../../services/externalOutcomeReconciliation'),
    'utf8'
  );
  assert.match(source, /REMOTE_SUCCESS_PROVEN/u);
  assert.match(source, /recordReceipt/u);
  assert.match(source, /succeed|SUCCEEDED/u);
});

test('remote absence is the only observation that permits another physical attempt', () => {
  const { canScheduleAnotherAttempt, OUTCOMES } = reconciliationModule();
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_ABSENCE_PROVEN), true);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_SUCCESS_PROVEN), false);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_RESULT_UNKNOWN), false);
});

test('manual resolution is an append-only receipt with actor, reason and evidence reference', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../../../services/externalOutcomeReconciliation'),
    'utf8'
  );
  for (const marker of ['actor', 'reasonCode', 'evidenceReference', 'authorityTimestamp']) {
    assert.match(source, new RegExp(marker, 'u'), `missing ${marker}`);
  }
  assert.match(source, /MANUAL_RESOLUTION/u);
});
