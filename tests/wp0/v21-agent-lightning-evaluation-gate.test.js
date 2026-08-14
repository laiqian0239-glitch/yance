'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function loadAdapter() {
  return require(path.join(ROOT, 'backend/services/agentLightningTrainingAdapter.js'));
}

function makeProjection(value, overrides = {}) {
  return Object.freeze({
    authority: 'Learning',
    readOnly: true,
    scopeType: 'relationship',
    scopeId: 'relationship-1',
    learningLevel: 'L1',
    trajectory: Object.freeze([
      Object.freeze({
        signalId: 'signal-1',
        scopeType: 'relationship',
        scopeId: 'relationship-1',
        score: Object.freeze({
          authority: 'Langfuse',
          approvedByLearning: true,
          scoreId: 'score-1',
          name: 'quality',
          traceId: 'trace-1',
          value,
          ...overrides
        })
      })
    ])
  });
}

function makeAdapter(projection, runtimeInvoker) {
  const { createAgentLightningTrainingAdapter } = loadAdapter();
  return createAgentLightningTrainingAdapter({
    learningContract: {
      async projectRelationship() { return projection; },
      async bindExperimentEvidence() { return { bound: true }; }
    },
    modelExecutor: { async executeModel() { return { text: 'ok' }; } },
    runtimeInvoker
  });
}

test('string, categorical, non-finite, non-Langfuse, or non-Learning-approved scores fail closed before Agent Lightning runs', async () => {
  for (const invalid of [
    makeProjection('0.8'),
    makeProjection('good'),
    makeProjection(Number.NaN),
    makeProjection(Number.POSITIVE_INFINITY),
    makeProjection(0.8, { authority: 'Other' }),
    makeProjection(0.8, { approvedByLearning: false })
  ]) {
    let runtimeCalled = false;
    const adapter = makeAdapter(invalid, async () => {
      runtimeCalled = true;
      return { status: 'CANDIDATE_ONLY', candidate: {} };
    });
    await assert.rejects(
      adapter.trainRelationship({
        learningInput: { scopeType: 'relationship', scopeId: 'relationship-1' },
        model: { id: 'model-1' },
        datasetName: 'agent-lightning-p1',
        signalId: 'signal-1'
      }),
      error => error && error.reasonCode === 'AGENT_LIGHTNING_NUMERIC_REWARD_REQUIRED'
    );
    assert.equal(runtimeCalled, false);
  }
});

test('finite numeric Learning-approved Langfuse score crosses unchanged as reward', async () => {
  let capturedRewards = null;
  const adapter = makeAdapter(makeProjection(-0.25), async input => {
    capturedRewards = input.rewards;
    return { status: 'CANDIDATE_ONLY', candidate: { prompt: 'candidate' }, evidence: {} };
  });
  await adapter.trainRelationship({
    learningInput: { scopeType: 'relationship', scopeId: 'relationship-1' },
    model: { id: 'model-1' },
    datasetName: 'agent-lightning-p1',
    signalId: 'signal-1'
  });
  assert.equal(capturedRewards.length, 1);
  assert.equal(capturedRewards[0].value, -0.25);
});
