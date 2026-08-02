'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const champion = require('../services/replyChampionAuthority');

function replyModel(id, score, options = {}) {
  const testedAt = options.testedAt || '2026-07-31T12:00:00.000Z';
  const evidence = {
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_QUALIFIED',
    testedAt,
    completed: true,
    pass: true,
    score,
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
    id,
    name: id,
    provider: options.provider || 'openrouter',
    qualification: 'verified',
    available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: evidence,
    lastSuccessAt: options.lastSuccessAt || testedAt,
    roleQualificationReceipts: {}
  };
  for (const task of ['quick_reply', 'deep_reply', 'director']) {
    model.roleQualificationReceipts[task] = roleReceipts.issueFromEvidence({
      modelId: id,
      task,
      evidence,
      issuedAt: testedAt,
      expiresAt: options.expiresAt || '2027-07-31T12:00:00.000Z'
    });
  }
  return model;
}

test('selects the highest task evidence score as champion', () => {
  const lower = replyModel('lower', 91);
  const strongest = replyModel('strongest', 97);
  const result = champion.decide([lower, strongest], 'quick_reply', { now: '2026-08-01T00:00:00.000Z' });
  assert.equal(result.pass, true);
  assert.equal(result.champion.modelId, 'strongest');
  assert.equal(result.ranking[0].taskScore > result.ranking[1].taskScore, true);
});

test('manual weak model cannot replace the formal champion', () => {
  const strongest = replyModel('strongest', 98);
  const weaker = replyModel('weaker', 90);
  const result = champion.decide([weaker, strongest], 'deep_reply', {
    requestedModelId: 'weaker',
    now: '2026-08-01T00:00:00.000Z'
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'AI_REPLY_REQUESTED_MODEL_NOT_CHAMPION');
  assert.equal(result.champion.modelId, 'strongest');
});

test('runner-up is accepted only inside the configured quality gap', () => {
  const strongest = replyModel('strongest', 98, { provider: 'anthropic' });
  const close = replyModel('close', 93, { provider: 'openai' });
  const far = replyModel('far', 82, { provider: 'google' });
  const result = champion.decide([far, close, strongest], 'quick_reply', {
    maxFallbackScoreGap: 8,
    now: '2026-08-01T00:00:00.000Z'
  });
  assert.equal(result.fallback.modelId, 'close');
  assert.equal(result.fallback.scoreGap <= 8, true);
  const noFallback = champion.decide([far, strongest], 'quick_reply', {
    maxFallbackScoreGap: 8,
    now: '2026-08-01T00:00:00.000Z'
  });
  assert.equal(noFallback.fallback, null);
  assert.equal(noFallback.continuityReady, false);
});

test('expired formal receipt is excluded from champion ranking', () => {
  const expired = replyModel('expired', 100, { expiresAt: '2026-07-31T12:30:00.000Z' });
  const current = replyModel('current', 94);
  const result = champion.decide([expired, current], 'director', { now: '2026-08-01T00:00:00.000Z' });
  assert.equal(result.champion.modelId, 'current');
  assert.equal(result.rejected.some(row => row.modelId === 'expired' && row.reasonCode === 'ROLE_RECEIPT_EXPIRED'), true);
});
