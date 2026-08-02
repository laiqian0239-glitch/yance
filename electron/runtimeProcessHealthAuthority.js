'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeProcessType(value) {
  const raw = text(value).toLowerCase();
  if (raw === 'renderer') return 'renderer';
  if (raw === 'gpu') return 'gpu';
  if (raw === 'utility') return 'utility';
  if (raw === 'zygote') return 'zygote';
  return raw || 'unknown';
}

function normalizeReason(value) {
  return text(value).toLowerCase() || 'unknown';
}

function isNetworkService(serviceName) {
  return /(?:^|\.)network(?:\.|$)|networkservice|network\.mojom\.networkservice/iu.test(text(serviceName));
}

function classifyChildProcessGone(details = {}, options = {}) {
  const type = normalizeProcessType(details.type);
  const reason = normalizeReason(details.reason);
  const serviceName = text(details.serviceName);
  const exitCode = Number.isFinite(Number(details.exitCode)) ? Number(details.exitCode) : 0;
  const occurredAt = text(options.occurredAt) || new Date().toISOString();
  const base = {
    schemaVersion: 1,
    authority: 'RuntimeProcessHealthAuthority',
    eventType: 'child-process-gone',
    occurredAt,
    processType: type,
    serviceName,
    reason,
    exitCode
  };

  if (type === 'utility' && isNetworkService(serviceName)) {
    return Object.freeze({
      ...base,
      scope: 'network-service',
      reasonCode: 'NETWORK_SERVICE_PROCESS_CRASHED',
      severity: 'warning',
      fatal: false,
      recoverable: true,
      recoveryAction: 'rehydrate-network-dependent-state',
      userMessage: '网络服务子进程已重启，正在重新读取联网状态'
    });
  }

  if (type === 'renderer') {
    return Object.freeze({
      ...base,
      scope: 'renderer',
      reasonCode: 'RENDERER_PROCESS_CRASHED',
      severity: 'critical',
      fatal: true,
      recoverable: false,
      recoveryAction: 'recreate-renderer-window',
      userMessage: '界面进程已退出，需要重新创建窗口'
    });
  }

  if (type === 'gpu') {
    return Object.freeze({
      ...base,
      scope: 'gpu-process',
      reasonCode: 'GPU_PROCESS_GONE',
      severity: 'warning',
      fatal: false,
      recoverable: true,
      recoveryAction: 'rerender-after-gpu-restart',
      userMessage: '图形进程已重启，界面将自动重新渲染'
    });
  }

  return Object.freeze({
    ...base,
    scope: 'child-process',
    reasonCode: 'CHILD_PROCESS_GONE_UNKNOWN',
    severity: 'warning',
    fatal: false,
    recoverable: false,
    recoveryAction: 'diagnostic-review-required',
    userMessage: '检测到未知子进程退出，已保留诊断证据'
  });
}

module.exports = Object.freeze({
  classifyChildProcessGone,
  isNetworkService,
  normalizeProcessType,
  normalizeReason
});
