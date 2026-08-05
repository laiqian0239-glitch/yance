'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { installAuthoritySqliteTestHost } = require('./helpers/authoritySqliteTestHost');
const authoritySqliteTestHost = installAuthoritySqliteTestHost('fix6d-runtime-authority-repair');

const credentialReceipt = require('../../frontend/js/r32-credential-mutation-receipt');
const capabilityAuthority = require('../../backend/services/modelCapabilityAuthority');
const routingIntegrity = require('../../backend/services/modelRoutingIntegrityService');
const onboarding = require('../../backend/services/openRouterOnboardingSmokeService');
const roleReceipts = require('../../backend/services/aiRoleQualificationReceiptAuthority');
const readiness = require('../../backend/services/aiTaskRoleReadinessAuthority');
const { RuntimeDomainIsolationAuthority } = require('../../backend/services/runtimeDomainIsolationAuthority');
const { RuntimeSafetySupervisor } = require('../../backend/services/runtimeSafetySupervisor');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { createAuthorityHarness } = require('../wp5/helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test.after(() => authoritySqliteTestHost.close());

function validInference(model) {
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
    totalMs: 500,
    firstTokenMs: 200,
    promptTokens: 100,
    outputTokens: 150,
    totalTokens: 250,
    returnedModel: model.name,
    requestMode: 'chat-completions-standard',
    raw: { id: `req-${model.id}` }
  };
}

function fakeRegistry(models) {
  const state = { models: models.map(row => ({ ...row })), routes: {} };
  return {
    state,
    read() { return state; },
    async recordInvocation(id, result) { state.models.find(row => row.id === id).lastSuccessfulInvocation = { at: new Date().toISOString(), returnedModel: result.returnedModel }; },
    async recordInvocationFailure() {},
    async recordReplyBrainBenchmark(id, result) { state.models.find(row => row.id === id).lastReplyBrainBenchmark = result; },
    async recordCommercialBenchmark(id, result) { state.models.find(row => row.id === id).lastCommercialBenchmark = result; },
    async recordTest(id, result) { Object.assign(state.models.find(row => row.id === id), { qualification: result.qualification, allowedTasks: result.allowedTasks, lastTest: result }); },
    async recordOpenRouterOnboardingSmoke(id, result) { Object.assign(state.models.find(row => row.id === id), { openRouterOnboardingSmoke: result }); },
    async applyOpenRouterConditionalRoutes(routes) { state.routes = routes; return state; }
  };
}

function cloud(id, name = `vendor/${id}`) {
  return { id, name, provider: 'openai-compatible', source: 'openrouter-auto', available: true, credentialRef: 'model:openrouter:default' };
}

test('credential mutation receipt distinguishes durable commit from runtime confirmation failure', () => {
  assert.throws(
    () => credentialReceipt.assertSaved({ ok: false, mutationCommitted: true, runtimeConfirmed: false, requestId: 'req-1', reasonCode: 'INJECTED_BACKEND_START_FAILURE', message: 'backend restart failed' }),
    error => error.code === 'INJECTED_BACKEND_START_FAILURE'
      && error.mutationCommitted === true
      && error.requestId === 'req-1'
      && /已写入/u.test(error.message)
      && /运行时/u.test(error.message)
  );
  assert.throws(
    () => credentialReceipt.assertSaved({ ok: false, mutationCommitted: false, requestId: 'req-2', reasonCode: 'CREDENTIAL_VAULT_UNAVAILABLE', message: 'vault unavailable' }),
    error => error.code === 'CREDENTIAL_VAULT_UNAVAILABLE'
      && error.mutationCommitted === false
      && /未写入/u.test(error.message)
  );
  assert.equal(credentialReceipt.assertSaved({ ok: true, mutationCommitted: true, runtimeConfirmed: true, requestId: 'req-3' }).ok, true);
  const workbench = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(workbench, /YanceCredentialMutationReceipt\.assertSaved/u);
  assert.doesNotMatch(workbench, /error\.code='CREDENTIAL_SAVE_NOT_CONFIRMED'/u);
});

