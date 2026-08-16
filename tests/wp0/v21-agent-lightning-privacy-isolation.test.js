'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function loadFactory() {
  return require(path.join(ROOT, 'backend/services/agentLightningTrainingAdapter.js')).createAgentLightningTrainingAdapter;
}

function adapterFor(projection) {
  const createAgentLightningTrainingAdapter = loadFactory();
  return createAgentLightningTrainingAdapter({
    learningContract: {
      async projectRelationship() { return projection; },
      async projectGlobal() { return projection; },
      async bindExperimentEvidence() { return { bound: true }; }
    },
    modelExecutor: { async executeModel() { return { text: 'ok' }; } },
    runtimeInvoker: async () => ({ status: 'CANDIDATE_ONLY', candidate: { prompt: 'candidate' }, evidence: {} })
  });
}

function validRelationshipProjection(overrides = {}) {
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
        score: Object.freeze({ authority: 'Langfuse', approvedByLearning: true, value: 1 })
      })
    ]),
    ...overrides
  });
}

test('adapter rejects projections that are not Learning-issued read-only L1 authority', async () => {
  for (const projection of [
    validRelationshipProjection({ authority: 'DeepTraining' }),
    validRelationshipProjection({ readOnly: false }),
    validRelationshipProjection({ learningLevel: 'L2' })
  ]) {
    await assert.rejects(
      adapterFor(projection).trainRelationship({
        learningInput: { scopeType: 'relationship', scopeId: 'relationship-1' },
        model: { id: 'model-1' },
        datasetName: 'agent-lightning-p1',
        signalId: 'signal-1'
      }),
      error => error && error.reasonCode === 'AGENT_LIGHTNING_LEARNING_PROJECTION_REQUIRED'
    );
  }
});

test('adapter rejects mixed relationship scope and requires explicit Learning global eligibility projection', async () => {
  const mixed = validRelationshipProjection({
    trajectory: Object.freeze([
      Object.freeze({ signalId: 'signal-1', scopeType: 'relationship', scopeId: 'relationship-2', score: Object.freeze({ authority: 'Langfuse', approvedByLearning: true, value: 1 }) })
    ])
  });
  await assert.rejects(
    adapterFor(mixed).trainRelationship({
      learningInput: { scopeType: 'relationship', scopeId: 'relationship-1' },
      model: { id: 'model-1' }, datasetName: 'agent-lightning-p1', signalId: 'signal-1'
    }),
    error => error && error.reasonCode === 'AGENT_LIGHTNING_SCOPE_MISMATCH'
  );

  const fakeGlobal = validRelationshipProjection({ scopeType: 'global', scopeId: 'global-1' });
  await assert.rejects(
    adapterFor(fakeGlobal).trainGlobal({
      learningInput: { scopeType: 'global', scopeId: 'global-1' },
      model: { id: 'model-1' }, datasetName: 'agent-lightning-p1', signalId: 'signal-1'
    }),
    error => error && error.reasonCode === 'AGENT_LIGHTNING_GLOBAL_ELIGIBILITY_REQUIRED'
  );
});
