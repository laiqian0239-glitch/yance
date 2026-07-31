'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const benchmark = require('../services/commercialModelBenchmarkService');

function model(overrides = {}) {
  return {
    id: 'cloud-test',
    name: 'provider/test-model:free',
    displayName: 'Test Model Free',
    provider: 'openai-compatible',
    source: 'openrouter-auto',
    available: true,
    qualification: 'experimental',
    allowedTasks: [],
    catalogMetadata: { free: true, pricing: { promptPerMillion: 0, completionPerMillion: 0 } },
    ...overrides
  };
}

function executorFor(outputs = {}) {
  return async (_model, messages) => {
    const system = String(messages?.[0]?.content || '');
    let text = '';
    if (system.includes('德语私人聊天')) text = outputs.deZh || '我65岁，是一个开朗的男人。我的爱好是骑自行车、游泳、阅读和音乐。我来自奥地利，住在维也纳附近。';
    else if (system.includes('中文私人聊天')) text = outputs.zhDe || 'Ich kann heute Abend um 18:30 keinen Videoanruf machen, aber morgen geht es. Meine WhatsApp-Nummer ist +49 170 2106045.';
    else if (system.includes('只提取peer/inbound')) text = outputs.facts || JSON.stringify({ age: 65, country: 'Österreich', region: 'in der Nähe von Wien', city: '', interests: ['Radfahren', 'Schwimmen', 'Lesen', 'Musik'], rejected: ['self/outbound', 'platform/internal'] });
    else text = outputs.relationship || JSON.stringify({ facts: ['对方住在维也纳附近'], inferences: [], evidenceMessageIds: ['m1'] });
    return { text, totalMs: 1200, firstTokenMs: 250, promptTokens: 100, outputTokens: 80, totalTokens: 180, returnedModel: 'provider/test-model:free' };
  };
}

test('commercial benchmark proves translation, role isolation, evidence, and qualifies utility tasks', async () => {
  const result = await benchmark.benchmarkModel(model(), { executor: executorFor() });
  assert.equal(result.completed, true);
  assert.equal(result.pass, true);
  assert.equal(result.score, 100);
  assert.equal(result.translationScore, 100);
  assert.equal(result.evidenceScore, 100);
  assert.deepEqual(new Set(result.qualifyingTasks), new Set(['translation', 'fact_extraction', 'memory_extraction', 'understanding', 'summary', 'relationship']));
});

test('commercial benchmark blocks outbound self facts and internal ids from contact fact qualification', async () => {
  const result = await benchmark.benchmarkModel(model(), {
    executor: executorFor({
      facts: JSON.stringify({ age: 41, country: 'Deutschland', region: 'Berlin', city: 'Berlin', interests: ['Design'], rejected: [] }),
      relationship: JSON.stringify({ facts: ['Berlin', '28359384636982883'], inferences: [], evidenceMessageIds: ['m2'] })
    })
  });
  const facts = result.scenarios.find(row => row.id === 'peer_fact_role_isolation');
  const relationship = result.scenarios.find(row => row.id === 'relationship_evidence_boundary');
  assert.equal(facts.pass, false);
  assert.ok(facts.issues.some(issue => issue.code === 'ROLE_OR_INTERNAL_ID_LEAK'));
  assert.equal(relationship.pass, false);
  assert.ok(relationship.issues.some(issue => issue.code === 'SELF_OR_INTERNAL_FACT_LEAK'));
  assert.equal(result.qualifyingTasks.includes('fact_extraction'), false);
  assert.equal(result.pass, false);
});

