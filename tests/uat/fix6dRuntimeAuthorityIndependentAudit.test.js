'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const credentialReceipt = require('../../frontend/js/r32-credential-mutation-receipt');
const capabilityAuthority = require('../../backend/services/modelCapabilityAuthority');
const onboarding = require('../../backend/services/openRouterOnboardingSmokeService');
const roleReceipts = require('../../backend/services/aiRoleQualificationReceiptAuthority');
const { RuntimeDomainIsolationAuthority } = require('../../backend/services/runtimeDomainIsolationAuthority');
const { RuntimeSafetySupervisor } = require('../../backend/services/runtimeSafetySupervisor');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { createAuthorityHarness, envelope } = require('../wp5/helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function validInference(model, overrides = {}) {
  return {
    text: JSON.stringify({
      director: { goal: '自然回应', strategy: '短句承接', avoid: ['不虚构事实'] },
      candidates: [
        { text: 'Hallo, wie war dein Tag?', translationZh: '你好，你今天过得怎么样？', direction: '自然' },
        { text: 'Die Rose macht dein Hallo besonders. Was machst du gerade?', translationZh: '玫瑰让你的问候很特别。你现在在做什么？', direction: '轻松' },
        { text: 'Hallo du. Was hat dich heute zum Lächeln gebracht?', translationZh: '你好呀。今天什么让你笑了？', direction: '温和' }
      ],
      translationZh: '你好，附带一朵玫瑰。',
      fabricatedFacts: []
    }),
    totalMs: 50,
    firstTokenMs: 10,
    promptTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    returnedModel: model.name,
    requestMode: 'chat-completions-standard',
    raw: { id: `req-${model.id}` },
    ...overrides
  };
}

function cloud(id, name) {
  return { id, name, provider: 'openai-compatible', source: 'openrouter-auto', available: true, credentialRef: 'model:openrouter:default' };
}

function fakeRegistry(models) {
  const state = { models: models.map(model => ({ ...model })), routes: {}, openRouter: { keyFingerprint: 'sha256:audit' } };
  return {
    state,
    read: () => state,
    async recordInvocation() {},
    async recordInvocationFailure() {},
    async recordReplyBrainBenchmark() {},
    async recordTest() {},
    async recordOpenRouterOnboardingSmoke() {},
    async applyOpenRouterConditionalRoutes(routes) { state.routes = routes; return state; }
  };
}

function supervisorWith(modelStatus) {
  return new RuntimeSafetySupervisor({
    runtime: { operatingMode: 'normal', async enterSafeMode() { this.operatingMode = 'safeMode'; } },
    domainIsolation: new RuntimeDomainIsolationAuthority(),
    sendQueue: { status: () => ({ resumeBlocked: false, outcomeUnknown: 0 }) },
    modelStatus,
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 0 } }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} }
  });
}

test('credential success requires an explicit durable commit and explicit runtime confirmation', () => {
  for (const input of [
    { ok: true },
    { ok: true, mutationCommitted: false, runtimeConfirmed: true },
    { ok: true, mutationCommitted: true, runtimeConfirmed: false }
  ]) {
    assert.throws(() => credentialReceipt.assertSaved(input));
  }
  assert.equal(credentialReceipt.assertSaved({ ok: true, mutationCommitted: true, runtimeConfirmed: true }).ok, true);
});

test('batch-only capability fails closed for every declared runtime task and unknown tasks', () => {
  const batch = { id: 'batch', name: 'vendor/model:batch', allowedTasks: ['material_analysis', 'speech_transcription', 'future_task'] };
  for (const task of ['material_analysis', 'speech_transcription', 'future_task']) {
    assert.equal(capabilityAuthority.supportsTask(batch, task), false, task);
  }
  assert.equal(capabilityAuthority.supportsTask({ id: 'chat', name: 'vendor/chat' }, 'future_task'), false);
});

test('OpenRouter independent fallback is unique by normalized model slug, not registry id', async () => {
  const registry = fakeRegistry([
    cloud('same-a', 'vendor/same-model'),
    cloud('same-b', 'vendor/same-model'),
    cloud('independent-c', 'vendor/independent-model')
  ]);
  const result = await onboarding.run({
    registry,
    maxCandidates: 3,
    snapshot: { selections: { quick_reply: [{ id: 'vendor/same-model' }] } },
    executeModel: async model => validInference(model)
  });
  assert.equal(result.pass, true);
  assert.notEqual(result.primaryModelSlug, result.fallbackModelSlug);
  assert.equal(result.fallbackModelId, 'independent-c');
});

