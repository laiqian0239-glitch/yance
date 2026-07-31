'use strict';

/**
 * M2 Electron Main — 启动失败工厂（P0-3）
 *
 * 设计约束（与 M2_STARTUP_FAILURE_SCHEMA.md 对齐）：
 *  - 5 个启动失败出口（pre-child / launch / trusted-ready-timeout /
 *    packaged-path-resolution-failed / backend-exited-while-ready）共用同一对象形状。
 *  - 主字段 errorCode；reasonCode 仅作兼容别名，若存在必须等于 errorCode。
 *  - 敏感字段禁止清单（脱敏）：startupNonce 原文、完整敏感用户路径、env 原文、
 *    apiSessionToken / Authorization / backend token / credential value / secret、
 *    credential custody pipe path / named pipe path、含用户段的 SQLite 绝对路径、
 *    含用户名的 installer 临时路径。
 *
 * 本模块不 import electron，可脱离整包独立单测。
 */

const SCHEMA_VERSION = 1;

// 最小强制字段（来自 M2_STARTUP_FAILURE_SCHEMA.md）
const REQUIRED_FIELDS = [
  'errorCode',
  'moduleOwner',
  'phase',
  'severity',
  'startupAttemptId',
  'backendPid',
  'userMessageKey',
  'developerMessage',
  'logPath',
  'recoverable',
  'nextAction',
  'timestamp',
  'source'
];

// 敏感字段（任何情况下不得进入 renderer / 日志 / evidence）
const SENSITIVE_FIELDS = new Set([
  'startupNonce',
  'apiSessionToken',
  'authorization',
  'Authorization',
  'backendToken',
  'credential',
  'credentialValue',
  'password',
  'secret',
  'credentialCustodyPipePath',
  'namedPipePath',
  'sqliteAbsolutePathWithUser',
  'installerTempPathWithUser'
]);

function nowIso() {
  return new Date().toISOString();
}

/**
 * 创建标准化启动失败对象。
 * @param {object} opts
 * @param {string} opts.errorCode       主错误码（必填）
 * @param {string} opts.moduleOwner     模块归属，恒定 'M2'
 * @param {string} opts.phase           启动阶段（PRE_CHILD / LAUNCH / TRUSTED_READY_TIMEOUT / PACKAGED_PATH / BACKEND_EXITED）
 * @param {string} opts.severity        fatal | error | warning
 * @param {boolean} opts.recoverable    是否可恢复（决定是否允许 retry）
 * @param {string} opts.nextAction      给用户的下一步动作键
 * @param {string} opts.userMessageKey  用户可读文案键
 * @param {string} opts.developerMessage 开发者可读信息
 * @param {string} opts.logPath         日志路径
 * @param {string} [opts.startupAttemptId]
 * @param {number} [opts.backendPid]
 * @param {string} [opts.source]        来源标识
 * @param {string} [opts.reasonCode]    兼容别名，若提供必须等于 errorCode
 */
function createStartupFailure(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('createStartupFailure: opts required');
  if (!opts.errorCode) throw new Error('createStartupFailure: errorCode required');

  const failure = {
    schemaVersion: SCHEMA_VERSION,
    errorCode: opts.errorCode,
    moduleOwner: opts.moduleOwner || 'M2',
    phase: opts.phase || 'UNKNOWN',
    severity: opts.severity || 'error',
    startupAttemptId: opts.startupAttemptId != null ? opts.startupAttemptId : null,
    backendPid: typeof opts.backendPid === 'number' ? opts.backendPid : 0,
    userMessageKey: opts.userMessageKey || 'startup.failed.generic',
    developerMessage: opts.developerMessage || opts.errorCode,
    logPath: opts.logPath || '',
    recoverable: opts.recoverable !== false,
    nextAction: opts.nextAction || 'contact-support',
    timestamp: nowIso(),
    source: opts.source || 'M2'
  };

  // reasonCode 兼容别名：若提供必须等于 errorCode
  if (opts.reasonCode !== undefined) {
    if (opts.reasonCode !== opts.errorCode) {
      throw new Error(`startupFailure.reasonCode (${opts.reasonCode}) must equal errorCode (${opts.errorCode})`);
    }
    failure.reasonCode = opts.reasonCode;
  }

  // 透传未在标准白名单中的额外字段（如敏感上下文 credential / apiSessionToken），
  // 交由 redactSensitive 在导出时脱敏；serializeForRenderer 只暴露必要字段，不会外泄。
  const STANDARD_OUT_KEYS = new Set(Object.keys(failure));
  for (const k of Object.keys(opts)) {
    if (k === 'reasonCode') continue;
    if (!STANDARD_OUT_KEYS.has(k)) failure[k] = opts[k];
  }

  // 校验强制字段齐全
  for (const f of REQUIRED_FIELDS) {
    if (failure[f] === undefined) throw new Error(`startupFailure missing field: ${f}`);
  }
  return failure;
}