test('utility route recommendation prefers a passing free model and keeps a distinct fallback', () => {
  const free = model({ id: 'free', name: 'free', lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation', 'fact_extraction'], translationScore: 88, evidenceScore: 90 } });
  const paid = model({ id: 'paid', name: 'paid', catalogMetadata: { free: false, pricing: { promptPerMillion: 1, completionPerMillion: 5 } }, lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation', 'fact_extraction'], translationScore: 99, evidenceScore: 99 } });
  const routes = benchmark.recommendedUtilityRoutes([paid, free]);
  assert.equal(routes.translation.primary, 'free');
  assert.equal(routes.translation.fallback, 'paid');
  assert.equal(routes.fact_extraction.primary, 'free');
  assert.equal(routes.memory_extraction.primary, 'free');
  assert.equal(routes.relationship.primary, 'free');
  assert.equal(routes.translation.allowCloudFallback, true);
});

test('translation routing uses commercially qualified cloud for realtime and preserves local model for history only', () => {
  const cloudFree = model({ id: 'cloud-free', name: 'cloud-free', lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'], translationScore: 96 } });
  const cloudPaid = model({ id: 'cloud-paid', name: 'cloud-paid', catalogMetadata: { free: false, pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } }, lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'], translationScore: 99 } });
  const local = model({ id: 'local-history', name: 'translategemma:4b', provider: 'ollama', source: 'ollama', qualification: 'verified', allowedTasks: ['translation'], catalogMetadata: {} });
  const routes = benchmark.recommendedUtilityRoutes([local, cloudPaid, cloudFree]);
  assert.equal(routes.translation.primary, 'cloud-free');
  assert.equal(routes.translation.fallback, 'cloud-paid');
  assert.equal(routes.translation.historyPrimary, 'local-history');
  assert.equal(routes.translation.offlineFallback, 'local-history');
  assert.equal(routes.translation.profiles.realtime, 'commercial-qualified-cloud');
  assert.equal(routes.translation.profiles.history, 'local-low-priority');
});

test('unknown model pricing is not classified as free or preferred over a known paid fallback', () => {
  const unknown = model({
    id: 'unknown',
    name: 'unknown',
    catalogMetadata: { free: false, pricing: { known: false } },
    lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'], translationScore: 100 }
  });
  const paid = model({
    id: 'paid-known',
    name: 'paid-known',
    catalogMetadata: { free: false, pricing: { known: true, promptPerMillion: 1, completionPerMillion: 1 } },
    lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'], translationScore: 90 }
  });
  assert.equal(benchmark.modelIsFree(unknown), false);
  assert.equal(benchmark.modelCost(unknown), Number.POSITIVE_INFINITY);
  assert.equal(benchmark.modelHasUsablePricing(unknown), false);
  const routes = benchmark.recommendedUtilityRoutes([unknown, paid]);
  assert.equal(routes.translation.primary, 'paid-known');
  assert.equal(routes.translation.fallback, '');
});

test('OpenRouter shortlist is compact and follows role selections without duplicate models', () => {
  const a = model({ id: 'a', name: 'model/a' });
  const b = model({ id: 'b', name: 'model/b' });
  const c = model({ id: 'c', name: 'model/c' });
  const chosen = benchmark.chooseOpenRouterBenchmarkModels({
    models: [a, b, c],
    openRouter: { selections: {
      translation: [{ id: 'model/a' }, { id: 'model/b' }],
      memory_extraction: [{ id: 'model/a' }, { id: 'model/c' }],
      quick_reply: [{ id: 'model/c' }]
    } }
  }, { maxModels: 3 });
  assert.deepEqual(chosen.map(row => row.id), ['a', 'b', 'c']);
});

test('benchmark plan reports catalog, shortlist, and unassessed counts instead of implying every synced model was evaluated', () => {
  const a = model({ id: 'a', name: 'model/a', taskHints: ['translation'] });
  const b = model({ id: 'b', name: 'model/b', taskHints: ['fact_extraction'] });
  const c = model({ id: 'c', name: 'model/c', taskHints: ['quick_reply', 'director', 'deep_reply'] });
  const plan = benchmark.chooseOpenRouterBenchmarkPlan({
    models: [a, b, c],
    openRouter: {
      modelCount: 345,
      selections: {
        translation: [{ id: 'model/a' }],
        memory_extraction: [{ id: 'model/b' }],
        quick_reply: [{ id: 'model/c' }],
        director: [{ id: 'model/c' }],
        deep_reply: [{ id: 'model/c' }]
      }
    }
  });
  assert.equal(plan.catalogCount, 345);
  assert.equal(plan.registeredCount, 3);
  assert.equal(plan.shortlistedCount, 3);
  assert.equal(plan.utilityCandidateCount, 2);
  assert.equal(plan.replyCandidateCount, 1);
  assert.equal(plan.unassessedCatalogCount, 342);
});