test('model capability authority excludes batch-only models from every interactive route', () => {
  const batch = { id: 'batch', name: 'anthropic/claude-opus-4.7:batch', available: true, qualification: 'verified', allowedTasks: ['director', 'translation', 'quick_reply'] };
  const profile = capabilityAuthority.classify(batch);
  assert.equal(profile.batchOnly, true);
  assert.equal(profile.interactiveChat, false);
  for (const task of ['director', 'translation', 'quick_reply']) {
    assert.equal(capabilityAuthority.supportsTask(batch, task), false);
    assert.equal(routingIntegrity.eligibleForTask(batch, task, { allowExperimental: true, allowConditional: true }), false);
  }
});

test('OpenRouter onboarding keeps trying eligible independent candidates until two real calls pass', async () => {
  const registry = fakeRegistry([cloud('cloud-a'), cloud('cloud-b'), cloud('cloud-c')]);
  const result = await onboarding.run({
    snapshot: { selections: { quick_reply: [{ id: 'vendor/cloud-a' }, { id: 'vendor/cloud-b' }, { id: 'vendor/cloud-c' }] } },
    registry,
    maxCandidates: 3,
    executeModel: async model => model.id === 'cloud-b' ? ({ ...validInference(model), text: '{"candidates":[]}' }) : validInference(model)
  });
  assert.equal(result.pass, true);
  assert.equal(result.primaryModelId, 'cloud-a');
  assert.equal(result.fallbackModelId, 'cloud-c');
  assert.equal(result.results.length, 3);
  assert.equal(result.results.find(row => row.modelId === 'cloud-b').pass, false);
  assert.equal(registry.state.routes.quick_reply.primary, 'cloud-a');
  assert.equal(registry.state.routes.quick_reply.fallback, 'cloud-c');
});

test('formal AI role eligibility requires a valid model-bound role receipt', () => {
  const model = {
    id: 'm1', name: 'vendor/model', available: true, qualification: 'verified', allowedTasks: ['translation'],
    lastCommercialBenchmark: { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', completed: true, pass: true, score: 91, qualifyingTasks: ['translation'] }
  };
  assert.equal(readiness.formalTaskEligible(model, 'translation', {}), false);
  const receipt = roleReceipts.issueFromEvidence({ modelId: 'm1', task: 'translation', pass: true, score: 91, evidence: model.lastCommercialBenchmark, issuedAt: '2026-07-31T10:00:00.000Z', expiresAt: '2027-07-31T10:00:00.000Z' });
  model.roleQualificationReceipts = { translation: receipt };
  assert.equal(roleReceipts.validate(model, 'translation', { now: '2026-07-31T12:00:00.000Z' }).pass, true);
  assert.equal(readiness.formalTaskEligible(model, 'translation', { now: '2026-07-31T12:00:00.000Z' }), true);
  const other = { ...model, id: 'm2' };
  assert.equal(roleReceipts.validate(other, 'translation', { now: '2026-07-31T12:00:00.000Z' }).pass, false);
});

test('AI route qualification blocker isolates AI automation without entering global safe mode', async () => {
  const transitions = [];
  const domainIsolation = new RuntimeDomainIsolationAuthority();
  const runtime = { operatingMode: 'normal', async enterSafeMode(reason, metadata) { transitions.push({ reason, metadata }); this.operatingMode = 'safeMode'; } };
  const supervisor = new RuntimeSafetySupervisor({
    runtime,
    domainIsolation,
    sendQueue: { status: () => ({ resumeBlocked: false, outcomeUnknown: 0 }) },
    modelStatus: { read: () => ({ routeIntegrity: { pass: false, invalidPersistedRouteCount: 1, quarantine: [{ task: 'director' }] } }) },
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 0 } }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} }
  });
  await supervisor.evaluate();
  assert.equal(transitions.length, 0);
  assert.equal(supervisor.snapshot().aiAutomationBlocked, true);
  assert.equal(supervisor.snapshot().globalWriteBlocked, false);
  assert.deepEqual(supervisor.snapshot().aiIsolationReasons, ['MODEL_ROUTE_QUALIFICATION_BLOCKED']);
});

