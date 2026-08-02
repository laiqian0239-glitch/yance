'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const routing = require('../services/modelRoutingIntegrityService');
const quality = require('../services/aiQualityRouteAuthority');
const { AiGateway } = require('../services/aiGateway');

function replyModel(id, score, extra = {}) {
  const evidence = {
    authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED',
    testedAt: '2026-07-31T12:00:00.000Z', completed: true, pass: true, score,
    qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
    scenarios: [
      { id: 'german_whatsapp', pass: true, weight: 20, score: Math.round(score * 0.2), issues: [] },
      { id: 'english_whatsapp', pass: true, weight: 20, score: Math.round(score * 0.2), issues: [] },
      { id: 'persona_boundary', pass: true, weight: 25, score: Math.round(score * 0.25), issues: [] },
      { id: 'director_schema', pass: true, weight: 20, score: Math.round(score * 0.2), issues: [] },
      { id: 'latency', pass: true, weight: 15, score: Math.round(score * 0.15), issues: [] }
    ]
  };
  const model = {
    id, name: id, provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: evidence,
    roleQualificationReceipts: {},
    ...extra
  };
  for (const task of ['quick_reply', 'deep_reply', 'director']) {
    model.roleQualificationReceipts[task] = roleReceipts.issueFromEvidence({ modelId: id, task, evidence, expiresAt: '2027-07-31T12:00:00.000Z' });
  }
  return model;
}

function utilityModel(id, provider, task, extra = {}) {
  return {
    id, name: id, provider, qualification: 'verified', available: true,
    allowedTasks: [task], capabilityTags: task === 'relationship' ? ['relationship_reasoning', 'persona_consistency_long_context'] : [], catalogMetadata: {}, ...extra
  };
}

function gateway(document) {
  const registry = {
    read: () => document,
    recordInvocation: async () => document,
    recordInvocationFailure: async () => document
  };
  return new AiGateway({ registry, executeModel: async () => ({ text: 'ok' }) });
}

test('formal quality plan blocks a configured model that is not the task champion', () => {
  const champion = replyModel('plain-strongest', 98, { provider: 'anthropic', modelSlug: 'anthropic/claude-opus-5' });
  const weaker = replyModel('mistral-small-30b-weaker', 90, { provider: 'openai', modelSlug: 'openai/gpt-5.6-sol' });
  const plan = quality.routePlan({
    task: 'quick_reply',
    route: { primary: weaker.id, fallback: champion.id, primarySelection: 'manual' },
    models: [weaker, champion]
  });
  assert.equal(plan.primaryPass, false);
  assert.equal(plan.state, quality.ROUTE_STATE.BLOCKED);
  assert.equal(plan.violations.some(row => row.code === 'AI_REPLY_PRIMARY_NOT_CHAMPION'), true);
  assert.equal(plan.championDecision.champion.modelId, champion.id);
});

test('automatic reply route selects evidence champion instead of name and parameter heuristics', () => {
  const champion = replyModel('plain-strongest', 98, { provider: 'anthropic', modelSlug: 'anthropic/claude-opus-5' });
  const weaker = replyModel('mistral-small-30b-weaker', 90, { provider: 'openai', modelSlug: 'openai/gpt-5.6-sol', parameterSize: '30B' });
  const result = routing.repairRegistryDocument({
    models: [weaker, champion],
    routes: { quick_reply: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto' } }
  }, { autoSelectVerified: true, rebalanceAutoRoutes: true });
  assert.equal(result.document.routes.quick_reply.primary, champion.id);
  assert.equal(result.document.routes.quick_reply.fallback, weaker.id);
  assert.equal(result.document.routes.quick_reply.source, 'reply-champion-authority-auto');
});

test('automatic relationship route selects local privacy model before paid cloud', () => {
  const local = utilityModel('local-private', 'ollama', 'relationship');
  const paid = utilityModel('paid-cloud', 'openrouter', 'relationship', { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const result = routing.repairRegistryDocument({
    models: [paid, local],
    routes: { relationship: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto' } }
  }, { autoSelectVerified: true, rebalanceAutoRoutes: true });
  assert.equal(result.document.routes.relationship.primary, local.id);
  assert.equal(result.document.routes.relationship.fallback, paid.id);
  assert.equal(result.document.routes.relationship.source, 'workload-placement-authority-auto');
});

test('gateway protects champion reserve by selecting local background model', () => {
  const local = utilityModel('local-private', 'ollama', 'relationship');
  const paid = utilityModel('paid-cloud', 'openrouter', 'relationship', { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const document = {
    models: [paid, local],
    routes: { relationship: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: paid.id, fallback: local.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 11 }
  };
  const route = gateway(document).resolveRoute('relationship');
  assert.equal(route.primary.id, local.id);
  assert.equal(route.placementDecision.policy.lane, 'local-private-first');
  assert.equal(route.budgetDecision.pass, true);
  assert.equal(route.budgetDecision.reasonCode, 'AI_NON_PAID_WORKLOAD_ALLOWED');
});

test('gateway blocks paid-only background work when reserve is protected', () => {
  const paid = utilityModel('paid-cloud', 'openrouter', 'relationship', { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const document = {
    models: [paid],
    routes: { relationship: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: paid.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 11 }
  };
  const route = gateway(document).resolveRoute('relationship');
  assert.equal(route.primary, null);
  assert.equal(route.budgetDecision.pass, false);
  assert.equal(route.budgetDecision.reasonCode, 'AI_BACKGROUND_PAID_BUDGET_PROTECTED');
});

test('budget protection never downgrades or blocks the formal champion reply', () => {
  const strongest = replyModel('strongest', 98);
  const backup = replyModel('backup', 94);
  const document = {
    models: [backup, strongest],
    routes: { quick_reply: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: strongest.id, fallback: backup.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 14.8 }
  };
  const route = gateway(document).resolveRoute('quick_reply');
  assert.equal(route.primary.id, strongest.id);
  assert.equal(route.budgetDecision.pass, true);
  assert.equal(route.budgetDecision.reasonCode, 'AI_CHAMPION_RESERVE_ALLOWED');
});

test('queued background translation preserves workload profile during initial and execution route resolution', async () => {
  const instance = new AiGateway({
    concurrency: 1,
    registry: { read: () => ({ models: [], routes: {} }) }
  });
  const observed = [];
  instance.resolveRoute = (_task, _modelId, options = {}) => {
    observed.push({ ...options });
    return {
      primary: { id: 'local-translator', name: 'local-translator', provider: 'ollama' },
      fallback: null,
      emergency: null,
      route: {},
      task: 'translation',
      qualityPlan: { state: 'ready' },
      conditional: false,
      humanReviewRequired: false
    };
  };
  instance._run = async ({ options }) => {
    instance.resolveRoute('translation', '', options);
    return { modelId: 'local-translator' };
  };
  const { jobId } = instance.submit({
    task: 'translation',
    background: true,
    options: { translationProfile: 'history' }
  });
  await instance.waitForJob(jobId);
  assert.equal(observed.length >= 2, true);
  assert.equal(observed[0].background, true);
  assert.equal(observed[0].translationProfile, 'history');
  assert.equal(observed[1].background, true);
  assert.equal(observed[1].translationProfile, 'history');
});
