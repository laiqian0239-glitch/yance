'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '../..');

function conditionalService(id, task) {
  return {
    id,
    taskQualifications: {
      [task]: { selectable: true, full: false, state: 'conditional' }
    }
  };
}

test('route test projection preserves automatic requested intent and carries current resolved conditional models', () => {
  const authority = require('../../frontend/js/r32-route-draft-authority');
  const task = 'quick_reply';
  const route = {
    id: task,
    main: 'auto',
    backup: 'auto',
    actualMain: 'openrouter-primary',
    actualBackup: 'openrouter-fallback',
    enabled: true,
    requestedEnabled: true,
    allowConditional: true,
    humanReviewRequired: true,
    limit: 220,
    timeoutMs: 180000
  };

  const projected = authority.project(route, [
    conditionalService('openrouter-primary', task),
    conditionalService('openrouter-fallback', task)
  ], { purpose: 'test' });

  assert.equal(projected.requested.primary.mode, 'auto');
  assert.equal(projected.requested.primary.modelId, '');
  assert.equal(projected.requested.fallback.mode, 'auto');
  assert.equal(projected.resolved.primary.modelId, 'openrouter-primary');
  assert.equal(projected.resolved.fallback.modelId, 'openrouter-fallback');
  assert.equal(projected.primary, 'openrouter-primary');
  assert.equal(projected.fallback, 'openrouter-fallback');
  assert.equal(projected.allowConditional, true);
  assert.equal(projected.humanReviewRequired, true);
});

