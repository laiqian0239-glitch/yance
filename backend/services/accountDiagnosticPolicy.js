'use strict';

const CRITICAL_TESTS = Object.freeze({
  whatsapp: Object.freeze(['metadata', 'credentials', 'service', 'session', 'receive', 'send', 'route']),
  telegram: Object.freeze(['metadata', 'credentials', 'service', 'session', 'receive', 'send', 'route']),
  facebook: Object.freeze(['metadata', 'credentials', 'service', 'session', 'permissions', 'subscription', 'receive', 'send', 'route'])
});

function normalizedPlatform(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluateAccountDiagnostic(platform, tests = []) {
  const rows = Array.isArray(tests) ? tests.map(row => ({ ...row, pass: row?.pass === true })) : [];
  const criticalIds = CRITICAL_TESTS[normalizedPlatform(platform)] || CRITICAL_TESTS.whatsapp;
  const byId = new Map(rows.map(row => [String(row.id || ''), row]));
  const criticalFailures = criticalIds
    .map(id => byId.get(id) || { id, name: id, pass: false, detail: '关键诊断项未执行' })
    .filter(row => row.pass !== true)
    .map(row => ({ id: row.id, name: row.name || row.id, detail: row.detail || '' }));
  const pass = rows.filter(row => row.pass === true).length;
  const fail = rows.length - pass;
  const criticalReady = criticalFailures.length === 0;
  const ok = fail === 0 && criticalReady;
  const health = ok ? '健康' : criticalReady ? '基本可用' : pass >= 3 ? '需要处理' : '已失效';
  const message = ok
    ? '关键连接、收发与路由能力均已通过'
    : criticalFailures.length
      ? `关键能力失败：${criticalFailures.map(row => row.name).join('、')}`
      : `${fail} 项非关键检查需要处理`;
  return { ok, hasIssues: !ok, criticalReady, health, pass, fail, criticalFailures, message };
}

module.exports = { CRITICAL_TESTS, evaluateAccountDiagnostic };
