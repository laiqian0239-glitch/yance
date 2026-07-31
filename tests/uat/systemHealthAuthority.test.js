'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { projectLogs, projectHealth, STATE } = require('../../backend/services/systemHealthAuthority');

const NOW = Date.parse('2026-07-22T03:50:00.000Z');
function at(minutesAgo) { return new Date(NOW - minutesAgo * 60000).toISOString(); }

function healthyInput(logProjection) {
  return {
    report: { pass: 10, fail: 0, warning: 0, executed: 10 },
    accounts: { total: 2, connected: 2, abnormal: 0 },
    ai: { count: 1, online: true, routingEligible: 1 },
    backups: { latest: { valid: true }, latestAgeHours: 1 },
    policy: { emergencyStop: false },
    secure: { available: true },
    integrity: { passed: 7, failed: 0, checks: new Array(7) },
    issues: [],
    logProjection
  };
}

test('repeated avatar and media failures are aggregated into readable current degradation records', () => {
  const logs = [
    ...Array.from({ length: 9 }, (_, index) => ({
      at: at(2 + index / 10), channel: 'accounts', level: 'warn', message: 'avatar-sync-failed',
      detail: { accountId: 'wa-1', conversationId: `conv-${index}`, stage: 'download-validate-persist', errorCode: 'http-500', attempt: index + 1 }
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      at: at(1 + index / 10), channel: 'media', level: 'warn', message: 'materialize-failed',
      detail: { accountId: 'wa-1', conversationId: 'conv-1', messageId: `msg-${index}`, error: 'MEDIA_DOWNLOAD_TIMEOUT' }
    }))
  ];
  const projection = projectLogs(logs, { now: NOW, activeWindowMs: 20 * 60000 });
  assert.equal(projection.active.length, 2);
  const avatar = projection.active.find(row => row.code === 'ACCOUNT_AVATAR_SYNC_FAILED');
  const media = projection.active.find(row => row.code === 'MEDIA_MATERIALIZE_FAILED');
  assert.equal(avatar.occurrences, 9);
  assert.equal(avatar.severity, 'high');
  assert.equal(avatar.affectedEntityCount, 1); // grouped by account authority, not every internal id
  assert.match(avatar.titleZh, /头像同步/u);
  assert.match(media.messageZh, /历史图片|语音|贴纸|文件/u);
  assert.notEqual(JSON.stringify(projection), '{}');
});

test('active runtime degradation prevents a false 100 health score', () => {
  const logProjection = projectLogs([
    { at: at(1), channel: 'media', level: 'warn', message: 'materialize-failed', detail: { error: 'MEDIA_DOWNLOAD_TIMEOUT' } },
    { at: at(2), channel: 'accounts', level: 'warn', message: 'avatar-sync-failed', detail: { errorCode: 'frontend-load-failed' } }
  ], { now: NOW });
  const health = projectHealth(healthyInput(logProjection));
  assert.ok(health.score < 100);
  assert.equal(health.level, 'attention');
  assert.equal(health.activeErrorAggregates, 2);
  assert.ok([STATE.RECOVERING, STATE.DEGRADED].includes(health.state));
  assert.match(health.summaryZh, /后台任务|降级/u);
});

test('old historical errors remain visible without permanently poisoning current health', () => {
  const logProjection = projectLogs([
    { at: at(48 * 60), channel: 'server', level: 'error', message: 'request-failed', detail: { code: 'ERR_SQLITE_ERROR', error: 'old failure' } }
  ], { now: NOW, activeWindowMs: 20 * 60000, recentWindowMs: 24 * 60 * 60000 });
  assert.equal(logProjection.active.length, 0);
  assert.equal(logProjection.historical.length, 1);
  const health = projectHealth(healthyInput(logProjection));
  assert.equal(health.state, STATE.HEALTHY);
  assert.equal(health.score, 100);
});

test('current critical service failure blocks health and exposes a Chinese actionable summary', () => {
  const logProjection = projectLogs([
    { at: at(1), channel: 'server', level: 'error', message: 'request-failed', detail: { code: 'ERR_SQLITE_ERROR', error: 'cannot start a transaction' } }
  ], { now: NOW });
  const failure = logProjection.active[0];
  assert.equal(failure.severity, 'critical');
  assert.match(failure.messageZh, /数据库/u);
  const health = projectHealth(healthyInput(logProjection));
  assert.equal(health.state, STATE.BLOCKED);
  assert.equal(health.level, 'critical');
  assert.ok(health.score <= 49);
});

test('system center consumes aggregated health authority instead of raw JSON.stringify logs', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const ui = fs.readFileSync(path.join(repoRoot, 'frontend', 'r32-system-center.js'), 'utf8');
  const service = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'systemCenterService.js'), 'utf8');
  const route = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'system.js'), 'utf8');
  assert.match(ui, /logAggregateCard/u);
  assert.match(ui, /d\.logProjection\?\.aggregates/u);
  assert.doesNotMatch(ui, /JSON\.stringify\(log\.detail/u);
  assert.match(service, /systemHealthAuthority\.projectLogs/u);
  assert.match(service, /logProjection\.active/u);
  assert.match(route, /systemHealthAuthority\.projectLogs/u);
});

test('durable retry and final background jobs remain visible after log buffers rotate', () => {
  const retryHealth = projectHealth({
    ...healthyInput(projectLogs([], { now: NOW })),
    backgroundJobs: { total: 2, counts: { RUNNING: 0, RETRY_WAIT: 2, FAILED_FINAL: 0 } }
  });
  assert.equal(retryHealth.state, STATE.RECOVERING);
  assert.ok(retryHealth.score < 100);
  assert.equal(retryHealth.backgroundJobCounts.retryWait, 2);

  const finalHealth = projectHealth({
    ...healthyInput(projectLogs([], { now: NOW })),
    backgroundJobs: { total: 1, counts: { RUNNING: 0, RETRY_WAIT: 0, FAILED_FINAL: 1 } }
  });
  assert.equal(finalHealth.state, STATE.DEGRADED);
  assert.ok(finalHealth.score <= 79);
  assert.equal(finalHealth.backgroundJobCounts.failedFinal, 1);
});
