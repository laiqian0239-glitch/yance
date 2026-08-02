'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('FIX6N delivery declares a real model-routing authority without weakening production qualification', () => {
  const report = read('YANCE_BATCH41_FIX6N_MODEL_SERVICE_TASK_ROUTING_AUTHORITY_REPORT_ZH.md');
  const design = read('docs/superpowers/specs/2026-08-01-fix6n-model-service-task-routing-authority-design.md');
  const gateway = read('backend/services/aiGateway.js');
  const authority = read('backend/services/modelServiceTaskRoutingAuthority.js');
  const onboarding = read('backend/services/openRouterOnboardingSmokeService.js');

  assert.match(authority, /ModelServiceTaskRoutingAuthority/);
  assert.match(authority, /fallbackAllowed/);
  assert.match(authority, /retryAfterMs/);
  assert.match(gateway, /totalBudgetMs/);
  assert.match(gateway, /remainingBudgetMs/);
  assert.match(gateway, /cooldownUntil: nextRetryAt/);
  assert.match(onboarding, /translation: \{ \.\.\.base/);
  assert.match(report, /正式回复与翻译生产资格继续严格阻断/);
  assert.match(design, /备用模型必须位于不同供应商故障域/);
});

test('FIX6N Windows checklist requires provider receipts, failure injection and restart persistence', () => {
  const checklist = read('YANCE_BATCH41_FIX6N_REAL_WINDOWS_UAT_CHECKLIST_ZH.md');
  for (const evidence of [
    'providerRequestId',
    '主模型 429',
    '普通 400/认证错误',
    '取消和晚到结果',
    '重启后冷却仍有效',
    'realWindowsUat'
  ]) assert.match(checklist, new RegExp(evidence));
});
