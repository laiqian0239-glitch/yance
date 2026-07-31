'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/aiQualityRouteAuthority');

function highModel(id, provider = 'openrouter') {
  return {
    id,
    name: id,
    provider,
    qualification: 'verified',
    available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director', 'understanding', 'relationship'],
    lastQualificationTest: {
      scores: {
        persona: { pass: true },
        hallucination: { pass: true },
        json: { pass: true }
      }
    },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      pass: true,
      status: 'REPLY_BRAIN_QUALIFIED',
      completed: true,
      score: 92,
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'english_whatsapp', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 24, issues: [] },
        { id: 'director_schema', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'latency', pass: true, weight: 15, score: 11, issues: [] }
      ]
    }
  };
}

function conditionalModel(id) {
  const model = highModel(id);
  model.lastReplyBrainBenchmark = {
    authority: 'YanceReplyBrainBenchmark',
    pass: false,
    status: 'REPLY_BRAIN_CONDITIONAL',
    completed: true,
    score: 72,
    scenarios: [
      { id: 'german_whatsapp', pass: true, weight: 20, score: 16, issues: [] },
      { id: 'english_whatsapp', pass: true, weight: 20, score: 16, issues: [] },
      { id: 'persona_boundary', pass: true, weight: 25, score: 20, issues: [] },
      { id: 'director_schema', pass: true, weight: 20, score: 16, issues: [] },
      { id: 'latency', pass: false, weight: 15, score: 4, issues: [] }
    ]
  };
  return model;
}

test('core reply routes require high-capability primary and same-tier fallback', () => {
  const primary = highModel('primary', 'provider-a');
  const fallback = highModel('fallback', 'provider-b');
  const plan = authority.routePlan({
    task: 'quick_reply',
    route: { primary: primary.id, fallback: fallback.id },
    models: [primary, fallback]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.READY);
  assert.equal(plan.highCapabilityPathReady, true);
  assert.equal(plan.primary.qualityTier, authority.QUALITY_TIER.HIGH);
  assert.equal(plan.fallback.qualityTier, authority.QUALITY_TIER.HIGH);
  assert.deepEqual(plan.violations, []);
});

test('a weaker fallback does not count as reliable continuity for a high primary', () => {
  const primary = highModel('primary');
  const fallback = conditionalModel('fallback');
  const plan = authority.routePlan({
    task: 'quick_reply',
    route: { primary: primary.id, fallback: fallback.id, allowConditional: true },
    models: [primary, fallback]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.DEGRADED);
  assert.equal(plan.highCapabilityPathReady, false);
  assert.equal(plan.violations[0].code, 'AI_QUALITY_SAME_TIER_FALLBACK_MISSING');
});

test('conditional trial remains visible and requires human review', () => {
  const primary = conditionalModel('trial-a');
  const fallback = conditionalModel('trial-b');
  const plan = authority.routePlan({
    task: 'quick_reply',
    route: { primary: primary.id, fallback: fallback.id, allowConditional: true },
    models: [primary, fallback]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.CONDITIONAL);
  assert.equal(plan.humanReviewRequired, true);
  assert.equal(plan.pass, false);
});

test('emergency output is explicitly isolated from long-term learning', () => {
  const primary = highModel('primary');
  const fallback = highModel('fallback');
  const emergency = conditionalModel('emergency');
  const plan = authority.routePlan({
    task: 'quick_reply',
    route: { primary: primary.id, fallback: fallback.id, emergency: emergency.id, allowEmergency: true },
    models: [primary, fallback, emergency]
  });
  const receipt = authority.routeReceipt({
    task: 'quick_reply',
    selectedModel: emergency,
    routePlan: plan,
    fallbackUsed: true,
    emergencyMode: true,
    attempts: [{ modelId: 'primary', status: 'failed', code: 'RATE_LIMITED', qualityTier: 'high' }]
  });
  assert.equal(receipt.emergencyMode, true);
  assert.equal(receipt.learningEligible, false);
  assert.equal(receipt.qualityDegraded, true);
  assert.match(receipt.receiptHash, /^[a-f0-9]{64}$/);
});

test('failure classification prefers same-tier recovery actions', () => {
  assert.equal(authority.classifyFailure({ status: 404 }).action, 'switch_same_tier');
  assert.equal(authority.classifyFailure({ status: 429 }).action, 'switch_provider_or_backoff_same_tier');
  assert.equal(authority.classifyFailure({ code: 'JSON_SCHEMA_INVALID' }).action, 'correct_once_then_switch_same_tier');
  assert.equal(authority.classifyFailure({ code: 'MODEL_TIMEOUT' }).action, 'reduce_context_then_switch_low_latency_same_tier');
});

test('translation quality is evaluated independently from social reply quality', () => {
  const translator = {
    id: 'translator', name: 'translator', provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['translation'],
    lastCommercialBenchmark: { completed: true, qualifyingTasks: ['translation'] }
  };
  assert.equal(authority.qualityTierForModel(translator, 'translation'), authority.QUALITY_TIER.QUALIFIED);
  assert.equal(authority.qualityTierForModel(translator, 'quick_reply'), authority.QUALITY_TIER.BLOCKED);
  const coverage = authority.capabilityCoverage(translator, 'translation');
  assert.equal(coverage.pass, true);
});

test('learning synthesis can reach high tier only through a fully qualified director-grade model', () => {
  const primary = highModel('synthesis-primary', 'provider-a');
  const fallback = highModel('synthesis-fallback', 'provider-b');
  primary.allowedTasks.push('learning_synthesis');
  fallback.allowedTasks.push('learning_synthesis');
  primary.capabilityTags = ['social_dialogue_high', 'relationship_reasoning', 'json_schema_strict'];
  fallback.capabilityTags = ['social_dialogue_high', 'relationship_reasoning', 'json_schema_strict'];
  const plan = authority.routePlan({
    task: 'learning_synthesis',
    route: { primary: primary.id, fallback: fallback.id },
    models: [primary, fallback]
  });
  assert.equal(plan.state, authority.ROUTE_STATE.READY);
  assert.equal(plan.highCapabilityPathReady, true);
  assert.equal(plan.primary.qualityTier, authority.QUALITY_TIER.HIGH);
  assert.equal(plan.fallback.qualityTier, authority.QUALITY_TIER.HIGH);
});
