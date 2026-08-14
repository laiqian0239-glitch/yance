'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { createLearningPolicyRuntimeAdapter } = require('../../backend/services/learningPolicyRuntimeAdapter');

test('Learning runtime adapter delegates the action head to sealed Vowpal Wabbit and keeps P1 deterministic', async () => {
  const calls = [];
  const adapter = createLearningPolicyRuntimeAdapter({
    invokeVowpalWabbit: async input => {
      calls.push(input);
      return { action: 'playful_attraction', policyVersion: 'vw-p1-v1', policyArtifactId: 'artifact-sha256:abc123' };
    }
  });
  const decision = await adapter.selectLearnedPolicyAction({
    featureBundle: { relationshipStage: 'warming', interactionBand: 'balanced' },
    allowedActions: ['natural_hook', 'playful_attraction', 'direct_advance', 'screen_and_advance', 'leave_aftertaste']
  });

  assert.equal(calls.length, 1);
  assert.equal(decision.candidateStrategyBranch, 'playful_attraction');
  assert.equal(decision.actionProbability, 1);
  assert.equal(decision.exploration, false);
  assert.equal(decision.providerRoutingAuthority, undefined);
  assert.equal(decision.finalReply, undefined);
});

test('sealed Learning Python entrypoint exposes the VW policy action mode without provider credentials or local text generation', () => {
  const source = read('runtime/learning-growth/python/learning_entrypoint.py');
  assert.match(source, /vowpalwabbit/i);
  assert.match(source, /learned[_-]policy/i);
  assert.doesNotMatch(source, /(OPENAI_API_KEY|ANTHROPIC_API_KEY|provider[_-]?credential)/i);
  assert.doesNotMatch(source, /(generate[_-]?reply|final[_-]?reply)/i);
});