test('unknown-send blocks only the send capability and preserves normal global mode', async () => {
  const transitions = [];
  const supervisor = new RuntimeSafetySupervisor({
    runtime: { operatingMode: 'normal', async enterSafeMode(reason, metadata) { transitions.push({ reason, metadata }); this.operatingMode = 'safeMode'; } },
    domainIsolation: new RuntimeDomainIsolationAuthority(),
    sendQueue: { status: () => ({ resumeBlocked: true, outcomeUnknown: 1, pausedReason: 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN' }) },
    modelStatus: { read: () => ({ routeIntegrity: { pass: true, invalidPersistedRouteCount: 0, quarantine: [] } }) },
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 0 } }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} }
  });
  await supervisor.evaluate();
  assert.equal(transitions.length, 0);
  const snapshot = supervisor.snapshot();
  assert.equal(snapshot.globalWriteBlocked, false);
  assert.equal(snapshot.capabilities.send.blocked, true);
  assert.deepEqual(snapshot.capabilities.send.reasons, ['SEND_OUTCOME_UNKNOWN']);
});

test('safe mode reason metadata is committed atomically with operating mode authority', async () => {
  const h = await createAuthorityHarness();
  try {
    const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership });
    await gateway.transition({
      targetMode: 'safeMode',
      reason: 'automatic:BACKGROUND_JOB_COUNT_MISMATCH',
      source: 'automatic-safety-supervisor',
      metadata: {
        reasonCode: 'BACKGROUND_JOB_COUNT_MISMATCH',
        reasons: ['BACKGROUND_JOB_COUNT_MISMATCH', 'SEND_OUTCOME_UNKNOWN'],
        trigger: 'runtime-safety-supervisor',
        actor: 'automatic-safety-supervisor',
        evidence: { counted: 4, total: 5 }
      }
    });
    const authority = h.store.getOperatingModeAuthority();
    assert.equal(authority.operatingMode, 'safeMode');
    assert.equal(authority.reasonCode, 'BACKGROUND_JOB_COUNT_MISMATCH');
    assert.deepEqual(authority.reasons, ['BACKGROUND_JOB_COUNT_MISMATCH', 'SEND_OUTCOME_UNKNOWN']);
    assert.equal(authority.trigger, 'runtime-safety-supervisor');
    assert.equal(authority.updatedBy, 'automatic-safety-supervisor');
    assert.match(authority.enteredAt, /^202/u);
    assert.match(authority.evidenceSha256, /^[a-f0-9]{64}$/u);
  } finally { await h.close(); }
});

test('only formal benchmark authorities may mint governed AI role receipts', () => {
  assert.equal(roleReceipts.evidenceAllowsIssuance('translation', {
    authority: 'OpenRouterOnboardingSmokeAuthority',
    status: 'OPENROUTER_TRANSLATION_SMOKE_PASSED',
    completed: true,
    pass: true,
    qualifyingTasks: ['translation']
  }).pass, false);
  assert.equal(roleReceipts.evidenceAllowsIssuance('translation', {
    authority: 'YanceCommercialModelBenchmark',
    status: 'COMMERCIAL_MODEL_QUALIFIED',
    completed: true,
    pass: true,
    qualifyingTasks: ['translation']
  }).pass, true);
  assert.equal(roleReceipts.evidenceAllowsIssuance('director', {
    authority: 'YanceReplyBrainOnboardingSmoke',
    status: 'REPLY_BRAIN_CONDITIONAL',
    completed: true,
    pass: true,
    qualifyingTasks: ['director']
  }).pass, false);
  assert.equal(roleReceipts.evidenceAllowsIssuance('director', {
    authority: 'YanceReplyBrainBenchmark',
    status: 'REPLY_BRAIN_QUALIFIED',
    completed: true,
    pass: true,
    qualifyingTasks: ['director']
  }).pass, true);
});

test('AI automation orchestrator consumes domain isolation authority before scheduling or processing', () => {
  const orchestrator = require('../../backend/services/aiBrainOrchestrator');
  assert.deepEqual(orchestrator.automationIsolationDecision({
    aiAutomationBlocked: true,
    aiIsolationReasons: ['MODEL_ROUTE_QUALIFICATION_BLOCKED']
  }), {
    blocked: true,
    reasons: ['MODEL_ROUTE_QUALIFICATION_BLOCKED'],
    reason: 'ai-domain-isolated'
  });
  const code = source('backend/services/aiBrainOrchestrator.js');
  assert.match(code, /automationIsolationDecision\(\)/u);
  assert.match(code, /ai-domain-isolated/u);
  assert.match(code, /aiAutomationBlocked/u);
});

test('OpenRouter UI preserves a committed credential receipt when runtime application is unconfirmed', () => {
  const workbench = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(workbench, /error\.mutationCommitted/u);
  assert.match(workbench, /API Key 已安全保存，但运行时应用确认失败/u);
});

