'use strict';

/**
 * M6 — Release Layout contract (canonical, zero-dependency).
 *
 * Single source of truth for where the backend / runtime / frontend / release
 * artifacts live in each distribution mode. Consumed by:
 *   - M2 `packagedLaunchResolver` (resolves + verifies launch paths)
 *   - M7 installer (asserts the produced tree matches the contract)
 *   - M9 test system (validates a built package against the contract)
 *
 * Layouts are declarative relative paths keyed off `resourcesPath`
 * (packaged) or the project root (dev). No electron import — unit-testable.
 */

const path = require('path');

const LAYOUTS = {
  production: {
    appDir: ['app'],
    runtimeNodeDir: ['runtime', 'node22', 'node.exe'],
    releaseDir: ['release'],
    backendEntryRel: ['backend', 'desktopHostedEntry.js'],
    nodeModulesRel: ['node_modules'],
    frontendRootRel: ['frontend']
  },
  dev: {
    appDir: ['.'],
    runtimeNodeDir: ['runtime', 'node22', 'node.exe'],
    releaseDir: ['release'],
    backendEntryRel: ['backend', 'desktopHostedEntry.js'],
    nodeModulesRel: ['node_modules'],
    frontendRootRel: ['frontend']
  }
};

// Paths that MUST exist for a launch to be considered valid in any mode.
const REQUIRED_KEYS = ['backendEntry', 'nodeModules', 'nodeRuntime'];

function resolveLayoutPaths(mode, ctx = {}) {
  const layout = LAYOUTS[mode];
  if (!layout) throw new Error(`Unknown release layout mode: ${mode}`);
  const { resourcesPath } = ctx;
  if (!resourcesPath) throw new Error('resolveLayoutPaths: resourcesPath required');

  const appRoot = ctx.appRootOverride
    || (mode === 'production' ? path.join(resourcesPath, ...layout.appDir) : resourcesPath);

  const backendEntry = path.join(appRoot, ...layout.backendEntryRel);
  const nodeModules = path.join(appRoot, ...layout.nodeModulesRel);
  const frontendRoot = path.join(appRoot, ...layout.frontendRootRel);
  const releaseDir = path.join(resourcesPath, ...layout.releaseDir);
  const nodeRuntime = path.join(resourcesPath, ...layout.runtimeNodeDir);

  return {
    appRoot,
    backendEntry,
    nodeModules,
    nodeRuntime,
    frontendRoot,
    releaseDir,
    mode,
    isPackaged: mode === 'production'
  };
}

/**
 * Declarative validation against the contract. Returns a structured result and
 * never throws on a missing path (callers decide strictness).
 * @param {string} mode            'production' | 'dev'
 * @param {object} ctx             { resourcesPath, appRootOverride }
 * @param {object} [opts]
 * @param {function(string):boolean} [opts.existsSync]  fs.existsSync (optional)
 * @returns {{mode,valid,present:Array,presentKeys:string[],missing:Array,missingKeys:string[],resolved}}
 */
function validateLayout(mode, ctx = {}, opts = {}) {
  const resolved = resolveLayoutPaths(mode, ctx);
  const existsSync = opts.existsSync;
  const entries = REQUIRED_KEYS.map((key) => ({ key, path: resolved[key] }));
  const present = [];
  const missing = [];
  if (typeof existsSync === 'function') {
    for (const entry of entries) {
      if (existsSync(entry.path)) present.push(entry);
      else missing.push(entry);
    }
  } else {
    missing.push(...entries);
  }
  return {
    mode,
    valid: missing.length === 0,
    present,
    presentKeys: present.map((e) => e.key),
    missing,
    missingKeys: missing.map((e) => e.key),
    resolved
  };
}

module.exports = {
  LAYOUTS,
  REQUIRED_KEYS,
  resolveLayoutPaths,
  validateLayout
};
