'use strict';

const CRITICAL_CODE = /(ERR_SQLITE_ERROR|SQLITE|ACCOUNT_(?:CONNECT|LOGOUT|RECONNECT)_FAILED|CORE_OPERATION_FAILED|CREDENTIAL_READY_FALSE|QR_FLOW_FAILED|QR refs attempts ended|WHATSAPP.*connection-closed)/i;
const ACCOUNT_COMMAND = new Set(['account.connect', 'account.reconnect', 'account.logout', 'account.pause', 'account.resume']);

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }

function recentCoreFailures(input = {}) {
  const rows = [];
  const trace = Array.isArray(input.productionDiagnostics?.recent) ? input.productionDiagnostics.recent : [];
  const logs = Array.isArray(input.recentErrors) ? input.recentErrors : [];
  const diagnostics = Array.isArray(input.diagnostics?.tests) ? input.diagnostics.tests : [];
  const probe = id => diagnostics.find(row => row.id === id) || null;
  const probePassedAfter = (id, at) => {
    const row = probe(id);
    if (!row || row.status !== 'pass') return false;
    const eventAt = Date.parse(String(at || ''));
    if (!Number.isFinite(eventAt)) return true;
    return Number(row.checkedAt || 0) >= eventAt;
  };

  // The trace is newest-first. A later successful real operation resolves an
  // older failure for the same command/resource instead of leaving the UI red
  // forever or clearing it merely because the page refreshed.
  const terminalByOperation = new Map();
  for (const row of trace) {
    if (!['operation-failed', 'operation-completed'].includes(row?.type)) continue;
    const key = `${clean(row.command, 160)}:${clean(row.resource, 240)}`;
    if (!terminalByOperation.has(key)) terminalByOperation.set(key, row);
  }
  for (const row of terminalByOperation.values()) {
    if (row.type !== 'operation-failed') continue;
    const code = clean(row.code || 'CORE_OPERATION_FAILED', 120);
    const command = clean(row.command, 160);
    rows.push({
      source: 'production-diagnostics',
      code,
      command,
      severity: CRITICAL_CODE.test(`${code} ${command} ${row.message || ''}`) || ACCOUNT_COMMAND.has(command) ? 'critical' : 'high',
      message: clean(row.message || `${command || 'core operation'} failed`),
      at: clean(row.completedAt || row.at)
    });
  }

  for (const row of logs) {
    const code = clean(row.detail?.code || row.detail?.errorCode || row.detail?.reasonCode || row.message || 'CORE_LOG_ERROR', 120);
    const message = clean(row.detail?.error || row.detail?.message || row.message || code);
    const combined = `${clean(row.channel || '')} ${code} ${message}`;
    // A successful current probe is a real recheck and resolves old matching
    // log entries. This is intentionally not tied to a UI refresh action.
    const explicitSeverity = clean(row.detail?.severity || row.severity || '').toLowerCase();
    const isAccountFailure = /ACCOUNT_(?:CONNECT|LOGOUT|RECONNECT)_FAILED|account-(?:connect|logout|reconnect)-failed/i.test(combined);
    const isAiRoutingFailure = /AI_ROUTING|routingEligible/i.test(combined);
    const isCore = CRITICAL_CODE.test(combined) || isAccountFailure || isAiRoutingFailure || ['critical', 'high'].includes(explicitSeverity);
    if (!isCore) continue;
    if (/SQLITE/i.test(combined) && probePassedAfter('sqlite-store', row.at)) continue;
    if (isAccountFailure && probePassedAfter('account-operation-health', row.at)) continue;
    if (isAiRoutingFailure && probePassedAfter('ai-routing-readiness', row.at)) continue;
    rows.push({
      source: 'runtime-log',
      code,
      command: clean(row.detail?.command || ''),
      severity: CRITICAL_CODE.test(combined) ? 'critical' : 'high',
      message,
      at: clean(row.at)
    });
  }
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.code}:${row.command}:${row.message}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

function layer(id, label, status, reasonCode, evidence = {}) {
  return { id, label, status, reasonCode, evidence, checkedAt: Date.now() };
}

function buildReleaseReadiness(input = {}) {
  const health = input.health || {};
  const integrity = input.integrity || {};
  const accounts = input.accounts || { total: 0, rows: [] };
  const coreFailures = Array.isArray(input.coreFailures) ? input.coreFailures : [];
  const runtimeFailed = Number(health.criticalCount || 0) > 0
    || Number(health.highCount || 0) > 0
    || Number(health.fail || 0) > 0
    || Number(integrity.failed || 0) > 0
    || coreFailures.length > 0;
  const accountRows = Array.isArray(accounts.rows) ? accounts.rows : [];
  const unreadyAccounts = accountRows.filter(row => row.state !== 'paused' && (!['connected', 'limited'].includes(row.state) || row.credentialReady !== true));

  const layers = [
    layer('source-pre-review', '源码预审', input.sourcePreReviewPassed === true ? 'pass' : 'skipped', input.sourcePreReviewPassed === true ? 'SOURCE_PRE_REVIEW_VERIFIED' : 'SOURCE_PRE_REVIEW_EVIDENCE_NOT_BOUND', input.sourcePreReviewEvidence || {}),
    layer('windows-uat-authorization', '真实 Windows UAT 授权', input.windowsUatAuthorized === true ? 'pass' : 'skipped', input.windowsUatAuthorized === true ? 'WINDOWS_UAT_AUTHORIZATION_VERIFIED' : 'WINDOWS_UAT_AUTHORIZATION_NOT_BOUND', input.windowsUatAuthorizationEvidence || {}),
    layer('runtime-health', '当前运行环境健康', runtimeFailed ? 'fail' : 'pass', runtimeFailed ? 'RUNTIME_HEALTH_BLOCKED' : 'RUNTIME_HEALTH_VERIFIED', { health, integrityFailed: Number(integrity.failed || 0), coreFailureCount: coreFailures.length }),
    accountRows.length === 0
      ? layer('platform-verification', '平台真实验证', 'skipped', 'NO_PLATFORM_ACCOUNT_NOT_APPLICABLE', { accounts: 0 })
      : layer('platform-verification', '平台真实验证', unreadyAccounts.length ? 'fail' : 'pass', unreadyAccounts.length ? 'PLATFORM_ACCOUNT_NOT_READY' : 'PLATFORM_ACCOUNTS_VERIFIED', { accounts: accountRows.length, unreadyAccounts: unreadyAccounts.map(row => ({ id: row.id, platform: row.platform, state: row.state, credentialReady: row.credentialReady })) }),
    layer('windows-final', 'Windows Final Builder / M1–M10', input.windowsFinalPassed === true ? 'pass' : 'skipped', input.windowsFinalPassed === true ? 'WINDOWS_FINAL_VERIFIED' : 'WINDOWS_FINAL_EVIDENCE_NOT_BOUND', input.windowsFinalEvidence || {})
  ];
  const blockers = layers.filter(row => row.status !== 'pass').map(row => ({
    id: row.id,
    severity: row.status === 'fail' ? 'critical' : 'high',
    title: `${row.label}${row.status === 'skipped' ? '未执行' : '未通过'}`,
    status: row.status,
    reasonCode: row.reasonCode
  }));
  return {
    ready: blockers.length === 0,
    level: blockers.some(row => row.severity === 'critical') ? 'blocked' : blockers.length ? 'incomplete' : 'ready',
    layers,
    blockers
  };
}

module.exports = { recentCoreFailures, buildReleaseReadiness };
