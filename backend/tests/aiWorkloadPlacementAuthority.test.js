'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const placement = require('../services/aiWorkloadPlacementAuthority');

function utilityModel(id, provider, tasks, extra = {}) {
  return {
    id, name: id, provider, qualification: 'verified', available: true,
    allowedTasks: tasks,
    catalogMetadata: {},
    ...extra
  };
}

function translator(id, provider, score, extra = {}) {
  const evidence = {
    authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED',
    testedAt: '2026-07-31T12:00:00.000Z', completed: true, pass: true, score,
    qualifyingTasks: ['translation'], translationScore: score
  };
  const model = utilityModel(id, provider, ['translation'], { lastCommercialBenchmark: evidence, ...extra });
  model.roleQualificationReceipts = {
    translation: roleReceipts.issueFromEvidence({ modelId: id, task: 'translation', evidence, expiresAt: '2027-07-31T12:00:00.000Z' })
  };
  return model;
}

test('relationship analysis prefers a qualified local privacy model', () => {
  const local = utilityModel('local', 'ollama', ['relationship']);
  const free = utilityModel('free', 'openrouter', ['relationship'], { catalogMetadata: { free: true, pricing: { known: true, promptPerMillion: 0, completionPerMillion: 0 } } });
  const paid = utilityModel('paid', 'openrouter', ['relationship'], { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const result = placement.rankCandidates([paid, free, local], 'relationship');
  assert.equal(result.policy.lane, 'local-private-first');
  assert.equal(result.candidates[0].modelId, 'local');
  assert.equal(result.candidates[1].modelId, 'free');
});

test('inbound/history translation uses local then free cloud', () => {
  const local = translator('local-translator', 'ollama', 86);
  const free = translator('free-translator', 'openrouter', 94, { catalogMetadata: { free: true, pricing: { known: true, promptPerMillion: 0, completionPerMillion: 0 } } });
  const paid = translator('paid-translator', 'openrouter', 99, { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const result = placement.rankCandidates([paid, free, local], 'translation', { translationProfile: 'history', now: '2026-08-01T00:00:00.000Z' });
  assert.deepEqual(result.candidates.map(row => row.modelId), ['local-translator', 'free-translator', 'paid-translator']);
});

test('outbound translation ranks by formal translation quality, not price', () => {
  const local = translator('local-translator', 'ollama', 86);
  const free = translator('free-translator', 'openrouter', 94, { catalogMetadata: { free: true, pricing: { known: true, promptPerMillion: 0, completionPerMillion: 0 } } });
  const paid = translator('paid-translator', 'openrouter', 99, { catalogMetadata: { pricing: { known: true, promptPerMillion: 1, completionPerMillion: 2 } } });
  const result = placement.rankCandidates([local, free, paid], 'translation', { translationProfile: 'outbound', now: '2026-08-01T00:00:00.000Z' });
  assert.equal(result.policy.lane, 'translation-champion');
  assert.equal(result.candidates[0].modelId, 'paid-translator');
});
