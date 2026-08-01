'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');
const routeAuthority = require('../services/aiRouteResolutionAuthority');
const championAuthority = require('../services/replyChampionAuthority');

function replyModel(id, provider, score, options = {}) {
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
    name: options.name || id,
    modelSlug: options.modelSlug || id,
    provider,
    qualification: 'verified',
    available: true,
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

const NOW = '2026-08-01T00:00:00.000Z';

test('legacy route migrates to V2 without losing requested intent', () => {
  const route = routeAuthority.normalizeRouteV2({
    primary: 'claude',
    fallbackSelection: 'auto',
    enabled: true,
    allowConditional: true
  }, 'quick_reply');

  assert.equal(route.schemaVersion, 2);
  assert.deepEqual(route.requested.primary, { mode: 'manual', modelId: 'claude' });
  assert.deepEqual(route.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(route.legacy.primary, 'claude');
  assert.equal(route.legacy.fallbackSelection, 'auto');
});

test('automatic fallback intent remains explicit when no independent provider candidate exists', () => {
  const primary = replyModel('claude-opus-5', 'anthropic', 98);
  const sameProvider = replyModel('claude-sonnet-5', 'anthropic', 96);

  const result = routeAuthority.resolveRoute(
    [primary, sameProvider],
    'quick_reply',
    {
      enabled: true,
      primary: { mode: 'manual', modelId: primary.id },
      fallback: { mode: 'auto', modelId: '' }
    },
    { now: NOW, maxFallbackScoreGap: 8 }
  );

  assert.deepEqual(result.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(result.resolved.primary.modelId, primary.id);
  assert.equal(result.resolved.fallback.modelId, '');
  assert.equal(result.resolved.fallback.reasonCode, 'NO_QUALIFIED_INDEPENDENT_FALLBACK');
  assert.equal(result.resolutionState, 'PRIMARY_ONLY_CONDITIONAL');
  assert.equal(result.legacy.fallbackSelection, 'auto');
  assert.equal(result.legacy.fallback, '');
});

test('automatic fallback chooses a different provider failure domain', () => {
  const primary = replyModel('claude-opus-5', 'anthropic', 98);
  const closerSameProvider = replyModel('claude-sonnet-5', 'anthropic', 97);
  const independent = replyModel('gpt-5.6-sol', 'openai', 94);

  const result = routeAuthority.resolveRoute(
    [closerSameProvider, independent, primary],
    'quick_reply',
    {
      enabled: true,
      primary: { mode: 'auto', modelId: '' },
      fallback: { mode: 'auto', modelId: '' }
    },
    { now: NOW, maxFallbackScoreGap: 8 }
  );

  assert.equal(result.resolved.primary.modelId, primary.id);
  assert.equal(result.resolved.fallback.modelId, independent.id);
  assert.equal(result.resolved.fallback.provider, 'openai');
  assert.equal(result.resolutionState, 'READY');
  assert.ok(result.reasonCodes.includes('AUTO_FALLBACK_PROVIDER_INDEPENDENT'));
});

test('champion authority does not use a same-provider runner-up as continuity fallback', () => {
  const primary = replyModel('claude-opus-5', 'anthropic', 98);
  const sameProvider = replyModel('claude-sonnet-5', 'anthropic', 97);
  const result = championAuthority.decide([primary, sameProvider], 'deep_reply', {
    now: NOW,
    maxFallbackScoreGap: 8
  });

  assert.equal(result.champion.modelId, primary.id);
  assert.equal(result.fallback, null);
  assert.equal(result.continuityReady, false);
  assert.equal(result.fallbackReasonCode, 'AI_REPLY_INDEPENDENT_FALLBACK_UNAVAILABLE');
});

test('mutable latest alias cannot resolve to a formal route role', () => {
  const alias = replyModel('claude-latest', 'anthropic', 100, {
    modelSlug: 'anthropic/claude-latest'
  });
  const result = routeAuthority.resolveRoute(
    [alias],
    'quick_reply',
    {
      enabled: true,
      primary: { mode: 'manual', modelId: alias.id },
      fallback: { mode: 'auto', modelId: '' }
    },
    { now: NOW }
  );

  assert.equal(result.resolved.primary.modelId, '');
  assert.equal(result.resolved.primary.reasonCode, 'MUTABLE_MODEL_ALIAS_NOT_FORMALLY_QUALIFIABLE');
  assert.equal(result.resolutionState, 'BLOCKED');
});

test('routing integrity projection retains auto fallback request and unresolved reason', () => {
  const routing = require('../services/modelRoutingIntegrityService');
  const primary = replyModel('claude-opus-5', 'anthropic', 98);
  const sameProvider = replyModel('claude-sonnet-5', 'anthropic', 96);
  const route = routing.validateRoutes({
    quick_reply: {
      primary: primary.id,
      primarySelection: 'manual',
      fallbackSelection: 'auto',
      enabled: true,
      allowConditional: false
    }
  }, [primary, sameProvider], { autoSelect: true, throwOnInvalid: true }).repairedRoutes.quick_reply;

  assert.equal(route.schemaVersion, 2);
  assert.deepEqual(route.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(route.resolved.primary.modelId, primary.id);
  assert.equal(route.resolved.fallback.modelId, '');
  assert.equal(route.resolved.fallback.reasonCode, 'NO_QUALIFIED_INDEPENDENT_FALLBACK');
  assert.equal(route.resolutionState, 'PRIMARY_ONLY_CONDITIONAL');
});

test('routing integrity auto fallback uses a provider-independent candidate', () => {
  const routing = require('../services/modelRoutingIntegrityService');
  const primary = replyModel('claude-opus-5', 'anthropic', 98);
  const sameProvider = replyModel('claude-sonnet-5', 'anthropic', 97);
  const independent = replyModel('gpt-5.6-sol', 'openai', 94);
  const route = routing.validateRoutes({
    quick_reply: {
      primary: primary.id,
      primarySelection: 'manual',
      fallbackSelection: 'auto',
      enabled: true
    }
  }, [sameProvider, independent, primary], { autoSelect: true, throwOnInvalid: true }).repairedRoutes.quick_reply;

  assert.equal(route.fallback, independent.id);
  assert.equal(route.resolved.fallback.provider, 'openai');
  assert.equal(route.resolved.fallback.reasonCode, 'AUTO_FALLBACK_PROVIDER_INDEPENDENT');
});
