'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/modelRegistry');
const { AiGateway } = require('../services/aiGateway');

function verifiedModel(id, task, extra = {}) {
  return {
    id,
    name: id,
    provider: 'openrouter',
    qualification: 'verified',
    available: true,
    userDisabled: false,
    allowedTasks: [task],
    ...extra
  };
}

function gatewayFor(t, document) {
  t.mock.method(registry, 'read', () => document);
  return new AiGateway();
}

test('AiGateway blocks a legacy-eligible translation model that lacks translation quality qualification', t => {
  const model = verifiedModel('translation-conditional', 'translation');
  const gateway = gatewayFor(t, {
    models: [model],
    routes: { translation: { enabled: true, primary: model.id, allowConditional: false } }
  });

  const route = gateway.resolveRoute('translation');
  assert.equal(route.qualityPlan.primaryPass, false);
  assert.equal(route.qualityPlan.primaryConditional, false);
  assert.equal(route.primary, null);
  assert.equal(route.qualityPlan.state, 'blocked');
});

test('AiGateway permits an explicitly visible conditional translation route only when configured for human review', t => {
  const model = verifiedModel('translation-conditional', 'translation');
  const gateway = gatewayFor(t, {
    models: [model],
    routes: {
      translation: {
        enabled: true,
        primary: model.id,
        allowConditional: true,
        humanReviewRequired: true
      }
    }
  });

  const route = gateway.resolveRoute('translation');
  assert.equal(route.qualityPlan.primaryConditional, true);
  assert.equal(route.primary.id, model.id);
  assert.equal(route.conditional, true);
  assert.equal(route.humanReviewRequired, true);
});

test('AiGateway blocks fact extraction when JSON schema capability is missing', t => {
  const model = verifiedModel('fact-no-json', 'fact_extraction');
  const gateway = gatewayFor(t, {
    models: [model],
    routes: { fact_extraction: { enabled: true, primary: model.id } }
  });

  const route = gateway.resolveRoute('fact_extraction');
  assert.equal(route.qualityPlan.primary.qualityTier, 'qualified');
  assert.deepEqual(route.qualityPlan.primary.capabilityCoverage.missing, ['json_schema_strict']);
  assert.equal(route.primary, null);
});

test('AiGateway executes a commercially qualified translation model through the quality gate', t => {
  const model = verifiedModel('translation-qualified', 'translation', {
    lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'] }
  });
  const gateway = gatewayFor(t, {
    models: [model],
    routes: { translation: { enabled: true, primary: model.id } }
  });

  const route = gateway.resolveRoute('translation');
  assert.equal(route.qualityPlan.primaryPass, true);
  assert.equal(route.primary.id, model.id);
});
