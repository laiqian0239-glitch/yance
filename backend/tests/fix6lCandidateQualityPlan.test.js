'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/aiQualityRouteAuthority');
const executionMode = require('../services/aiExecutionModeAuthority');

function diagnosticConditionalModel(id = 'cloud-d9e82540c0683a44f8') {
  return {
    id,
    name: 'anthropic/claude-opus-5',
    provider: 'openrouter',
    available: true,
    userDisabled: false,
    qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastSuccessfulInvocation: { requestId: 'gen-onboarding-smoke' },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      status: 'REPLY_BRAIN_CONDITIONAL',
      completed: true,
      pass: false,
      score: 97,
      qualifyingTasks: [],
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'english_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 24, issues: [] },
        { id: 'director_schema', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'latency', pass: false, weight: 15, score: 13, issues: [] }
      ]
    }
  };
}

test('candidate-only quality plan accepts a selectable conditional primary without weakening persisted route policy', () => {
  const model = diagnosticConditionalModel();
  const plan = authority.routePlan({
    task: 'quick_reply',
    executionMode: executionMode.EXECUTION_MODE.CANDIDATE_ONLY,
    route: { primary: model.id, fallback: '', allowConditional: false, humanReviewRequired: false },
    models: [model]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.CONDITIONAL);
  assert.equal(plan.primaryConditional, true);
  assert.equal(plan.humanReviewRequired, true);
  assert.equal(plan.executionMode, 'candidate-only');
});

test('production quality plan rejects the same conditional route even when a stale route flag says allowConditional', () => {
  const model = diagnosticConditionalModel();
  const plan = authority.routePlan({
    task: 'quick_reply',
    executionMode: executionMode.EXECUTION_MODE.PRODUCTION,
    route: { primary: model.id, fallback: '', allowConditional: true, humanReviewRequired: true },
    models: [model]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.BLOCKED);
  assert.equal(plan.primaryConditional, false);
  assert.equal(plan.executionMode, 'production');
});

test('candidate route receipt cannot become delivery learning or formal qualification evidence', () => {
  const model = diagnosticConditionalModel();
  const plan = authority.routePlan({
    task: 'quick_reply',
    executionMode: 'candidate-only',
    route: { primary: model.id },
    models: [model]
  });
  const receipt = authority.routeReceipt({
    task: 'quick_reply',
    executionMode: 'candidate-only',
    selectedModel: model,
    routePlan: plan,
    attempts: [{ modelId: model.id, status: 'success' }]
  });
  assert.equal(receipt.executionMode, 'candidate-only');
  assert.equal(receipt.deliveryEligible, false);
  assert.equal(receipt.learningEligible, false);
  assert.equal(receipt.formalReceiptEligible, false);
  assert.equal(receipt.humanReviewRequired, true);
});
