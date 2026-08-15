'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLearningDeepTrainingContract } = require('../../backend/services/learningDeepTrainingContract');

test('projectPolicy reads only immutable eligible source signals and joins raw outcomes by decisionId', async () => {
  const repository = {
    async listLearningSignals(query) {
      assert.equal(query.learningEligible, true);
      return [{
        signal_id: 'signal-1',
        signal_type: 'candidate_sent',
        learning_eligible: true,
        scope_type: 'relationship',
        scope_id: 'person-1',
        signal: {
          decisionRecord: {
            decisionId: 'decision:abc',
            candidateStrategyBranch: 'natural_hook',
            featureBundle: { relationshipStage: 'warming' },
            policyVersion: 'vw-p1-v1',
            policyArtifactId: 'artifact-sha256:abc123'
          }
        }
      }];
    },
    async listPolicyOutcomeSignals({ decisionIds }) {
      assert.deepEqual(decisionIds, ['decision:abc']);
      return [{
        signal_id: 'raw-outcome-1',
        signal_type: 'policy_outcome_observed',
        learning_eligible: false,
        signal: {
          decisionId: 'decision:abc',
          outcomes: [{ outcomeId: 'outcome-1', type: 'reply_received', value: 1, evidenceRef: 'message-99' }]
        }
      }];
    }
  };
  const contract = createLearningDeepTrainingContract({ repository, dataPolicy: { minimize: async value => ({ allowed: true, text: value.text || '' }) } });
  const projection = await contract.projectPolicy({
    scopeType: 'relationship',
    scopeId: 'person-1',
    approvedScoresBySignalId: {
      'signal-1': {
        authority: 'Langfuse', approvedByLearning: true, scoreId: 'score-1', name: 'policy_reward', value: 1, traceId: 'trace-1',
        eligibleSourceSignalId: 'signal-1', decisionId: 'decision:abc', outcomeIds: ['outcome-1'], outcomeEvidenceSetRef: 'evidence-set-1', rewardPolicyVersion: 'reward-v1'
      }
    }
  });

  assert.equal(projection.authority, 'Learning');
  assert.equal(projection.readOnly, true);
  assert.equal(projection.trajectory.length, 1);
  assert.equal(projection.trajectory[0].decisionId, 'decision:abc');
  assert.equal(projection.trajectory[0].outcomes[0].outcomeId, 'outcome-1');
});

test('projectPolicy never upgrades raw outcome eligibility', async () => {
  const raw = { signal_id: 'raw-outcome-1', signal_type: 'policy_outcome_observed', learning_eligible: false, signal: { decisionId: 'decision:abc', outcomes: [] } };
  const repository = {
    async listLearningSignals() {
      return [{ signal_id: 'signal-1', signal_type: 'candidate_sent', learning_eligible: true, scope_type: 'relationship', scope_id: 'person-1', signal: { decisionRecord: { decisionId: 'decision:abc', candidateStrategyBranch: 'natural_hook', featureBundle: {}, policyVersion: 'vw-p1-v1', policyArtifactId: 'artifact-sha256:abc123' } } }];
    },
    async listPolicyOutcomeSignals() { return [raw]; }
  };
  const contract = createLearningDeepTrainingContract({ repository, dataPolicy: { minimize: async () => ({ allowed: true, text: '' }) } });
  await contract.projectPolicy({ scopeType: 'relationship', scopeId: 'person-1', approvedScoresBySignalId: { 'signal-1': { authority: 'Langfuse', approvedByLearning: true, scoreId: 'score-1', name: 'policy_reward', value: 1, traceId: 'trace-1', eligibleSourceSignalId: 'signal-1', decisionId: 'decision:abc', outcomeIds: [], outcomeEvidenceSetRef: 'evidence-set-1', rewardPolicyVersion: 'reward-v1' } } });
  assert.equal(raw.learning_eligible, false);
});