test('route persistence projection does not turn automatic resolved models into manual requested selections', () => {
  const authority = require('../../frontend/js/r32-route-draft-authority');
  const route = {
    id: 'director',
    main: 'auto',
    backup: 'auto',
    actualMain: 'openrouter-primary',
    actualBackup: 'openrouter-fallback',
    enabled: true,
    allowConditional: true,
    limit: 360,
    timeoutMs: 180000
  };

  const projected = authority.project(route, [], { purpose: 'persist' });

  assert.equal(projected.primary, '');
  assert.equal(projected.fallback, '');
  assert.deepEqual(projected.requested.primary, { mode: 'auto', modelId: '' });
  assert.deepEqual(projected.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(Object.prototype.hasOwnProperty.call(projected, 'resolved'), false);
});

test('route draft authority preserves per-task timeout floors defaults and ceilings', () => {
  const authority = require('../../frontend/js/r32-route-draft-authority');

  assert.equal(authority.normalizeTimeoutMs('quick_reply', 1000), 180000);
  assert.equal(authority.normalizeTimeoutMs('quick_reply', 0), 180000);
  assert.equal(authority.normalizeTimeoutMs('deep_reply', undefined), 300000);
  assert.equal(authority.normalizeTimeoutMs('deep_reply', 9999999), 1200000);
  assert.equal(authority.normalizeTimeoutMs('understanding', 360000), 360000);

  const projected = authority.project({
    id: 'deep_reply',
    main: 'auto',
    backup: 'auto',
    timeoutMs: 1000
  }, [], { purpose: 'persist' });
  assert.equal(projected.timeoutMs, 240000);
});

test('OpenRouter presentation distinguishes missing quota from a real zero balance', () => {
  const authority = require('../../frontend/js/r32-openrouter-presentation-authority');

  assert.equal(authority.formatMoney(null), '未返回');
  assert.equal(authority.formatMoney(undefined), '未返回');
  assert.equal(authority.formatMoney(''), '未返回');
  assert.equal(authority.formatMoney(0), '$0.0000');
  assert.equal(authority.formatMoney('0'), '$0.0000');
  assert.equal(authority.formatMoney(12.5), '$12.50');
});

test('OpenRouter presentation keeps onboarding smoke separate from formal qualification', () => {
  const authority = require('../../frontend/js/r32-openrouter-presentation-authority');
  const projected = authority.project({
    connectionState: 'conditional-ready',
    authenticationStatus: 'passed',
    catalogStatus: 'passed',
    onboardingSmokeStatus: 'passed',
    routeStatus: 'conditional-ready',
    formalQualificationStatus: 'pending',
    key: { limitRemaining: null, usageDaily: 0 }
  });

  assert.equal(projected.connected, true);
  assert.equal(projected.connectionLabel, '条件接入已完成');
  assert.equal(projected.smokeLabel, '双模型真实调用已通过');
  assert.equal(projected.formalLabel, '正式专项评估未运行');
  assert.equal(projected.formalCompleted, false);
  assert.equal(projected.limitRemainingLabel, '未返回');
});

test('AI workbench integrates shared authorities and does not auto-enable global automation during OpenRouter onboarding', () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const start = source.indexOf('async function autoConfigureOpenRouter()');
  const end = source.indexOf('async function runOpenRouterCommercialBenchmark()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(html, /r32-route-draft-authority\.js/u);
  assert.match(html, /r32-openrouter-presentation-authority\.js/u);
  assert.match(source, /YanceRouteDraftAuthority/u);
  assert.match(source, /YanceOpenRouterPresentationAuthority/u);
  assert.match(source, /routeDraftPayload\(r,'test'\)/u);
  assert.match(body, /projectModelRuntimeSnapshot\(status,state/u);
  assert.match(body, /commitModelRuntimeSnapshot\(modelSnapshot/u);
  assert.doesNotMatch(body, /\/api\/r32\/workspace\/ai-automation/u);
  assert.doesNotMatch(body, /state\.services\s*=\s*registryServices/u);
  assert.doesNotMatch(body, /state\.openRouter\s*=\s*snap/u);
  assert.match(body, /renderPanel\(state\.tab\)/u);
});

test('OpenRouter onboarding backend reports automation state without mutating global automation', () => {
  const routesSource = fs.readFileSync(path.join(ROOT, 'backend/routes/models.js'), 'utf8');
  const start = routesSource.indexOf("router.post('/cloud/openrouter/auto-configure'");
  const end = routesSource.indexOf("router.get('/cloud/openrouter/status'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = routesSource.slice(start, end);

  assert.doesNotMatch(body, /aiAutomation\.updateConfig/u);
  assert.match(body, /const automationStatus = aiAutomation\.status\(\)/u);
  assert.match(body, /automationChanged: false/u);
  assert.match(body, /OPENROUTER_ONBOARDING_DOES_NOT_MUTATE_GLOBAL_AUTOMATION/u);
});

test('derived source identity descriptor preserves prior repair authorities and declares FIX6K OpenRouter authorities', () => {
  const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6k-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fixture\n');
    createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6K_TEST',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T00:00:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    assert.equal(descriptor.repairAuthority.sqliteFreeModelWorkerAuthority, true);
    assert.equal(descriptor.repairAuthority.versionedModelExecutionEnvelopeAuthority, true);
    assert.equal(descriptor.repairAuthority.openRouterOnboardingStateAuthority, true);
    assert.equal(descriptor.repairAuthority.routeDraftProjectionAuthority, true);
    assert.equal(descriptor.repairAuthority.openRouterPresentationAuthority, true);
    assert.equal(descriptor.repairAuthority.onboardingAutomationNonMutationAuthority, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenRouter presentation recognizes a completed formal benchmark even when legacy qualification state remains pending', () => {
  const authority = require('../../frontend/js/r32-openrouter-presentation-authority');
  const projected = authority.project({
    connectionState: 'conditional-ready',
    formalQualificationStatus: 'pending',
    benchmarkStatus: 'completed'
  });

  assert.equal(projected.formalStatus, 'completed');
  assert.equal(projected.formalCompleted, true);
  assert.equal(projected.formalLabel, '正式专项评估已完成');
});

test('automatic conditional route test projection is accepted by the backend routing authority', () => {
  const draftAuthority = require('../../frontend/js/r32-route-draft-authority');
  const routing = require('../services/modelRoutingIntegrityService');
  const testedAt = '2026-08-01T00:00:00.000Z';
  const benchmark = score => ({
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_FAILED',
    completed: true,
    pass: false,
    score,
    testedAt,
    qualifyingTasks: [],
    scenarios: []
  });
  const models = [
    {
      id: 'openrouter-primary', name: 'Primary', provider: 'anthropic', modelSlug: 'anthropic/primary',
      available: true, qualification: 'verified', allowedTasks: ['understanding'], callCount: 3,
      lastSuccessfulInvocation: { at: testedAt }, lastReplyBrainBenchmark: benchmark(65)
    },
    {
      id: 'openrouter-fallback', name: 'Fallback', provider: 'openai', modelSlug: 'openai/fallback',
      available: true, qualification: 'verified', allowedTasks: ['understanding'], callCount: 3,
      lastSuccessfulInvocation: { at: testedAt }, lastReplyBrainBenchmark: benchmark(62)
    }
  ];
  const services = models.map(model => ({
    id: model.id,
    taskQualifications: { quick_reply: { selectable: true, full: false } }
  }));
  const routeDraft = draftAuthority.project({
    id: 'quick_reply',
    main: 'auto',
    backup: 'auto',
    actualMain: 'openrouter-primary',
    actualBackup: 'openrouter-fallback',
    requestedEnabled: true,
    allowConditional: true,
    humanReviewRequired: true,
    limit: 220,
    timeoutMs: 180000
  }, services, { purpose: 'test' });

  const route = routing.validateRoutes({ quick_reply: routeDraft }, models, {
    throwOnInvalid: true,
    autoSelect: true
  }).repairedRoutes.quick_reply;

  assert.ok(route.primary);
  assert.ok(route.fallback);
  assert.notEqual(route.primary, route.fallback);
  assert.equal(route.enabled, true);
  assert.equal(route.allowConditional, true);
  assert.equal(route.humanReviewRequired, true);
});

test('OpenRouter onboarding candidates are never presented as final model recommendations before formal evaluation', () => {
  const authority = require('../../frontend/js/r32-openrouter-presentation-authority');
  const projected = authority.project({
    connectionState: 'conditional-ready',
    onboardingPrimaryModelSlug: 'anthropic/claude-opus-5',
    onboardingFallbackModelSlug: 'openai/gpt-5.6-sol',
    formalQualificationStatus: 'pending'
  });
  assert.equal(projected.candidateOnly, true);
  assert.equal(projected.primaryCandidateSlug, 'anthropic/claude-opus-5');
  assert.equal(projected.fallbackCandidateSlug, 'openai/gpt-5.6-sol');
  const source = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /接入候选 A/u);
  assert.match(source, /接入候选 B/u);
  assert.match(source, /不是言策正式冠军或正式备用/u);
  assert.doesNotMatch(source, /主模型 \$\{openRouter\.primarySlug/u);
});
