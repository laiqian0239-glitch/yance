'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiGateway } = require('../services/aiGateway');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const { normalizeModelError } = require('../services/modelErrorNormalizer');

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

  const candidate = gateway.resolveRoute('translation', '', { executionMode: 'candidate-only' });
  assert.equal(candidate.primary?.id, primary.id);
  assert.equal(candidate.fallback?.id, fallback.id);
  assert.equal(candidate.qualityPlan.state, 'conditional');
  assert.equal(candidate.humanReviewRequired, true);

  const production = gateway.resolveRoute('translation', '', { executionMode: 'production' });
  assert.equal(production.primary, null);
  assert.equal(production.qualityPlan.state, 'blocked');
});

test('production route rejects a fallback in the same provider failure domain', () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('claude-fallback', 'anthropic/claude-sonnet-5', 97);
  const gateway = new AiGateway({ registry: fakeRegistry([primary, fallback], productionRoute(primary, fallback)) });

  const route = gateway.resolveRoute('quick_reply', '', { executionMode: 'production' });
  assert.equal(route.primary?.id, primary.id);
  assert.equal(route.fallback, null);
  assert.equal(route.qualityPlan.fallbackIndependent, false);
  assert.ok(route.qualityPlan.violations.some(row => row.code === 'AI_ROUTE_FALLBACK_FAILURE_DOMAIN_NOT_INDEPENDENT'));
});

test('non-retryable request failures stop the route instead of silently switching models', async () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('gpt-fallback', 'openai/gpt-5.6-sol', 97);
  const calls = [];
  const gateway = new AiGateway({
    registry: fakeRegistry([primary, fallback], productionRoute(primary, fallback)),
    executeModel: async model => {
      calls.push(model.id);
      if (model.id === primary.id) throw Object.assign(new Error('invalid request schema'), { code: 'INVALID_REQUEST', status: 400 });
      return { text: 'must not run', providerRequestId: 'fallback-request' };
    }
  });

  await assert.rejects(
    gateway.execute({ task: 'quick_reply', messages: [{ role: 'user', content: 'Hallo' }], options: { executionMode: 'production' } }),
    error => error.code === 'ALL_MODELS_FAILED' && error.attempts?.[0]?.fallbackAllowed === false
  );
  assert.deepEqual(calls, [primary.id]);
});

test('empty model output is a quality failure and switches to the independent fallback', async () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('gpt-fallback', 'openai/gpt-5.6-sol', 97);
  const calls = [];
  const gateway = new AiGateway({
    registry: fakeRegistry([primary, fallback], productionRoute(primary, fallback)),
    executeModel: async model => {
      calls.push(model.id);
      if (model.id === primary.id) return { text: '   ', providerRequestId: 'empty-request' };
      return { text: 'Hallo! Schön von dir zu hören.', providerRequestId: 'fallback-request' };
    }
  });

  const result = await gateway.execute({ task: 'quick_reply', messages: [{ role: 'user', content: 'Hallo' }], options: { executionMode: 'production' } });
  assert.equal(result.modelId, fallback.id);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(calls, [primary.id, fallback.id]);
  assert.equal(result.attempts[0].code, 'MODEL_EMPTY_RESPONSE');
  assert.equal(result.attempts[0].fallbackAllowed, true);
  assert.equal(result.attempts[0].reasonCode, 'QUALITY_FAILURE');
  assert.equal(result.attempts[0].retrySameModel, false);
  assert.equal(result.attempts[1].providerRequestId, 'fallback-request');
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
  const policy = require('../services/modelServiceTaskRoutingAuthority').classifyFailure(normalized);
  assert.equal(policy.retrySameModel, false);
  assert.equal(policy.fallbackAllowed, true);
});

test('a 429 cooldown skips the throttled model on the next request and uses an independent provider', async () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('gpt-fallback', 'openai/gpt-5.6-sol', 97);
  let now = Date.parse(NOW);
  const calls = [];
  const gateway = new AiGateway({
    clock: { now: () => now, sleep: async ms => { now += ms; } },
    registry: fakeRegistry([primary, fallback], productionRoute(primary, fallback)),
    executeModel: async model => {
      calls.push(model.id);
      if (model.id === primary.id) {
        throw Object.assign(new Error('rate limited'), {
          code: 'RATE_LIMITED', status: 429, response: { headers: { 'retry-after': '60' } }
        });
      }
      return { text: 'Fallback ok', providerRequestId: `req-${calls.length}` };
    }
  });

  const first = await gateway.execute({ task: 'quick_reply', messages: [], options: { executionMode: 'production' } });
  assert.equal(first.modelId, fallback.id);
  const second = await gateway.execute({ task: 'quick_reply', messages: [], options: { executionMode: 'production' } });
  assert.equal(second.modelId, fallback.id);
  assert.deepEqual(calls, [primary.id, fallback.id, fallback.id]);
  assert.equal(first.attempts[0].retryAfterMs, 60000);
  assert.equal(first.attempts[0].nextRetryAt, '2026-08-01T00:01:00.000Z');
});

test('all model attempts share one total timeout budget instead of receiving a fresh full timeout', async () => {
  const primary = replyModel('claude-primary', 'anthropic/claude-opus-5', 99);
  const fallback = replyModel('gpt-fallback', 'openai/gpt-5.6-sol', 97);
  let now = 1_000_000;
  const seenTimeouts = [];
  const gateway = new AiGateway({
    clock: { now: () => now, sleep: async ms => { now += ms; } },
    registry: fakeRegistry([primary, fallback], productionRoute(primary, fallback)),
    executeModel: async (model, messages, options) => {
      seenTimeouts.push(options.timeoutMs);
      if (model.id === primary.id) {
        now += 70000;
        throw Object.assign(new Error('provider unavailable'), { code: 'HTTP_503', status: 503 });
      }
      return { text: 'Fallback within remaining budget', providerRequestId: 'fallback-budget' };
    }
  });

  const result = await gateway.execute({ task: 'quick_reply', messages: [], options: { executionMode: 'production', timeoutMs: 180000 } });
  assert.equal(result.modelId, fallback.id);
  assert.equal(seenTimeouts[0], 180000);
  assert.equal(seenTimeouts[1], 110000);
  assert.equal(result.totalBudgetMs, 180000);
  assert.equal(result.remainingBudgetMs, 110000);
});
