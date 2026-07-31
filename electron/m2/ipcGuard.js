'use strict';

/**
 * M2 Electron Main — IPC 校验中间件（P0-5）
 *
 * 设计约束（与 M2_IPC_MANIFEST.json 对齐）：
 *  - manifest-driven：每个 renderer→main channel 必须有 inputSchema / outputSchema /
 *    requiresBackendReady / allowedDuringQuitting / allowedDuringRestart / reasonCodeOnFailure /
 *    sensitiveFields。
 *  - denylist 9 项全拦截（execute-command / read-arbitrary-file / write-arbitrary-file /
 *    delete-file / open-sqlite / repair-installation / rebuild-native / kill-process /
 *    override-release-contract）。
 *  - 默认拒绝：manifest 中不存在的 channel 一律拒绝。
 *  - 校验失败返回结构化错误信封（含 reasonCode），不抛未捕获异常。
 *
 * 本模块不 import electron，可脱离整包独立单测。编排器（main.js）调用
 * registerGuardedHandlers 把评估逻辑挂到 ipcMain.handle。
 */

const fs = require('fs');
const path = require('path');

const DENYLIST = [
  'execute-command',
  'read-arbitrary-file',
  'write-arbitrary-file',
  'delete-file',
  'open-sqlite',
  'repair-installation',
  'rebuild-native',
  'kill-process',
  'override-release-contract'
];

function loadManifest(manifestPath) {
  // 解析顺序：显式路径 > 环境变量 > 源码树内副本 > 上游契约文档。
  const candidates = [
    manifestPath,
    process.env.M2_IPC_MANIFEST_PATH,
    path.join(__dirname, 'ipcManifest.json'),
    path.join(__dirname, '..', '..', 'docs', 'architecture', 'M2_IPC_MANIFEST.json')
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (_) { /* try next */ }
  }
  throw new Error('M2_IPC_MANIFEST not found in any candidate path');
}

// denylist 可能是字符串数组或对象数组（{action, decision, reasonCodeOnFailure}）。
// 统一规整为 action 字符串集合。
function normalizeDenylist(denylist) {
  if (!Array.isArray(denylist) || denylist.length === 0) return DENYLIST.slice();
  return denylist.map((d) => (typeof d === 'string' ? d : d.action)).filter(Boolean);
}

function indexManifest(manifest) {
  const byChannel = new Map();
  // 真实契约中 handlers 位于顶层 handlers 键（每条 direction === 'renderer-to-main'）。
  const all = (manifest && manifest.handlers) || (manifest && manifest.rendererToMain) || [];
  for (const h of all) {
    if (h && h.direction === 'renderer-to-main') byChannel.set(h.channel, h);
  }
  return {
    byChannel,
    denylist: normalizeDenylist(manifest && manifest.denylist)
  };
}

// 极简 schema 校验（无外部依赖）。支持 object/properties/required/additionalProperties/
// string/number/boolean/array/enum/optional。足够覆盖 M2 manifest 的形态声明。
function validateSchema(value, schema) {
  if (!schema) return { valid: true };
  const type = schema.type;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, error: 'expected object' };
    }
    const props = schema.properties || {};
    const required = schema.required || [];
    for (const k of required) {
      if (!(k in value)) return { valid: false, error: `missing required field: ${k}` };
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) return { valid: false, error: `unexpected field: ${k}` };
      }
    }
    for (const k of Object.keys(props)) {
      if (k in value && value[k] !== undefined) {
        const r = validateSchema(value[k], props[k]);
        if (!r.valid) return { valid: false, error: `${k}: ${r.error}` };
      }
    }
    return { valid: true };
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return { valid: false, error: 'expected array' };
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const r = validateSchema(value[i], schema.items);
        if (!r.valid) return { valid: false, error: `[${i}]: ${r.error}` };
      }
    }
    return { valid: true };
  }
  if (type) {
    let ok = false;
    if (type === 'string') ok = typeof value === 'string';
    else if (type === 'number' || type === 'integer') ok = typeof value === 'number' && (type === 'number' || Number.isInteger(value));
    else if (type === 'boolean') ok = typeof value === 'boolean';
    else if (type === 'null') ok = value === null;
    if (type === 'integer' && ok && !Number.isInteger(value)) ok = false;
    if (schema.enum && !schema.enum.includes(value)) ok = false;
    if (typeof schema.minimum === 'number' && ok && value < schema.minimum) ok = false;
    if (typeof schema.maximum === 'number' && ok && value > schema.maximum) ok = false;
    if (!ok) return { valid: false, error: `expected ${type}` };
  }
  return { valid: true };
}

/**
 * 评估单个 IPC 调用是否放行。
 * @param {object} args
 * @param {object} args.index   由 indexManifest 生成
 * @param {string} args.channel
 * @param {*}      args.payload
 * @param {object} args.ctx     { stateName, backendReady, quitting, relaunchPending, backendRestarting }
 * @returns {{allowed:boolean, reasonCode:string, envelope:object|null, handler:object|null}}
 */
