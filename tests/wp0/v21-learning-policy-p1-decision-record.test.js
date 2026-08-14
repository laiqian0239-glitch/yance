'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLearningPolicyDecisionContract } = require('../../backend/services/learningPolicyDecisionContract');

test('Learned Policy DecisionRecord binds canonical identity, persona, features, action and generation provenance', () => {
  const authorityCalls = [];
  const contract = createLearningPolicyDecisionContract({
    personContextAuthority: {
      resolve(input) {
        authorityCalls.push(input);
        return {
          authority: 'PersonContextAuthority',
          found: true,
          personId: 'person-1',
          contactIds: ['contact-1'],
          conversationIds: ['conversation-1']
        };
      }
    }
  });

  const record = contract.createDecisionRecord({
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    personaProfileId: 'persona-owner-v7',
    featureBundle: {
      relationshipStage: 'warming',
      interactionBand: 'balanced',
      targetLanguage: 'en'
    },
    candidateStrategyBranch: 'screen_and_advance',
    policyVersion: 'vw-p1-v1',
    policyArtifactId: 'artifact-sha256:abc123',
    generation: {
      modelBrainExecutionId: 'exec-1',
      candidatePlanId: 'plan-1'
    }
  });

  assert.equal(authorityCalls.length, 1);
  assert.equal(record.personId, 'person-1');
  assert.deepEqual(record.contactIds, ['contact-1']);
  assert.deepEqual(record.conversationIds, ['conversation-1']);
  assert.equal(record.personaProfileId, 'persona-owner-v7');
  assert.equal(record.candidateStrategyBranch, 'screen_and_advance');
  assert.equal(record.actionProbability, 1);
  assert.equal(record.exploration, false);
  assert.equal(record.policyVersion, 'vw-p1-v1');
  assert.equal(record.policyArtifactId, 'artifact-sha256:abc123');
  assert.match(record.decisionId, /^decision:/);
  assert.equal(Object.isFrozen(record), true);
});

test('DecisionRecord fails closed on identity/persona ambiguity and rejects raw chat bodies in features', () => {
  const ambiguous = createLearningPolicyDecisionContract({
    personContextAuthority: {
      resolve() {
        return { authority: 'PersonContextAuthority', found: true, personId: 'person-1', contactIds: ['contact-1'], conversationIds: ['conversation-2'] };
      }
    }
  });

  assert.throws(() => ambiguous.createDecisionRecord({
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    personaProfileId: 'persona-owner-v7',
    featureBundle: { relationshipStage: 'warming' },
    candidateStrategyBranch: 'natural_hook',
    policyVersion: 'vw-p1-v1',
    policyArtifactId: 'artifact-sha256:abc123',
    generation: { modelBrainExecutionId: 'exec-1' }
  }), error => error?.reasonCode === 'LEARNING_POLICY_IDENTITY_BINDING_MISMATCH');

  const valid = createLearningPolicyDecisionContract({
    personContextAuthority: {
      resolve() {
        return { authority: 'PersonContextAuthority', found: true, personId: 'person-1', contactIds: ['contact-1'], conversationIds: ['conversation-1'] };
      }
    }
  });
  assert.throws(() => valid.createDecisionRecord({
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    personaProfileId: 'persona-owner-v7',
    featureBundle: { rawChatBody: 'private text' },
    candidateStrategyBranch: 'natural_hook',
    policyVersion: 'vw-p1-v1',
    policyArtifactId: 'artifact-sha256:abc123',
    generation: { modelBrainExecutionId: 'exec-1' }
  }), error => error?.reasonCode === 'LEARNING_POLICY_FEATURE_BUNDLE_PRIVATE_BODY_FORBIDDEN');
});