/**
 * 脱敏：移除/屏蔽敏感字段，返回新对象（不修改入参）。
 * 同时对任意含敏感关键词的对象做递归清理。
 */
function redactSensitive(failure) {
  const out = {};
  for (const [k, v] of Object.entries(failure || {})) {
    if (SENSITIVE_FIELDS.has(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 生成可安全发送给 renderer 的载荷（脱敏 + 仅暴露必要字段）。
 */
function serializeForRenderer(failure) {
  const safe = redactSensitive(failure);
  return {
    errorCode: safe.errorCode,
    reasonCode: safe.reasonCode || safe.errorCode,
    moduleOwner: safe.moduleOwner,
    phase: safe.phase,
    severity: safe.severity,
    userMessageKey: safe.userMessageKey,
    developerMessage: safe.developerMessage,
    recoverable: safe.recoverable,
    nextAction: safe.nextAction,
    logPath: safe.logPath,
    timestamp: safe.timestamp,
    source: safe.source
  };
}

// ---- 5 个出口适配器（与状态机 sideEffect create-startup-failure 的 phase 对应） ----

function preChildFailure(opts) {
  return createStartupFailure(Object.assign({
    errorCode: 'M2_BACKEND_LAUNCH_PRE_CHILD_FAILED',
    phase: 'PRE_CHILD',
    severity: 'fatal',
    recoverable: false,
    userMessageKey: 'startup.failed.prechild',
    nextAction: 'contact-support',
    source: 'M2_PRE_CHILD'
  }, opts));
}

function launchFailure(opts) {
  return createStartupFailure(Object.assign({
    errorCode: 'M2_BACKEND_STARTUP_FAILED',
    phase: 'LAUNCH',
    severity: 'fatal',
    recoverable: false,
    userMessageKey: 'startup.failed.launch',
    nextAction: 'contact-support',
    source: 'M2_LAUNCH'
  }, opts));
}

function trustedReadyTimeoutFailure(opts) {
  return createStartupFailure(Object.assign({
    errorCode: 'M2_TRUSTED_READY_TIMEOUT',
    phase: 'TRUSTED_READY_TIMEOUT',
    severity: 'error',
    recoverable: true,
    userMessageKey: 'startup.failed.trustedready',
    nextAction: 'retry-startup',
    source: 'M2_TRUSTED_READY'
  }, opts));
}

function packagedPathResolutionFailure(opts) {
  return createStartupFailure(Object.assign({
    errorCode: 'M2_PACKAGED_LAUNCH_PATH_UNRESOLVED',
    phase: 'PACKAGED_PATH',
    severity: 'fatal',
    recoverable: false,
    userMessageKey: 'startup.failed.packagedpath',
    nextAction: 'reinstall',
    source: 'M2_PACKAGED_PATH'
  }, opts));
}

function backendExitedWhileReadyFailure(opts) {
  return createStartupFailure(Object.assign({
    errorCode: 'M2_BACKEND_EXITED_WHILE_READY',
    phase: 'BACKEND_EXITED',
    severity: 'error',
    recoverable: true,
    userMessageKey: 'startup.failed.backendexited',
    nextAction: 'retry-startup',
    source: 'M2_BACKEND_EXITED'
  }, opts));
}

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_FIELDS,
  SENSITIVE_FIELDS,
  createStartupFailure,
  redactSensitive,
  serializeForRenderer,
  preChildFailure,
  launchFailure,
  trustedReadyTimeoutFailure,
  packagedPathResolutionFailure,
  backendExitedWhileReadyFailure
};
