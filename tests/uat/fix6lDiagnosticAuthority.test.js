'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const summaryAuthority = require('../../frontend/js/r32-diagnostic-summary-authority');
const diagnosticsService = require('../../backend/services/diagnosticsService');

test('workspace all-green cannot override backend warning and failure', () => {
  const workspace = Array.from({ length: 9 }, (_, index) => ({ name: `workspace-${index}`, status: 'pass', detail: 'ok' }));
  const backend = {
    tests: [
      { id: 'openrouter-runtime-readiness', name: 'OpenRouter真实接入与候选路由', status: 'warning', detail: '正式专项待完成' },
      { id: 'ai-routing-readiness', name: 'AI 回复大脑任务路由完整', status: 'fail', detail: '翻译路由缺失' },
      { id: 'account-runtime-readiness', name: '账号真实连接与凭据状态', status: 'skipped', detail: '尚无活动账号' }
    ]
  };
  const merged = summaryAuthority.merge(workspace, backend);
  assert.equal(merged.summary.pass, 9);
  assert.equal(merged.summary.warn, 1);
  assert.equal(merged.summary.fail, 1);
  assert.equal(merged.summary.skipped, 1);
  assert.equal(merged.overallStatus, 'fail');
  assert.match(summaryAuthority.completionMessage(merged), /发现 1 个失败项/);
});

test('candidate route trace readiness reports latest failure and preserves safe ids', () => {
  const result = diagnosticsService.candidateRouteTraceReadiness([
    { routeTestId: 'route-test-1', task: 'quick_reply', executionMode: 'candidate-only', status: 'failed', completedAt: '2026-08-01T09:00:00.000Z', stages: [{ stage: 'route-test-failed', evidence: { reasonCode: 'AI_QUALITY_ROUTE_BLOCKED' } }] }
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.status, 'warning');
  assert.equal(result.reasonCode, 'AI_CANDIDATE_ROUTE_TEST_RECENT_FAILURE');
  assert.equal(result.evidence.recent[0].routeTestId, 'route-test-1');
  assert.equal(result.evidence.recent[0].reasonCode, 'AI_QUALITY_ROUTE_BLOCKED');
});

test('global diagnostic dialog is explicitly wired to backend diagnostics authority', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(html, /言策工作区与系统诊断/u);
  assert.match(html, /r32-diagnostic-summary-authority\.js/u);
  assert.match(runtime, /YanceDiagnosticSummaryAuthority/u);
  assert.match(runtime, /\/api\/r32\/system\/diagnostics/u);
  assert.match(runtime, /\['pass','warn','fail','skipped'\]\.includes/u);
  assert.match(runtime, /skipped:rows\.filter\(row=>row\.status==='skipped'\)\.length/u);
  assert.doesNotMatch(runtime, /if\(!fail\)showSystemStatus\('success','系统诊断完成/u);
});
