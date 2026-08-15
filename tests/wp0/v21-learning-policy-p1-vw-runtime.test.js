'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const {
  ACTIVE_FLAG_KEY,
  createLearningPolicyRuntimeAdapter,
  resolveProductionActivePolicy
} = require('../../backend/services/learningPolicyRuntimeAdapter');

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

test('explicit active-policy resolver absence wins over injected runtime seam and returns baseline', async () => {
  let invoked = false;
  const adapter = createLearningPolicyRuntimeAdapter({
    resolveActivePolicy: async () => null,
    invokeVowpalWabbit: async () => {
      invoked = true;
      return { action: 'natural_hook', probability: 1, exploration: false };
    }
  });
  const decision = await adapter.selectLearnedPolicyAction({
    featureBundle: { relationshipStage: 'warming', interactionBand: 'balanced' },
    allowedActions: ['natural_hook', 'playful_attraction'],
    baselineAction: 'natural_hook'
  });

  assert.equal(invoked, false);
  assert.equal(decision.executedPolicy, 'baseline');
  assert.equal(decision.policyArtifactId, 'baseline');
  assert.equal(decision.degradation, null);
});

test('production Learning runtime falls back to verified canonical history and preserves active-artifact degradation', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-learning-policy-lkg-'));
  const learnedRoot = path.join(dataRoot, 'learning', 'learned-policy');
  const flagRoot = path.join(learnedRoot, 'flagd');
  const artifactRoot = path.join(learnedRoot, 'artifacts');
  fs.mkdirSync(flagRoot, { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });

  const goodBytes = Buffer.from('verified-learning-policy-lkg\n', 'utf8');
  const goodVersion = crypto.createHash('sha256').update(goodBytes).digest('hex');
  const brokenVersion = 'f'.repeat(64);
  fs.writeFileSync(path.join(artifactRoot, `${goodVersion}.vw`), goodBytes);
  fs.writeFileSync(path.join(flagRoot, 'flags.json'), `${JSON.stringify({
    flags: {
      [ACTIVE_FLAG_KEY]: {
        state: 'ENABLED',
        variants: {
          active: {
            kind: 'LEARNING_ROLLOUT',
            candidate: { id: `policy:${brokenVersion}`, version: brokenVersion, policyVersion: 'vw-p1-v1' },
            history: [{ id: `policy:${goodVersion}`, version: goodVersion, policyVersion: 'vw-p1-v1' }]
          }
        },
        defaultVariant: 'active'
      }
    }
  }, null, 2)}\n`, 'utf8');

  const previousDataRoot = process.env.YANCE_DATA_DIR;
  process.env.YANCE_DATA_DIR = dataRoot;
  const degradations = [];
  try {
    const adapter = createLearningPolicyRuntimeAdapter({
      resolveActivePolicy: resolveProductionActivePolicy,
      invokeVowpalWabbit: async input => ({
        action: 'natural_hook',
        policyVersion: input.policyVersion,
        policyArtifactId: input.policyArtifactId,
        probability: 1,
        exploration: false
      }),
      onDegradation: evidence => degradations.push(evidence)
    });
    const decision = await adapter.selectLearnedPolicyAction({
      featureBundle: { relationshipStage: 'warming', interactionBand: 'balanced' },
      allowedActions: ['natural_hook', 'playful_attraction']
    });

    assert.equal(decision.executedPolicy, 'vowpalwabbit');
    assert.equal(decision.policyArtifactId, goodVersion);
    assert.equal(decision.degradation?.reasonCode, 'LEARNING_POLICY_ARTIFACT_MISSING');
    assert.equal(degradations.some(row => row.reasonCode === 'LEARNING_POLICY_ARTIFACT_MISSING'), true);
  } finally {
    const { OpenFeature, NOOP_PROVIDER } = require('@openfeature/server-sdk');
    await OpenFeature.setProviderAndWait('yance-learning-policy', NOOP_PROVIDER);
    if (previousDataRoot === undefined) delete process.env.YANCE_DATA_DIR;
    else process.env.YANCE_DATA_DIR = previousDataRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('sealed Learning Python entrypoint exposes the VW policy action mode without provider credentials or local text generation', () => {
  const source = read('runtime/learning-growth/python/learning_entrypoint.py');
  assert.match(source, /vowpalwabbit/i);
  assert.match(source, /learned[_-]policy/i);
  assert.doesNotMatch(source, /(OPENAI_API_KEY|ANTHROPIC_API_KEY|provider[_-]?credential)/i);
  assert.doesNotMatch(source, /(generate[_-]?reply|final[_-]?reply)/i);
});
