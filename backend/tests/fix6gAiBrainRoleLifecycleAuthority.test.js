'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const lifecycle = require('../services/aiBrainRoleLifecycleAuthority');

const NOW = '2026-08-01T00:00:00.000Z';

function replyEvidence(score = 94) {
  return {
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_QUALIFIED',
    completed: true,
    pass: true,
    score,
    testedAt: '2026-07-31T12:00:00.000Z',
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
    scenarios: []
  };
}

function connectedModel(id = 'model-a', overrides = {}) {
  return {
    id,
    name: id,
    provider: 'openrouter',
    available: true,
    qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastSuccessfulInvocation: { at: '2026-07-31T12:00:00.000Z' },
    ...overrides
  };
}

function qualifiedModel(id = 'model-a', score = 94, overrides = {}) {
  const evidence = replyEvidence(score);
  const model = connectedModel(id, {
    lastReplyBrainBenchmark: evidence,
    roleQualificationReceipts: {},
    ...overrides
  });
  model.roleQualificationReceipts.quick_reply = roleReceipts.issueFromEvidence({
    modelId: id,
    task: 'quick_reply',
    evidence,
    issuedAt: evidence.testedAt,
    expiresAt: '2027-07-31T12:00:00.000Z'
  });
  return model;
}

test('catalog record without real execution remains CATALOG_ONLY', () => {
  const result = lifecycle.deriveModelTaskLifecycle({ id: 'catalog', name: 'catalog', provider: 'openrouter', available: true }, 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.CATALOG_ONLY);
  assert.equal(result.routable, false);
});

test('real invocation without task evidence becomes CONNECTIVITY_VERIFIED', () => {
  const result = lifecycle.deriveModelTaskLifecycle(connectedModel('connected', { allowedTasks: [] }), 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.CONNECTIVITY_VERIFIED);
  assert.equal(result.selectable, false);
});

test('conditional task eligibility becomes TASK_CHALLENGER', () => {
  const model = connectedModel('challenger', {
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_FAILED', completed: true, pass: false,
      score: 82, testedAt: '2026-07-31T12:00:00.000Z', qualifyingTasks: [], scenarios: []
    }
  });
  const result = lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.TASK_CHALLENGER);
  assert.equal(result.selectable, true);
  assert.equal(result.formal, false);
});

test('passed task benchmark without a receipt becomes TASK_BENCHMARK_PASSED', () => {
  const model = connectedModel('benchmark', { lastReplyBrainBenchmark: replyEvidence(93) });
  const result = lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.TASK_BENCHMARK_PASSED);
  assert.equal(result.formal, false);
});

test('valid task receipt becomes ROLE_QUALIFIED', () => {
  const result = lifecycle.deriveModelTaskLifecycle(qualifiedModel('qualified'), 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.ROLE_QUALIFIED);
  assert.equal(result.formal, true);
  assert.equal(result.routable, true);
});

test('context projects qualified models into champion and runner-up roles', () => {
  const champion = qualifiedModel('champion', 98);
  const runner = qualifiedModel('runner', 94);
  assert.equal(lifecycle.deriveModelTaskLifecycle(champion, 'quick_reply', { now: NOW, championModelId: 'champion' }).state, lifecycle.STATES.TASK_CHAMPION);
  assert.equal(lifecycle.deriveModelTaskLifecycle(runner, 'quick_reply', { now: NOW, runnerUpModelId: 'runner' }).state, lifecycle.STATES.TASK_RUNNER_UP);
});

test('shadow and active states are task-scoped and require formal qualification', () => {
  const model = qualifiedModel('active', 96);
  assert.equal(lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW, shadowValidatedModelIds: ['active'] }).state, lifecycle.STATES.SHADOW_VALIDATED);
  assert.equal(lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW, activeModelIds: ['active'] }).state, lifecycle.STATES.ACTIVE);
});

test('runtime failure degrades a previously qualified model', () => {
  const model = qualifiedModel('degraded', 96, { lastInvocationStatus: 'failed', lastError: 'provider unavailable' });
  const result = lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW, activeModelIds: ['degraded'] });
  assert.equal(result.state, lifecycle.STATES.DEGRADED);
  assert.equal(result.routable, false);
  assert.equal(result.reasonCode, 'MODEL_RUNTIME_DEGRADED');
});

test('explicit disable or revocation is terminal REVOKED', () => {
  const model = qualifiedModel('revoked', 96, { userDisabled: true });
  const result = lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW });
  assert.equal(result.state, lifecycle.STATES.REVOKED);
  assert.equal(result.selectable, false);
});

test('mutable latest aliases cannot obtain formal task roles', () => {
  const model = qualifiedModel('alias', 99, { name: 'openai/gpt-latest' });
  const result = lifecycle.deriveModelTaskLifecycle(model, 'quick_reply', { now: NOW, championModelId: 'alias' });
  assert.equal(result.state, lifecycle.STATES.TASK_CHALLENGER);
  assert.equal(result.formal, false);
  assert.equal(result.reasonCode, 'MUTABLE_MODEL_ALIAS_NOT_FORMALLY_QUALIFIABLE');
});