test('OpenRouter smoke cannot pass without a real chat-completions request id', async () => {
  const registry = fakeRegistry([cloud('a', 'vendor/a'), cloud('b', 'vendor/b')]);
  await assert.rejects(
    onboarding.run({
      registry,
      snapshot: { selections: {} },
      executeModel: async model => model.id === 'a'
        ? validInference(model, { raw: {}, requestMode: 'chat-completions-standard' })
        : validInference(model)
    }),
    error => error?.code === 'OPENROUTER_ONBOARDING_SMOKE_INCOMPLETE'
      && error.results?.some(row => row.modelId === 'a' && row.pass === false && row.code === 'OPENROUTER_SMOKE_REQUEST_RECEIPT_INVALID')
  );
});

test('governed receipt issuance requires completed formal evidence', () => {
  assert.throws(
    () => roleReceipts.issueFromEvidence({
      modelId: 'm1', task: 'translation',
      evidence: { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', pass: true, qualifyingTasks: ['translation'] }
    }),
    error => error?.code === 'ROLE_RECEIPT_BENCHMARK_INCOMPLETE'
  );
});

test('governed receipt is cryptographically bound to the current model benchmark', () => {
  const evidence = {
    authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED',
    completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], summary: 'baseline-a', testedAt: '2026-07-31T10:00:00.000Z'
  };
  const model = { id: 'm1', lastCommercialBenchmark: evidence };
  const receipt = roleReceipts.issueFromEvidence({ modelId: model.id, task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' });
  model.roleQualificationReceipts = { translation: receipt };
  assert.equal(roleReceipts.validate(model, 'translation', { now: '2026-07-31T12:00:00.000Z' }).pass, true);
  model.lastCommercialBenchmark = { ...evidence, summary: 'changed-benchmark' };
  const stale = roleReceipts.validate(model, 'translation', { now: '2026-07-31T12:00:00.000Z' });
  assert.equal(stale.pass, false);
  assert.equal(stale.reason, 'ROLE_RECEIPT_EVIDENCE_MISMATCH');
});

test('handcrafted receipt cannot bypass current benchmark authority', () => {
  const model = {
    id: 'm1',
    lastCommercialBenchmark: {
      authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED',
      completed: true, pass: true, score: 90, qualifyingTasks: ['translation']
    },
    roleQualificationReceipts: {
      translation: {
        schemaVersion: 1, authority: 'AIRoleQualificationReceiptAuthority', receiptId: 'forged',
        modelId: 'm1', task: 'translation', pass: true, score: 90,
        issuedAt: '2026-07-31T10:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z',
        evidenceSha256: 'a'.repeat(64), benchmarkAuthority: 'YanceCommercialModelBenchmark',
        benchmarkStatus: 'COMMERCIAL_MODEL_QUALIFIED'
      }
    }
  };
  assert.equal(roleReceipts.validate(model, 'translation', { now: '2026-07-31T12:00:00.000Z' }).pass, false);
});

test('AI route status authority failure isolates AI automation without global safe mode', async () => {
  const supervisor = supervisorWith({ read() { throw Object.assign(new Error('sqlite unavailable'), { code: 'SQLITE_BUSY' }); } });
  await supervisor.evaluate();
  const snapshot = supervisor.snapshot();
  assert.equal(snapshot.aiAutomationBlocked, true);
  assert.equal(snapshot.globalWriteBlocked, false);
  assert.deepEqual(snapshot.aiIsolationReasons, ['MODEL_ROUTE_STATUS_UNAVAILABLE']);
});

test('AI brain model selection delegates to the shared routing integrity authority', () => {
  const code = source('backend/services/aiBrainOrchestrator.js');
  assert.match(code, /modelRoutingIntegrityService/u);
  assert.match(code, /eligibleForTask\(model,\s*task/u);
});

test('safe-mode metadata derives complete atomic diagnostics from the command envelope', async () => {
  const h = await createAuthorityHarness();
  try {
    const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership });
    const command = envelope({ commandId: 'audit-safe-mode', expectedStateVersion: 1, operatingMode: 'safeMode', reason: 'SYSTEM_LEDGER_MISMATCH', source: 'audit-injection' });
    await gateway.transition({ targetMode: 'safeMode', commandId: command.commandId, envelope: command });
    const authority = h.store.getOperatingModeAuthority();
    assert.equal(authority.reasonCode, 'SYSTEM_LEDGER_MISMATCH');
    assert.deepEqual(authority.reasons, ['SYSTEM_LEDGER_MISMATCH']);
    assert.equal(authority.trigger, 'audit-injection');
    assert.equal(authority.updatedBy, 'audit-injection');
    assert.match(authority.enteredAt, /^202/u);
    assert.match(authority.evidenceSha256, /^[a-f0-9]{64}$/u);
  } finally { await h.close(); }
});
