'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const analysisAuthority = require('../services/aiAnalysisResultAuthority');
const taskReadinessAuthority = require('../services/aiTaskRoleReadinessAuthority');
const replyBrainAuthority = require('../services/replyBrainModelAuthority');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function qualifiedModel(id, tasks = taskReadinessAuthority.CORE_AI_TASKS, provider = 'openai-compatible', modelSlug = '') {
  const allowedTasks = [...new Set([...tasks, 'quick_reply', 'deep_reply', 'director'])];
  const commercialEvidence = {
    authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z',
    completed: true, pass: true, score: 95, qualifyingTasks: [...new Set([...tasks, 'translation'])], translationScore: 95, evidenceScore: 95
  };
  const replyEvidence = {
    authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z',
    completed: true, pass: true, score: 94, qualifyingTasks: ['quick_reply', 'deep_reply', 'director'], scenarios: []
  };
  const receipts = {};
  for (const task of roleReceipts.GOVERNED_TASKS) {
    if (!allowedTasks.includes(task)) continue;
    const evidence = task === 'translation' ? commercialEvidence : replyEvidence;
    receipts[task] = roleReceipts.issueFromEvidence({ modelId: id, task, evidence, expiresAt: '2030-01-01T00:00:00.000Z' });
  }
  return {
    id,
    name: `general-${id}`,
    provider,
    modelSlug,
    available: true,
    qualification: 'verified',
    allowedTasks,
    lastTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true }, translation: { pass: true } } },
    lastCommercialBenchmark: commercialEvidence,
    lastReplyBrainBenchmark: replyEvidence,
    roleQualificationReceipts: receipts
  };
}

function completeAnalysis() {
  return {
    summary: '对方正在介绍自己的情况。',
    intent: '继续相互了解',
    hiddenNeed: '希望获得自然回应',
    dimensions: { emotion: '开放', relationship: '初识', topic: '个人资料', risk: '低', opportunity: '继续了解' },
    risk: { score: 10, reason: '没有明显风险' },
    opportunity: { score: 70, reason: '愿意继续交流' },
    strategy: { title: '自然回应并轻度筛选' },
    evidence: [{ messageId: 'm1', quote: 'Ich bin 65.' }]
  };
}

test('analysis result authority rejects empty output and produces a committed auditable receipt for complete output', () => {
  assert.throws(
    () => analysisAuthority.normalize({ text: 'not-json' }),
    error => error.code === 'INVALID_AI_ANALYSIS_RESULT' && error.status === 502
  );
  const normalized = analysisAuthority.normalize({ structured: { analysis: completeAnalysis(), profile: {}, insights: {} } });
  assert.equal(normalized.completeness.complete, true);
  assert.match(normalized.envelopeSha256, /^[a-f0-9]{64}$/);
  const receipt = analysisAuthority.executionReceipt({
    runId: 'run-1',
    state: 'completed',
    transactionCommitted: true,
    modelId: 'model-a',
    modelName: 'Model A',
    normalized,
    schemaRepair: { attempted: true, succeeded: true, requestedModelId: 'model-a', selectedModelId: 'model-a' },
    attempts: [{ modelId: 'model-a', status: 'completed' }],
    completedAt: '2026-07-27T12:00:00.000Z'
  });
  assert.equal(receipt.transactionCommitted, true);
  assert.equal(receipt.completeness.complete, true);
  assert.equal(receipt.schemaRepair.succeeded, true);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
});

test('translation readiness requires hard commercial qualification and never fabricates primary/fallback routing', () => {
  const primary = qualifiedModel('translation-primary', taskReadinessAuthority.CORE_AI_TASKS, 'openrouter', 'anthropic/translation-primary');
  // Translation is gated by hard commercial benchmark evidence, not by a physical primary/fallback route.
  assert.equal(replyBrainAuthority.translationBenchmarkPass(primary), true);
  assert.equal(replyBrainAuthority.translationStatus(primary).pass, true);

  const unqualified = {
    ...primary,
    id: 'translation-unqualified',
    allowedTasks: primary.allowedTasks.filter(task => task !== 'translation'),
    lastCommercialBenchmark: { ...primary.lastCommercialBenchmark, pass: false }
  };
  assert.equal(replyBrainAuthority.translationBenchmarkPass(unqualified), false);
  assert.equal(replyBrainAuthority.translationStatus(unqualified).pass, false);

  // The retired physical primary/fallback route shape must not be resurrected by reply-brain evaluation,
  // and no task may demand a distinct fallback model anymore.
  const result = replyBrainAuthority.evaluate([primary]);
  assert.equal(result.translation, undefined);
  assert.equal(result.primaryQualityPass, undefined);
  assert.equal(result.fallbackDistinct, undefined);
  assert.deepEqual(taskReadinessAuthority.REDUNDANCY_REQUIRED_TASKS, []);
});

test('core AI readiness is driven by hard-qualified capability count and Model Brain runtime, not physical routes', () => {
  const primary = qualifiedModel('primary');
  const fallback = qualifiedModel('fallback');
  const runtime = { health: 'ok', runtimeAvailable: true };
  let readiness = taskReadinessAuthority.evaluate({ models: [primary, fallback], modelBrainRuntime: runtime });
  assert.equal(readiness.pass, true);
  assert.equal(readiness.operational, readiness.coreTasks.length);
  assert.equal(readiness.configured, readiness.coreTasks.length);
  assert.ok(readiness.tasks.every(row => row.ready === true && row.capabilityCount > 0));
  // Distinct-fallback redundancy is retired: there is no per-task resilient flag and an empty redundancy set.
  assert.equal(readiness.resilient, undefined);
  assert.deepEqual(taskReadinessAuthority.REDUNDANCY_REQUIRED_TASKS, []);

  // With no hard-qualified model every task reports the stable no-capability reason and readiness fails closed.
  readiness = taskReadinessAuthority.evaluate({ models: [], modelBrainRuntime: runtime });
  const director = readiness.tasks.find(row => row.task === 'director');
  assert.equal(director.ready, false);
  assert.equal(director.reason, 'no-hard-qualified-capability');
  assert.equal(readiness.pass, false);
  assert.equal(readiness.operational, 0);
});

test('workspace analysis and frontend use terminal receipts instead of unconditional success text', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '../repositories/workspaceRepository.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(workspace, /onlyRequestedModel: true/u);
  assert.match(workspace, /analysisReceipt: failedReceipt/u);
  assert.match(workspace, /transactionCommitted: false/u);
  assert.match(frontend, /AI_ANALYSIS_TRANSACTION_UNCONFIRMED/u);
  assert.match(frontend, /未进入导演与候选阶段/u);
  assert.match(frontend, /receiptState\.complete/u);
});
