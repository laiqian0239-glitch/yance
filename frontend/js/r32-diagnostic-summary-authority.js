(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceDiagnosticSummaryAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function normalizeStatus(value) {
    const status = clean(value).toLowerCase();
    if (status === 'warning' || status === 'warn') return 'warn';
    if (status === 'skipped') return 'skipped';
    if (status === 'pass') return 'pass';
    return 'fail';
  }

  function workspaceRow(row = {}, index = 0) {
    return {
      id: clean(row.id) || `workspace-${index}`,
      source: 'workspace',
      name: clean(row.name) || `工作区检查 ${index + 1}`,
      status: normalizeStatus(row.status),
      detail: clean(row.detail),
      reasonCode: clean(row.reasonCode)
    };
  }

  function backendRow(row = {}, index = 0) {
    return {
      id: clean(row.id) || `backend-${index}`,
      source: 'system',
      name: `系统 · ${clean(row.name) || `真实探针 ${index + 1}`}`,
      status: normalizeStatus(row.status || (row.pass === true ? 'pass' : 'fail')),
      detail: clean(row.detail),
      reasonCode: clean(row.reasonCode)
    };
  }

  function merge(workspaceTests = [], backendDiagnostics = {}) {
    const workspaceRows = (Array.isArray(workspaceTests) ? workspaceTests : []).map(workspaceRow);
    const backendRows = (Array.isArray(backendDiagnostics?.tests) ? backendDiagnostics.tests : []).map(backendRow);
    const rows = [...workspaceRows, ...backendRows];
    const summary = {
      pass: rows.filter(row => row.status === 'pass').length,
      warn: rows.filter(row => row.status === 'warn').length,
      fail: rows.filter(row => row.status === 'fail').length,
      skipped: rows.filter(row => row.status === 'skipped').length
    };
    const overallStatus = summary.fail > 0 ? 'fail' : (summary.warn > 0 || summary.skipped > 0 ? 'attention' : 'pass');
    return {
      schemaVersion: 1,
      authority: 'YanceDiagnosticSummaryAuthority',
      overallStatus,
      summary,
      rows,
      workspaceCount: workspaceRows.length,
      backendCount: backendRows.length
    };
  }

  function completionMessage(result = {}) {
    const summary = result.summary || {};
    if (Number(summary.fail || 0) > 0) return `工作区与系统诊断发现 ${Number(summary.fail || 0)} 个失败项`;
    if (Number(summary.warn || 0) > 0 || Number(summary.skipped || 0) > 0) {
      return `工作区与系统诊断完成：${Number(summary.warn || 0)} 个需关注，${Number(summary.skipped || 0)} 个未执行`;
    }
    return '工作区与系统诊断完成：真实系统探针和工作区检查均通过';
  }

  return Object.freeze({ normalizeStatus, merge, completionMessage });
});
