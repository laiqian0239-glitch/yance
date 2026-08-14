'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLangfuseLearningEvidenceAdapter } = require('../services/langfuseLearningEvidenceAdapter');
const { createLearningPromotionAdapter } = require('../services/learningPromotionAdapter');

function loadContractFactory() {
  let contractModule;
  try {
    contractModule = require('../services/learningDeepTrainingContract');
  } catch (error) {
    assert.fail(`Stable Learning→Deep Training contract is missing: ${error.message}`);
  }
  assert.equal(typeof contractModule.createLearningDeepTrainingContract, 'function');
  return contractModule.createLearningDeepTrainingContract;
}

function assertReasonCode(code) {
  return error => Boolean(error && error.reasonCode === code);
}

test('Learning→Deep Training exposes a stable contract factory', () => {
  assert.equal(typeof loadContractFactory(), 'function');
});

test('Langfuse training evidence uses synchronous official Dataset and Score APIs', async () => {
  const calls = [];
  const client = {
    api: {
      datasets: {
        async create(input) {
          calls.push(['api.datasets.create', input]);
          return { id: 'dataset-1', name: input.name };
        }
      },
      scores: {
        async create(input) {
          calls.push(['api.scores.create', input]);
          return { id: 'remote-score-1' };
        }
      }
    },
    dataset: {
      async createItem(input) {
        calls.push(['dataset.createItem', input]);
        return { id: input.id };
      }
    }
  };

  const adapter = createLangfuseLearningEvidenceAdapter({ client, enabled: true });
  assert.equal(typeof adapter.bindTrainingEvidence, 'function');

  const receipt = await adapter.bindTrainingEvidence({
    datasetName: 'learning-deep-training-v3',
    record: {
      signalId: 'learning-signal-001',
      content: '<EMAIL_ADDRESS>',
      outcome: { status: 'sent', success: null, negativeEvidence: false },
      score: {
        scoreId: 'learning-score-001',
        authority: 'Langfuse',
        approvedByLearning: true,
        name: 'learning-quality',
        value: 0.91,
        traceId: 'trace-learning-001'
      }
    }
  });

  assert.equal(receipt.authority, 'Langfuse Dataset + Score');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['api.datasets.create', 'dataset.createItem', 'api.scores.create']
  );
});

test('Learning rollback rejects wrong rollout identity and missing candidate before evidence persistence', async () => {
  const rollbackEvidence = [];
  const adapter = createLearningPromotionAdapter({
    openFeature: { setEvaluationContext() {} },
    flagd: { mode: 'in-process-offline' },
    langfuse: {
      async recordRollback(input) {
        rollbackEvidence.push(input);
      }
    }
  });

  assert.equal(typeof adapter.rollback, 'function');

  await assert.rejects(
    adapter.rollback(
      { kind: 'OTHER_ROLLOUT', candidate: { id: 'candidate-1' } },
      { approved: true, evidence: { id: 'rollback-evidence-1' } }
    ),
    assertReasonCode('LEARNING_ROLLBACK_ROLLOUT_REQUIRED')
  );

  await assert.rejects(
    adapter.rollback(
      { kind: 'LEARNING_ROLLOUT' },
      { approved: true, evidence: { id: 'rollback-evidence-1' } }
    ),
    assertReasonCode('LEARNING_ROLLBACK_CANDIDATE_REQUIRED')
  );

  assert.equal(rollbackEvidence.length, 0);

  const receipt = await adapter.rollback(
    { kind: 'LEARNING_ROLLOUT', candidate: { id: 'candidate-1' } },
    { approved: true, evidence: { id: 'rollback-evidence-1' } }
  );

  assert.equal(receipt.kind, 'LEARNING_ROLLBACK');
  assert.equal(receipt.automaticPromotion, false);
  assert.equal(rollbackEvidence.length, 1);
});
