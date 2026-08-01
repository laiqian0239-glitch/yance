'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../services/aiBudgetAuthority');

const document = {
  aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
  aiBudgetUsage: { spentUsd: 11, periodStartedAt: '2026-07-01T00:00:00.000Z' }
};

test('protects reserved budget from paid background tasks', () => {
  const decision = budget.decide(document, { task: 'relationship', modelCostClass: 'paid-cloud' });
  assert.equal(decision.pass, false);
  assert.equal(decision.reasonCode, 'AI_BACKGROUND_PAID_BUDGET_PROTECTED');
  assert.equal(decision.remainingUsd, 4);
});

test('formal champion reply remains admitted inside the reserve', () => {
  const decision = budget.decide(document, { task: 'quick_reply', modelCostClass: 'paid-cloud' });
  assert.equal(decision.pass, true);
  assert.equal(decision.reasonCode, 'AI_CHAMPION_RESERVE_ALLOWED');
});

test('local and free models never consume paid admission', () => {
  assert.equal(budget.decide(document, { task: 'relationship', modelCostClass: 'local' }).pass, true);
  assert.equal(budget.decide(document, { task: 'translation', modelCostClass: 'free-cloud' }).pass, true);
});

test('invalid budget state fails closed only for paid background work', () => {
  const decision = budget.decide({ aiBudgetPolicy: {}, aiBudgetUsage: { spentUsd: 'invalid' } }, { task: 'summary', modelCostClass: 'paid-cloud' });
  assert.equal(decision.pass, false);
  assert.equal(decision.reasonCode, 'AI_BUDGET_STATE_INVALID');
});

test('outbound final translation may use the quality reserve while background translation may not', () => {
  const outbound = budget.decide(document, { task: 'translation', translationProfile: 'outbound', background: false, modelCostClass: 'paid-cloud' });
  const history = budget.decide(document, { task: 'translation', translationProfile: 'history', background: true, modelCostClass: 'paid-cloud' });
  assert.equal(outbound.pass, true);
  assert.equal(outbound.reasonCode, 'AI_QUALITY_RESERVE_ALLOWED');
  assert.equal(history.pass, false);
  assert.equal(history.reasonCode, 'AI_BACKGROUND_PAID_BUDGET_PROTECTED');
});