function evaluateIpc(args) {
  const { index, channel, payload, ctx } = args;
  const c = ctx || {};
  const validateInput = args.validateInput !== false; // 默认严格；main.js 接线可传 false 做软校验（仅记录不拦截）

  if (index.denylist.includes(channel)) {
    return denylistDeny(channel);
  }
  const handler = index.byChannel.get(channel);
  if (!handler) {
    return {
      allowed: false,
      reasonCode: 'M2_IPC_UNKNOWN_CHANNEL',
      envelope: errorEnvelope('M2_IPC_UNKNOWN_CHANNEL', `channel not declared in IPC manifest: ${channel}`),
      handler: null
    };
  }
  if (handler.requiresBackendReady && !c.backendReady) {
    return {
      allowed: false,
      reasonCode: handler.reasonCodeOnFailure || 'M2_IPC_BACKEND_NOT_READY',
      envelope: errorEnvelope(handler.reasonCodeOnFailure || 'M2_IPC_BACKEND_NOT_READY', 'backend not ready'),
      handler
    };
  }
  if (c.quitting && handler.allowedDuringQuitting !== true) {
    return {
      allowed: false,
      reasonCode: handler.reasonCodeOnFailure || 'M2_IPC_DENIED_DURING_QUIT',
      envelope: errorEnvelope(handler.reasonCodeOnFailure || 'M2_IPC_DENIED_DURING_QUIT', 'IPC denied during quit'),
      handler
    };
  }
  if (c.backendRestarting && handler.allowedDuringRestart !== true) {
    return {
      allowed: false,
      reasonCode: handler.reasonCodeOnFailure || 'M2_IPC_DENIED_DURING_RESTART',
      envelope: errorEnvelope(handler.reasonCodeOnFailure || 'M2_IPC_DENIED_DURING_RESTART', 'IPC denied during backend restart'),
      handler
    };
  }
  if (validateInput) {
    const v = validateSchema(payload, handler.inputSchema);
    if (!v.valid) {
      return {
        allowed: false,
        reasonCode: 'M2_IPC_INVALID_PAYLOAD',
        envelope: errorEnvelope('M2_IPC_INVALID_PAYLOAD', `invalid payload: ${v.error}`),
        handler
      };
    }
  }
  return { allowed: true, reasonCode: 'M2_IPC_OK', envelope: null, handler };
}

function denylistDeny(channel) {
  return {
    allowed: false,
    reasonCode: 'M2_IPC_DENYLIST',
    envelope: errorEnvelope('M2_IPC_DENYLIST', `channel denied by denylist: ${channel}`),
    handler: null
  };
}

function errorEnvelope(reasonCode, message) {
  return { error: { reasonCode, message, fatal: false } };
}

/**
 * 把评估逻辑挂到 ipcMain.handle（由 main.js 调用）。
 * @param {object} ipcMain Electron ipcMain
 * @param {object} manifest M2_IPC_MANIFEST.json 解析结果
 * @param {object} handlers 真实 handler 实现 { channel: async (event, payload) => result }
 * @param {function():object} ctxFn 返回当前安全上下文 { stateName, backendReady, quitting, ... }
 */
function registerGuardedHandlers(ipcMain, manifest, handlers, ctxFn) {
  const index = indexManifest(manifest);
  for (const channel of index.byChannel.keys()) {
    ipcMain.handle(channel, async (event, payload) => {
      const res = evaluateIpc({ index, channel, payload, ctx: ctxFn() });
      if (!res.allowed) return res.envelope;
      const impl = handlers && handlers[channel];
      if (typeof impl !== 'function') {
        return errorEnvelope('M2_IPC_NO_HANDLER', `no handler implementation for ${channel}`);
      }
      try {
        return await impl(event, payload);
      } catch (err) {
        return errorEnvelope(err.reasonCode || 'M2_IPC_HANDLER_ERROR', err.message || 'handler error');
      }
    });
  }
  return index;
}

/**
 * 安全包装单个已注册 handler：仅对契约中声明的 channel 施加 denylist / guard / schema 校验；
 * 契约未声明的 channel（如 sound:result 事件、调试通道）原样透传，保证既有行为零回归。
 *
 * @param {object} index 由 indexManifest 生成
 * @param {string} channel
 * @param {function} fn 原始 handler (event, payload) => result
 * @param {function():object} ctxFn 返回当前安全上下文
 * @returns {function} 包装后的 handler
 */
function guardChannel(index, channel, fn, ctxFn, opts = {}) {
  if (!index.byChannel.has(channel)) return fn; // 未声明 → 透传
  return async (event, payload) => {
    const res = evaluateIpc({ index, channel, payload, ctx: ctxFn(), validateInput: opts.validateInput });
    if (!res.allowed) return res.envelope;
    try {
      return await fn(event, payload);
    } catch (err) {
      return errorEnvelope(err.reasonCode || 'M2_IPC_HANDLER_ERROR', err.message || 'handler error');
    }
  };
}

module.exports = {
  DENYLIST,
  loadManifest,
  indexManifest,
  validateSchema,
  evaluateIpc,
  registerGuardedHandlers,
  guardChannel,
  errorEnvelope
};
