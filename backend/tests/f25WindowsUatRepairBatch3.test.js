'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const modelProjection = require('../services/modelStatusProjection');
const { aiRoutingReadiness, aiTaskRoutingReadiness } = require('../services/diagnosticReadiness');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function qualifiedModel() {
  const tasks = [
    'translation', 'understanding', 'relationship', 'director',
    'quick_reply', 'deep_reply', 'fact_extraction', 'memory_extraction'
  ];
  const model = {
    id: 'verified-brain',
    name: 'qwen3.5:14b',
    provider: 'ollama',
    available: true,
    qualification: 'verified',
    allowedTasks: tasks,
    lastTest: {
      scores: {
        persona: { pass: true },
        hallucination: { pass: true },
        json: { pass: true },
        translation: { pass: true }
      }
    },
    lastCommercialBenchmark: {
      authority: 'YanceCommercialModelBenchmark',
      completed: true,
      pass: true,
      status: 'COMMERCIAL_MODEL_QUALIFIED',
      score: 95,
      qualifyingTasks: tasks,
      translationScore: 95,
      evidenceScore: 95
    },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      completed: true,
      pass: true,
      status: 'REPLY_BRAIN_QUALIFIED',
      score: 96,
      qualifyingTasks: ['quick_reply', 'deep_reply', 'director'],
      scenarios: []
    },
    lastSuccessfulInvocation: { at: new Date().toISOString() }
  };
  model.roleQualificationReceipts = Object.fromEntries(
    ['translation', 'quick_reply', 'deep_reply', 'director'].map(task => {
      const evidence = task === 'translation' ? model.lastCommercialBenchmark : model.lastReplyBrainBenchmark;
      return [task, roleReceipts.issueFromEvidence({
        modelId: model.id,
        task,
        score: Number(evidence.score || 0),
        issuedAt: '2026-07-31T10:00:00.000Z',
        expiresAt: '2027-07-31T10:00:00.000Z',
        evidence
      })];
    })
  );
  return model;
}

function completeRoutes(modelId = 'verified-brain') {
  return Object.fromEntries([
    'translation', 'understanding', 'relationship', 'director',
    'quick_reply', 'deep_reply', 'fact_extraction', 'memory_extraction'
  ].map(task => [task, { primary: modelId, fallback: '', enabled: true, requestedEnabled: true }]));
}

test('F25-D02/D14 raw persisted model routes remain visible as quarantine instead of being repaired into a false pass', () => {
  const model = qualifiedModel();
  const routes = completeRoutes(model.id);
  routes.summary = { primary: 'missing-model', enabled: true, requestedEnabled: true };

  const projected = modelProjection.project({ models: [model], routes });

  assert.equal(projected.routeIntegrity.pass, false);
  assert.equal(projected.routeIntegrity.invalidPersistedRouteCount, 1);
  assert.equal(projected.summary.invalidPersistedRoutes, 1);
  assert.equal(projected.summary.routesPersisted, 9);
  assert.equal(projected.summary.routesOperational, 8);
  assert.equal(projected.routes.summary.primary, '');
  assert.equal(projected.routeIntegrity.quarantine[0].task, 'summary');
  assert.equal(projected.routeIntegrity.quarantine[0].modelId, 'missing-model');
});

test('F25-D02/D14 AI readiness fails on invalid persisted routes even when the repaired runtime routes are otherwise complete', () => {
  const model = qualifiedModel();
  const routes = completeRoutes(model.id);
  const routeIntegrity = {
    authority: 'ModelRoutingIntegrityService',
    pass: false,
    invalidPersistedRouteCount: 1,
    quarantine: [{ task: 'summary', role: 'primary', modelId: 'missing-model' }]
  };
  const modelState = {
    models: [model],
    routes,
    routeIntegrity,
    replyBrain: { pass: true, userMessage: '回复大脑路由已完成' },
    summary: { verified: 1, routingEligible: 1 }
  };

  const replyReadiness = aiRoutingReadiness(modelState);
  const taskReadiness = aiTaskRoutingReadiness(modelState);

  assert.equal(replyReadiness.replyBrain.pass, true, 'control: repaired reply brain can otherwise be healthy');
  assert.equal(replyReadiness.pass, false, 'persisted route corruption must block reply readiness');
  assert.equal(taskReadiness.operational, 8, 'control: all eight core runtime tasks are operational');
  assert.equal(taskReadiness.pass, false, 'persisted route corruption must still block task readiness');
  assert.match(taskReadiness.summary, /不合格持久路由/u);
});

test('F25-D35/D40 every outbound enqueue path checks the unresolved-send gate before doing work', () => {
  const queue = read('backend/services/sendQueueService.js');
  assert.match(queue, /async enqueueText\(input = \{\}\) \{\s*this\.assertEnqueueAllowed\('text', input\);/u);
  assert.match(queue, /async enqueueAction\(input = \{\}\) \{\s*this\.assertEnqueueAllowed\(clean\(input\.operation, 'action'\), input\);/u);
  assert.match(queue, /async enqueueMedia\(input = \{\}\) \{\s*this\.assertEnqueueAllowed\('media', input\);/u);
  assert.match(queue, /async enqueueMediaFile\(input = \{\}\) \{\s*this\.assertEnqueueAllowed\('media-file', input\);/u);
  assert.match(queue, /SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED/u);
  assert.match(queue, /PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN/u);
});

test('F25-D02/D03 system health and diagnostics expose persisted-vs-operational route authority', () => {
  const diagnostics = read('backend/services/diagnosticsService.js');
  const system = read('backend/services/systemCenterService.js');
  const ui = read('frontend/r32-system-center.js');
  const workbench = read('frontend/js/r32-ai-workbench-runtime.js');

  assert.match(diagnostics, /routesPersisted/u);
  assert.match(diagnostics, /routesOperational/u);
  assert.match(diagnostics, /已阻止假通过/u);
  assert.match(system, /invalidPersistedRoutes/u);
  assert.match(system, /routeIntegrity\.pass !== false/u);
  assert.match(ui, /不合格已隔离/u);
  assert.match(ui, /持久路由存在不合格记录/u);
  assert.match(workbench, /invalidPersistedRoutes/u);
});

test('F25-D35/D39/D40 system center projects unresolved sends into issues and the effective write gate', () => {
  const system = read('backend/services/systemCenterService.js');
  const ui = read('frontend/r32-system-center.js');

  assert.match(system, /send-outcome-unknown-write-block/u);
  assert.match(system, /发送结果不确定，已阻止新增出站写入/u);
  assert.match(system, /writeGate: policy\.emergencyStop \|\| safeModeService\.isActive\(\) \|\| sendQueueState\.writeBlocked \|\| safetySupervisor\.globalWriteBlocked \? 'blocked' : 'open'/u);
  assert.match(system, /writeGateReasons/u);
  assert.match(ui, /effectiveWriteBlocked = s\.writeGate === 'blocked'/u);
  assert.match(ui, /await refresh\(false\)/u, 'policy changes must refresh the authoritative backend gate instead of forcing it open locally');
});

test('F25-D03 invalid-route integrity events have stable task-role-model identity and are deduplicated', () => {
  const monitor = read('backend/store/StoreIntegrityMonitor.js');
  assert.match(monitor, /function violationIdentity/u);
  assert.match(monitor, /entityId: `\$\{task\}:\$\{role\}:\$\{modelId\}`/u);
  assert.match(monitor, /const uniqueViolations = dedupeViolations\(violations\)/u);
  assert.match(monitor, /detail: `\$\{task\} · \$\{role\} → \$\{modelId\}`/u);
});
