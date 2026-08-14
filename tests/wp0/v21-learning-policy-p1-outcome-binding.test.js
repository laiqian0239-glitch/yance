'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLearningOutcomeAttributionService } = require('../../backend/services/learningOutcomeAttributionService');

test('raw OutcomeVector is immutable, decision-bound and permanently non-trainable', () => {
  const service = createLearningOutcomeAttributionService();
  const vector = service.createOutcomeVector({
    decisionId: 'decision:abc',
    outcomes: [
      { outcomeId: 'outcome-1', type: 'reply_received', value: 1, evidenceRef: 'message-99' },
      { outcomeId: 'outcome-2', type: 'conversation_continued', value: 1, evidenceRef: 'conversation-1' }
    ],
    observedAt: '2026-08-14T11:00:00.000Z'
  });

  assert.equal(vector.signalType, 'policy_outcome_observed');
  assert.equal(vector.learningEligible, false);
  assert.equal(vector.decisionId, 'decision:abc');
  assert.equal(Object.isFrozen(vector), true);
  assert.equal(Object.isFrozen(vector.outcomes), true);
});

test('trainable binding requires the immutable eligible candidate_sent anchor and Learning-approved Langfuse Score', () => {
  const service = createLearningOutcomeAttributionService();
  const vector = service.createOutcomeVector({
    decisionId: 'decision:abc',
    outcomes: [{ outcomeId: 'outcome-1', type: 'reply_received', value: 1, evidenceRef: 'message-99' }],
    observedAt: '2026-08-14T11:00:00.000Z'
  });
  const source = {
    signal_id: 'signal-1',
    signal_type: 'candidate_sent',
    learning_eligible: true,
    signal: { decisionRecord: { decisionId: 'decision:abc' } }
  };
  const score = {
    authority: 'Langfuse',
    approvedByLearning: true,
    scoreId: 'score-1',
    eligibleSourceSignalId: 'signal-1',
    decisionId: 'decision:abc',
    outcomeIds: ['outcome-1'],
    outcomeEvidenceSetRef: 'evidence-set-1',
    rewardPolicyVersion: 'reward-v1',
    value: 1
  };

  const bound = service.bindTrainableOutcome({ eligibleSourceSignal: source, outcomeVector: vector, score });
  assert.equal(bound.eligibleSourceSignalId, 'signal-1');
  assert.equal(bound.decisionId, 'decision:abc');
  assert.equal(bound.reward.authority, 'Langfuse');
  assert.equal(vector.learningEligible, false, 'binding may never upgrade the raw outcome row');

  assert.throws(() => service.bindTrainableOutcome({
    eligibleSourceSignal: { ...source, learning_eligible: false },
    outcomeVector: vector,
    score
  }), error => error?.reasonCode === 'LEARNING_POLICY_ELIGIBLE_SOURCE_SIGNAL_REQUIRED');
});