test('governed formal routes cannot bypass receipt authority through the routing integrity layer', () => {
  const model = {
    id: 'route-model', name: 'vendor/route-model', available: true, qualification: 'verified', allowedTasks: ['translation'],
    lastCommercialBenchmark: { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', completed: true, pass: true, qualifyingTasks: ['translation'] }
  };
  assert.equal(routingIntegrity.eligibleForTask(model, 'translation', { allowConditional: false }), false);
  model.roleQualificationReceipts = {
    translation: roleReceipts.issueFromEvidence({ modelId: model.id, task: 'translation', pass: true, issuedAt: '2026-07-31T10:00:00.000Z', expiresAt: '2027-07-31T10:00:00.000Z', evidence: model.lastCommercialBenchmark })
  };
  assert.equal(routingIntegrity.eligibleForTask(model, 'translation', { allowConditional: false }), true);
});

test('domain isolation authority notifies automation consumers when AI isolation changes', () => {
  const authority = new RuntimeDomainIsolationAuthority({ clock: () => '2026-07-31T12:00:00.000Z' });
  const events = [];
  const unsubscribe = authority.subscribe(snapshot => events.push(snapshot));
  authority.evaluate([{ code: 'MODEL_ROUTE_QUALIFICATION_BLOCKED', severity: 'high', domain: 'ai', scope: 'ai-automation' }]);
  authority.evaluate([]);
  unsubscribe();
  assert.equal(events.length, 2);
  assert.equal(events[0].aiAutomationBlocked, true);
  assert.equal(events[1].aiAutomationBlocked, false);
  const orchestratorCode = source('backend/services/aiBrainOrchestrator.js');
  assert.match(orchestratorCode, /runtimeDomainIsolationAuthority\.subscribe/u);
  assert.match(orchestratorCode, /pauseAutomationForIsolation/u);
  assert.match(orchestratorCode, /AI_DOMAIN_ISOLATED/u);
});

test('allowConditional cannot downgrade a formally qualified reply model that lacks its durable receipt', () => {
  const formal = {
    id: 'formal-no-receipt', name: 'vendor/formal-no-receipt', available: true, qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'], runtimeAvailable: true,
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', completed: true, pass: true, score: 92,
      qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
      scenarios: [{ id: 'german_whatsapp', pass: true, weight: 1, score: 1 }, { id: 'english_whatsapp', pass: true, weight: 1, score: 1 }, { id: 'persona_boundary', pass: true, weight: 1, score: 1 }]
    }
  };
  assert.equal(routingIntegrity.eligibleForTask(formal, 'quick_reply', { allowConditional: true }), false);

  const conditional = {
    id: 'conditional', name: 'vendor/conditional', available: true, qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply'], runtimeAvailable: true,
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_CONDITIONAL', completed: true, pass: false, score: 75,
      qualifyingTasks: [],
      scenarios: [{ id: 'german_whatsapp', pass: true, weight: 1, score: 1 }, { id: 'english_whatsapp', pass: true, weight: 1, score: 1 }, { id: 'persona_boundary', pass: true, weight: 1, score: 1 }]
    }
  };
  assert.equal(routingIntegrity.eligibleForTask(conditional, 'quick_reply', { allowConditional: true }), true);
});

test('governed receipt issuance rejects onboarding or caller-provided pass flags without formal benchmark evidence', () => {
  assert.throws(
    () => roleReceipts.issueFromEvidence({
      modelId: 'unsafe', task: 'translation', pass: true,
      evidence: { authority: 'OpenRouterOnboardingSmokeAuthority', status: 'OPENROUTER_RUNTIME_READY', completed: true, pass: true, qualifyingTasks: ['translation'] }
    }),
    error => error?.code === 'ROLE_RECEIPT_TRANSLATION_AUTHORITY_INVALID'
  );
  const receipt = roleReceipts.issueFromEvidence({
    modelId: 'safe', task: 'translation', pass: true,
    evidence: { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', completed: true, pass: true, score: 94, qualifyingTasks: ['translation'] }
  });
  assert.equal(receipt.modelId, 'safe');
  assert.equal(receipt.task, 'translation');
  assert.equal(receipt.pass, true);
  const registrySource = source('backend/services/modelRegistry.js');
  assert.match(registrySource, /roleReceiptAuthority\.issueFromEvidence/u);
});
