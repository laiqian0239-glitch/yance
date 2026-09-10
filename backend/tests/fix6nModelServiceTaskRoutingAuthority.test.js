'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiGateway } = require('../services/aiGateway');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const { normalizeModelError } = require('../services/modelErrorNormalizer');
const routingAuthority = require('../services/modelServiceTaskRoutingAuthority');

const NOW = '2026-08-01T00:00:00.000Z';

function replyModel(id, modelSlug, score = 98) {
  const testedAt = '2026-07-31T12:00:00.000Z';
  const evidence = {
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_QUALIFIED',
    testedAt,
    completed: true,
    pass: true,
    score,
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
    scenarios: [
      { id: 'german_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
      { id: 'english_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
      { id: 'persona_boundary', pass: true, weight: 25, score: 25, issues: [] },
      { id: 'director_schema', pass: true, weight: 20, score: 20, issues: [] },
      { id: 'latency', pass: true, weight: 15, score: 15, issues: [] }
    ]
  };
  const model = {
    id,
    name: modelSlug,
    modelSlug,
    provider: 'openrouter',
    qualification: 'verified',
    available: true,
    userDisabled: false,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: evidence,
    lastSuccessAt: testedAt,
    roleQualificationReceipts: {}
  };
  for (const task of ['quick_reply', 'deep_reply', 'director']) {
    model.roleQualificationReceipts[task] = roleReceipts.issueFromEvidence({
      modelId: id,
      task,
      evidence,
      issuedAt: testedAt,
      expiresAt: '2027-07-31T12:00:00.000Z'
    });
  }
  return model;
}

function translationCandidate(id, modelSlug) {
  return {
    id,
    name: modelSlug,
    modelSlug,
    provider: 'openrouter',
    qualification: 'experimental',
    onboardingSmokeStatus: 'passed',
    openRouterOnboardingSmoke: { pass: true },
    available: true,
    userDisabled: false,
    allowedTasks: ['translation'],
    catalogMetadata: { taskEligibility: { translation: true } }
  };
}

function fakeRegistry(models, routes) {
  return {
    read: () => ({ models, routes, aiBudgetPolicy: { totalBudgetUsd: 100, championReserveUsd: 0, backgroundPaidEnabled: true }, aiBudgetUsage: { spentUsd: 0 } }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
}

function productionRoute(primary, fallback) {
  return {
    quick_reply: {
      enabled: true,
      primary: primary.id,
      fallback: fallback?.id || '',
      primarySelection: 'manual',
      fallbackSelection: fallback ? 'manual' : 'auto',
      timeoutMs: 180000
    }
  };
}

test('candidate-only translation accepts onboarding-smoke candidates while production still requires a formal receipt', () => {
  const primary = translationCandidate('translate-a', 'anthropic/claude-sonnet');
  const fallback = translationCandidate('translate-b', 'openai/gpt-5-mini');
  const routes = {
    translation: {
      enabled: true,
      primary: primary.id,
      fallback: fallback.id,
      primarySelection: 'manual',
      fallbackSelection: 'manual'
    }
  };
  const gateway = new AiGateway({ registry: fakeRegistry([primary, fallback], routes) });

  const candidate = gateway.projection('translation', { constraints: { allowExperimental: true } });
  assert.deepEqual(candidate.candidates.map(row => row.id), [primary.id, fallback.id]);
  assert.equal(candidate.modelGroup, 'yance.translation');

  const production = gateway.projection('translation', { executionMode: 'production' });
  assert.equal(production.candidates.length, 0);
});

test('production route rejects a fallback in the same provider failure domain', () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('claude-fallback', 'anthropic/claude-sonnet-5', 97);
  assert.equal(routingAuthority.fallbackIndependent(primary, fallback), false);
});

test('non-retryable request failures are classified as terminal for the attempted model', () => {
  const policy = routingAuthority.classifyFailure({ code: 'INVALID_REQUEST', status: 400 });
  assert.equal(policy.reasonCode, 'REQUEST_NOT_RETRYABLE');
  assert.equal(policy.fallbackAllowed, false);
  assert.equal(policy.retrySameModel, false);
});

test('empty model output is a quality failure with fallback allowed', () => {
  assert.throws(() => routingAuthority.assertUsableResult({ text: '   ', providerRequestId: 'empty-request' }), error => {
    const policy = routingAuthority.classifyFailure(error);
    return error.code === 'MODEL_EMPTY_RESPONSE'
      && error.providerRequestId === 'empty-request'
      && policy.reasonCode === 'QUALITY_FAILURE'
      && policy.fallbackAllowed === true
      && policy.retrySameModel === false;
  });
});

test('Retry-After is normalized into a bounded provider cooldown receipt', () => {
  const normalized = normalizeModelError({
    message: 'rate limited',
    code: 'RATE_LIMITED',
    status: 429,
    response: { headers: { 'retry-after': '3' } }
  }, { nowMs: Date.parse(NOW) });

  assert.equal(normalized.retryAfterMs, 3000);
  assert.equal(normalized.nextRetryAt, '2026-08-01T00:00:03.000Z');
  const policy = routingAuthority.classifyFailure(normalized);
  assert.equal(policy.retrySameModel, false);
  assert.equal(policy.fallbackAllowed, true);
});

test('a 429 cooldown produces a bounded attempt receipt for an independent fallback decision', () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('gpt-fallback', 'openai/gpt-5.6-sol', 97);
  const retryAfterMs = routingAuthority.retryAfterMs({ status: 429, response: { headers: { 'retry-after': '60' } } }, { nowMs: Date.parse(NOW) });
  const policy = routingAuthority.classifyFailure({ code: 'RATE_LIMITED', status: 429 });
  const receipt = routingAuthority.attemptReceipt({
    attemptId: 'attempt-1',
    modelId: primary.id,
    provider: primary.provider,
    status: 'failed',
    reasonCode: policy.reasonCode,
    fallbackAllowed: policy.fallbackAllowed,
    retryAfterMs,
    nextRetryAt: new Date(Date.parse(NOW) + retryAfterMs).toISOString()
  });
  assert.equal(routingAuthority.fallbackIndependent(primary, fallback), true);
  assert.equal(receipt.retryAfterMs, 60000);
  assert.equal(receipt.nextRetryAt, '2026-08-01T00:01:00.000Z');
  assert.equal(receipt.fallbackAllowed, true);
});

test('all model attempts share one total timeout budget instead of receiving a fresh full timeout', () => {
  let now = 1_000_000;
  const budget = routingAuthority.createBudget({ totalBudgetMs: 180000, startedAtMs: now, now: () => now });
  assert.equal(budget.attemptTimeoutMs(180000), 180000);
  now += 70000;
  assert.equal(budget.remainingMs(), 110000);
  assert.equal(budget.attemptTimeoutMs(180000), 110000);
  assert.equal(budget.totalBudgetMs, 180000);
});
