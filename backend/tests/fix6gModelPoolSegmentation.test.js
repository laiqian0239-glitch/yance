'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const lifecycle = require('../services/aiBrainRoleLifecycleAuthority');
const frontier = require('../services/openRouterFrontierCandidateAuthority');
const pools = require('../services/modelPoolSegmentationAuthority');
const statusProjection = require('../services/modelStatusProjection');

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

function model(id, overrides = {}) {
  return {
    id,
    name: id,
    modelSlug: id.includes('/') ? id : '',
    provider: id.includes('/') ? 'openai-compatible' : 'ollama',
    available: true,
    configured: true,
    qualification: 'verified',
    capabilities: ['text'],
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    taskHints: [],
    catalogMetadata: {
      slug: id.includes('/') ? id : '',
      taskEligibility: { quick_reply: true, deep_reply: true, director: true }
    },
    ...overrides
  };
}

function connectedChallenger(id, overrides = {}) {
  return model(id, {
    lastSuccessfulInvocation: { at: '2026-07-31T12:00:00.000Z' },
    taskHints: ['quick_reply', 'deep_reply', 'director'],
    ...overrides
  });
}

function qualified(id, score = 96, overrides = {}) {
  const evidence = replyEvidence(score);
  const value = connectedChallenger(id, {
    lastReplyBrainBenchmark: evidence,
    roleQualificationReceipts: {},
    ...overrides
  });
  for (const task of ['quick_reply', 'deep_reply', 'director']) {
    value.roleQualificationReceipts[task] = roleReceipts.issueFromEvidence({
      modelId: id,
      task,
      evidence,
      issuedAt: evidence.testedAt,
      expiresAt: '2027-07-31T12:00:00.000Z'
    });
  }
  return value;
}

function catalogModel(id, options = {}) {
  return {
    id,
    name: id,
    description: 'general multilingual conversational model',
    chatTextEligible: true,
    textInput: true,
    textOutput: true,
    structuredOutput: true,
    reasoning: true,
    tools: true,
    contextLength: 200000,
    created: 1786000000 + Number(options.offset || 0),
    promptPerMillion: 5,
    completionPerMillion: 25,
    ...options
  };
}

test('frontier authority separates five reply challengers from the larger registration inventory', () => {
  const catalog = [
    catalogModel('anthropic/claude-opus-5'),
    catalogModel('openai/gpt-5.6-sol'),
    ...Array.from({ length: 27 }, (_, index) => catalogModel(`vendor-${index}/model-${index}`, { offset: index }))
  ];
  const plan = frontier.buildPlan(catalog, { limit: 28, challengerLimit: 5 });
  assert.equal(plan.shortlist.length, 28, 'compatibility inventory remains available for registration');
  assert.equal(plan.inventoryShortlist.length, 28);
  assert.equal(plan.challengerShortlist.length, 5);
  assert.deepEqual(plan.challengerShortlist.slice(0, 2).map(row => row.id), [
    'anthropic/claude-opus-5',
    'openai/gpt-5.6-sol'
  ]);
  assert.equal(plan.challengerShortlist.every(row => plan.inventoryShortlist.some(item => item.id === row.id)), true);
});

test('task hints plus real connectivity promote only selected models into TASK_CHALLENGER', () => {
  const hinted = connectedChallenger('anthropic/claude-opus-5');
  const inventory = model('vendor/catalog-only');
  assert.equal(lifecycle.deriveModelTaskLifecycle(hinted, 'quick_reply', { now: NOW }).state, lifecycle.STATES.TASK_CHALLENGER);
  assert.equal(lifecycle.deriveModelTaskLifecycle(inventory, 'quick_reply', { now: NOW }).state, lifecycle.STATES.CATALOG_ONLY);
});

test('model pools do not project twenty-nine registered models as twenty-nine reply candidates', () => {
  const models = [
    connectedChallenger('anthropic/claude-opus-5'),
    connectedChallenger('openai/gpt-5.6-sol'),
    qualified('mistral/qualified-chat', 97),
    qualified('openai/gpt-latest', 99),
    model('anthropic/claude-opus-5:batch', {
      batchOnly: true,
      catalogMetadata: { endpointType: 'batch', taskEligibility: {} }
    }),
    model('google/vision-worker', {
      capabilities: ['text', 'vision'],
      catalogMetadata: { inputModalities: ['text', 'image'], taskEligibility: { media_analysis: true } },
      allowedTasks: ['media_analysis']
    }),
    model('local-summary', {
      provider: 'ollama',
      allowedTasks: ['summary', 'relationship'],
      catalogMetadata: { taskEligibility: { summary: true, relationship: true }, free: true }
    }),
    ...Array.from({ length: 22 }, (_, index) => model(`vendor-${index}/inventory-${index}`, { qualification: 'untested' }))
  ];
  assert.equal(models.length, 29);
  const result = pools.segment(models, {}, { now: NOW, maxChallengersPerTask: 5, platformAccounts: [] });
  assert.equal(result.summary.registeredModelCount, 29);
  assert.equal(result.summary.replyCandidateModelCount < 29, true);
  assert.equal(result.summary.replyCandidateModelCount, 4, 'two connected challengers, one pinned qualified model, and one mutable-alias challenger');
  assert.equal(result.batchOnly.some(row => row.modelId === 'anthropic/claude-opus-5:batch'), true);
  assert.equal(result.multimodal.some(row => row.modelId === 'google/vision-worker'), true);
  assert.equal(result.background.some(row => row.modelId === 'local-summary'), true);
  assert.equal(result.inventory.length > 0, true);
  assert.equal(result.qualified.some(row => row.modelId === 'openai/gpt-latest'), false, 'mutable aliases never enter formal pools');
  assert.equal(result.challengers.some(row => row.modelId === 'openai/gpt-latest'), true, 'mutable aliases remain evaluable challengers only');
});

test('offline benchmark and signed receipt can qualify a model without any platform account login', () => {
  const offlineQualified = qualified('mistral/offline-qualified', 98);
  const result = pools.segment([offlineQualified], {}, { now: NOW, platformAccounts: [] });
  assert.equal(result.qualificationGates.modelBenchmarkRequiresPlatformLogin, false);
  assert.equal(result.qualificationGates.platformUatRequiredForRelease, true);
  assert.equal(result.champions.some(row => row.modelId === 'mistral/offline-qualified'), true);
  assert.equal(result.platformUat.connectedAccountCount, 0);
  assert.equal(result.platformUat.releaseGatePassed, false);
});

test('model status projection exposes lifecycle pools and keeps platform UAT separate from benchmark qualification', () => {
  const value = statusProjection.project({
    models: [
      connectedChallenger('anthropic/claude-opus-5'),
      connectedChallenger('openai/gpt-5.6-sol'),
      model('vendor/inventory')
    ],
    routes: {}
  }, { now: NOW, platformAccounts: [] });
  assert.equal(value.schemaVersion >= 5, true);
  assert.equal(value.modelPools.summary.registeredModelCount, 3);
  assert.equal(value.modelPools.summary.replyCandidateModelCount, 2);
  assert.equal(value.modelPools.qualificationGates.modelBenchmarkRequiresPlatformLogin, false);
  assert.equal(value.summary.replyCandidateInventoryCount, 2);
});
