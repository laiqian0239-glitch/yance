'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function loadAdapter() {
  return require(path.join(ROOT, 'backend/services/agentLightningTrainingAdapter.js'));
}

function projection(value = 0.75) {
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
        content: 'minimized training text',
        score: Object.freeze({
          authority: 'Langfuse',
          approvedByLearning: true,
          scoreId: 'score-1',
          name: 'quality',
          traceId: 'trace-1',
          value
        })
      })
    ])
  });
}

test('thin adapter obtains Learning projection, delegates completion to Model Brain, binds evidence, and returns candidate-only output', async () => {
  const { createAgentLightningTrainingAdapter } = loadAdapter();
  assert.equal(typeof createAgentLightningTrainingAdapter, 'function');

  const calls = [];
  const issuedProjection = projection();
  const learningContract = {
    async projectRelationship(input) {
      calls.push(['projectRelationship', input]);
      return issuedProjection;
    },
    async bindExperimentEvidence(input) {
      calls.push(['bindExperimentEvidence', input]);
      return { datasetItemId: 'dataset-item-1', scoreId: 'score-1' };
    }
  };
  const modelExecutor = {
    async executeModel(model, messages, options) {
      calls.push(['executeModel', model, messages, options]);
      return { text: 'model-brain-completion', evidence: { selectedModel: 'model-1' } };
    }
  };
  let runtimeInput = null;
  const runtimeInvoker = async input => {
    runtimeInput = input;
    const completion = await input.complete({
      messages: [{ role: 'user', content: 'critique prompt' }],
      options: { temperature: 0 }
    });
    assert.equal(completion.text, 'model-brain-completion');
    return {
      status: 'CANDIDATE_ONLY',
      candidate: { prompt: 'improved prompt', artifactId: 'artifact-1' },
      evidence: { runId: 'run-1' }
    };
  };

  const adapter = createAgentLightningTrainingAdapter({ learningContract, modelExecutor, runtimeInvoker });
  const result = await adapter.trainRelationship({
    learningInput: { scopeType: 'relationship', scopeId: 'relationship-1' },
    model: { id: 'model-1', credentialRef: 'credential-ref-1' },
    datasetName: 'agent-lightning-p1',
    signalId: 'signal-1'
  });

  assert.equal(runtimeInput.projection, issuedProjection);
  assert.equal(runtimeInput.rewards[0].value, 0.75);
  assert.equal(runtimeInput.rewards[0].signalId, 'signal-1');
  assert.equal(result.status, 'CANDIDATE_ONLY');
  assert.deepEqual(result.candidate, { prompt: 'improved prompt', artifactId: 'artifact-1' });
  assert.ok(calls.some(([name]) => name === 'projectRelationship'));
  assert.ok(calls.some(([name]) => name === 'executeModel'));
  assert.ok(calls.some(([name]) => name === 'bindExperimentEvidence'));
});
