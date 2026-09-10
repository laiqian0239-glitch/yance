'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const routing = require('../services/modelRoutingIntegrityService');
const quality = require('../services/aiQualityRouteAuthority');
const { AiGateway } = require('../services/aiGateway');
const { DurableInternalOperationAuthority } = require('../services/durableInternalOperationAuthority');

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

function durableAuthorityFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-champion-ai-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  let sequence = 0;
  const authority = new DurableInternalOperationAuthority({
    storeProvider: () => store,
    tokenProvider: () => store.authorityWriteHostCapability.tokenSnapshot(),
    idFactory: prefix => `${prefix}-${++sequence}`
  });
  return {
    authority,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

test('retired physical quality route authority remains fail-closed', () => {
  const champion = replyModel('plain-strongest', 98, { provider: 'anthropic', modelSlug: 'anthropic/claude-opus-5' });
  const weaker = replyModel('mistral-small-30b-weaker', 90, { provider: 'openai', modelSlug: 'openai/gpt-5.6-sol' });
  assert.throws(() => quality.routeReceipt({
    task: 'quick_reply',
    route: { primary: weaker.id, fallback: champion.id, primarySelection: 'manual' },
    selectedModel: weaker,
    models: [weaker, champion]
  }), error => error.code === 'MODEL_ROUTING_MANAGED_BY_LITELLM');
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

test('gateway projection honors local-only hard eligibility for relationship work', () => {
  const local = utilityModel('local-private', 'ollama', 'relationship');
  const paid = utilityModel('paid-cloud', 'openrouter', 'relationship', { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const document = {
    models: [paid, local],
    routes: { relationship: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: paid.id, fallback: local.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 11 }
  };
  const projection = gateway(document).projection('relationship', { constraints: { localOnly: true } });
  assert.equal(projection.authority, 'LiteLLM v1.95.0');
  assert.deepEqual(projection.candidates.map(row => row.id), [local.id]);
  assert.ok(projection.tags.includes('source:local'));
});

test('gateway projection blocks paid-only background work through local-only hard eligibility', () => {
  const paid = utilityModel('paid-cloud', 'openrouter', 'relationship', { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const document = {
    models: [paid],
    routes: { relationship: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: paid.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 11 }
  };
  const projection = gateway(document).projection('relationship', { constraints: { localOnly: true } });
  assert.equal(projection.candidates.length, 0);
  assert.equal(projection.hardEligibility.privacy, true);
});

test('Model Brain projection exposes verified reply deployments without Yance physical reranking', () => {
  const strongest = replyModel('strongest', 98);
  const backup = replyModel('backup', 94);
  const document = {
    models: [backup, strongest],
    routes: { quick_reply: { enabled: true, primarySelection: 'auto', fallbackSelection: 'auto', primary: strongest.id, fallback: backup.id } },
    aiBudgetPolicy: { totalBudgetUsd: 15, championReserveUsd: 5, backgroundPaidEnabled: true },
    aiBudgetUsage: { spentUsd: 14.8 }
  };
  const projection = gateway(document).projection('quick_reply', { executionMode: 'production' });
  assert.equal(projection.modelBrain, 'Model Brain');
  assert.deepEqual(new Set(projection.candidates.map(row => row.id)), new Set([strongest.id, backup.id]));
});

test('queued background translation preserves workload profile during initial and execution route resolution', async () => {
  const durable = durableAuthorityFixture();
  const observedMeta = [];
  const observedRun = [];
  const signal = new AbortController().signal;
  const instance = new AiGateway({
    concurrency: 1,
    registry: { read: () => ({ models: [], routes: {} }) },
    internalOperationAuthorityProvider: () => durable.authority,
    queue: {
      add(task, meta) {
        observedMeta.push({ ...meta });
        return { id: meta.jobId, promise: Promise.resolve().then(() => task({ signal })) };
      },
      cancel: () => false,
      status: () => ({ pending: [], running: [], completed: [] })
    }
  });
  instance._run = async ({ options }) => {
    observedRun.push({ ...options });
    return { modelId: 'local-translator' };
  };
  try {
    const { jobId } = instance.submit({
      task: 'translation',
      background: true,
      messages: [{ role: 'user', content: 'Hallo' }],
      options: { translationProfile: 'history' }
    });
    await instance.waitForJob(jobId);
    assert.equal(observedMeta[0].background, true);
    assert.equal(observedMeta[0].task, 'translation');
    assert.equal(observedRun[0].translationProfile, 'history');
  } finally {
    durable.close();
  }
});
