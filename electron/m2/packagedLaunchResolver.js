'use strict';

/**
 * M2 Electron Main — packaged 启动入口解析（P0-4）
 *
 * 设计约束（与 M2_STARTUP_FAILURE_SCHEMA / M6 RELEASE_LAYOUT 对齐）：
 *  - 只做 M2 层最小工作：接收 M6 提供的 release layout contract，按 resources/app 解析。
 *  - 不硬编码多套 layout；不自行 fallback 到 dev path。
 *  - packaged 模式下若关键路径缺失 → 抛结构化错误（绝不回退 dev），由 startupFailure 工厂呈现。
 *  - dev 模式（app.isPackaged === false）允许使用项目根（tests / dev 运行）。
 *
 * 本模块不 import electron，可脱离整包独立单测。编排器注入
 * { resourcesPath, appRoot, isPackaged, runtimeNodeDir } 等上下文。
 */

const path = require('path');
const { LAYOUTS, REQUIRED_KEYS, resolveLayoutPaths } = require('./releaseLayout');

// 生产包约定布局（与 M6 RELEASE_LAYOUT 一致，由 releaseLayout.js 提供唯一真源）
// <installDir>/
//   resources/
//     app/                 (backend + electron + frontend + node_modules + package.json)
//     runtime/node22/node.exe
//     release/manifest.json
// 注意：以下路径均相对 process.resourcesPath（即 <installDir>/resources）。
// dev 模式 resourcesPath 即项目根，appDir 退化为根本身（见 resolveBackendLaunchPaths）。
const PRODUCTION_LAYOUT = LAYOUTS.production;

/**
 * 解析 backend 启动所需的关键路径。委托 M6 releaseLayout 契约（唯一真源）。
 * @param {object} ctx
 * @param {string} ctx.resourcesPath       process.resourcesPath（packaged）或项目根（dev）
 * @param {boolean} ctx.isPackaged         app.isPackaged
 * @param {string} [ctx.appRootOverride]   显式 appRoot（覆盖默认推导）
 * @param {object} [ctx.fsProbe]           可选 { existsSync } 用于路径校验（测试注入）
 * @returns {{appRoot,backendEntry,nodeModules,nodeRuntime,frontendRoot,releaseDir,isPackaged}}
 */
function resolveBackendLaunchPaths(ctx) {
  if (!ctx || !ctx.resourcesPath) throw new Error('resolveBackendLaunchPaths: resourcesPath required');
  // M6 契约：packaged → production layout，dev → dev layout。
  return resolveLayoutPaths(ctx.isPackaged ? 'production' : 'dev', ctx);
}

/**
 * 校验解析出的关键路径真实存在。
 * @param {object} resolved  resolveBackendLaunchPaths 的结果
 * @param {object} opts
 * @param {function(string):boolean} opts.existsSync   fs.existsSync
 * @param {boolean} [opts.isPackaged]                  是否按 packaged 严格校验（缺失即抛）
 * @param {string} [opts.devFallbackAttempted]         若 true 且 packaged 缺失 → 触发拒绝 fallback 错误
 * @returns {{allPresent:boolean, missing:string[]}}
 */
function verifyPathsExist(resolved, opts) {
  const { existsSync } = opts;
  if (typeof existsSync !== 'function') throw new Error('verifyPathsExist: existsSync required');
  const isPackaged = opts.isPackaged !== undefined ? opts.isPackaged : resolved.isPackaged;
  // 关键路径集合来自 M6 契约 REQUIRED_KEYS（唯一真源）。
  const checks = REQUIRED_KEYS.map((key) => [key, resolved[key]]);
  const missing = [];
  for (const [key, p] of checks) {
    if (!existsSync(p)) missing.push(key);
  }

  if (missing.length > 0) {
    if (isPackaged) {
      // 生产包：路径缺失属于硬失败，绝不 fallback dev
      const err = new Error(`packaged launch path unresolved: ${missing.join(', ')}`);
      err.errorCode = 'M2_PACKAGED_LAUNCH_PATH_UNRESOLVED';
      err.reasonCode = 'M2_PACKAGED_LAUNCH_DEV_FALLBACK_DENIED';
      err.phase = 'PACKAGED_PATH';
      err.missingPaths = missing.slice();
      err.devFallbackAttempted = !!opts.devFallbackAttempted;
      err.isPackaged = true;
      throw err;
    }
    // dev 模式：允许缺失（tests / dev 运行），仅返回 missing 供诊断
  }
  return { allPresent: missing.length === 0, missing };
}

module.exports = {
  PRODUCTION_LAYOUT,
  resolveBackendLaunchPaths,
  verifyPathsExist
};
