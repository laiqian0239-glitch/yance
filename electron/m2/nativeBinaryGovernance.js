'use strict';

/**
 * M8 — Native Binary Governance (pure, zero runtime dependencies).
 *
 * Establishes the trusted strategy for:
 *   1. Probing the bundled runtime Node (resources/runtime/node22/node.exe per M6 contract)
 *      to learn its NODE_MODULE_VERSION (process.versions.modules) and platform/arch.
 *   2. Classifying each native addon (.node) against that runtime:
 *        - abiIndependent (NAPI) addons are ABI-stable across Node versions.
 *        - version-bound addons must match the runtime's moduleVersion exactly.
 *        - missing / hash-mismatched addons are flagged as broken.
 *   3. Producing a compatibility decision: ACCEPT | REBUILD_REQUIRED | ROLLBACK_REQUIRED.
 *   4. Planning an atomic runtime-node swap with backup, and deciding rollback.
 *
 * This module never performs a rebuild or replacement itself. The actual rebuild/install
 * is an external (installer / update / main-process) operation — never reachable from the
 * renderer IPC (M2 ipcManifest denylists `rebuild-native`). It only computes policy.
 *
 * All I/O (fs, node spawn) is injectable so the decision logic is fully unit-testable.
 */

const path = require('node:path');

/** Runtime node slot name, sourced from the M6 release-layout contract. */
const RUNTIME_SLOT = 'node22';

/**
 * Known native addons shipped with this product.
 * Both are NAPI prebuilds (ABI-independent), so a runtime-node upgrade does not
 * require a rebuild. Documented here as the canonical descriptor set; in production
 * these descriptors should be supplied by the release manifest / binding.
 */
const KNOWN_NATIVE_ADDONS = Object.freeze([
  Object.freeze({
    id: 'bufferutil',
    relativePath: 'node_modules/bufferutil/prebuilds/win32-x64/bufferutil.node',
    abiIndependent: true,
    platform: 'win32',
    arch: 'x64'
  }),
  Object.freeze({
    id: 'utf-8-validate',
    relativePath: 'node_modules/utf-8-validate/prebuilds/win32-x64/node.napi.node',
    abiIndependent: true,
    platform: 'win32',
    arch: 'x64'
  })
]);

/**
 * Default probe implementation: spawn the node executable and read its versions.
 * Isolated so it can be overridden in tests with a canned response.
 */
function spawnNodeProbe(nodeExePath, options = {}) {
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(
    nodeExePath,
    ['-p', 'JSON.stringify({version:process.version,moduleVersion:Number(process.versions.modules),platform:process.platform,arch:process.arch})'],
    { encoding: 'utf8', timeout: options.timeout || 30000, windowsHide: true }
  );
  if (result.status !== 0) {
    const error = new Error(`node probe failed: ${result.stderr || (result.error && result.error.message) || 'unknown'}`);
    error.reasonCode = 'NODE_PROBE_FAILED';
    throw error;
  }
  return JSON.parse(result.stdout);
}

/**
 * Probe a runtime node executable.
 * @param {{nodeExePath:string, runNode?:function}} args
 * @returns {{ok:boolean, nodeVersion?:string, moduleVersion?:number, platform?:string, arch?:string, error?:string, message?:string}}
 */
function probeRuntimeNode({ nodeExePath, runNode } = {}) {
  if (!nodeExePath) return { ok: false, error: 'NODE_RUNTIME_PATH_MISSING' };
  let raw;
  try {
    raw = runNode ? runNode(nodeExePath) : spawnNodeProbe(nodeExePath);
  } catch (err) {
    return { ok: false, error: err.reasonCode || 'NODE_PROBE_FAILED', message: err.message };
  }
  const nodeVersion = String(raw.version || '').replace(/^v/, '');
  return {
    ok: true,
    nodeVersion,
    moduleVersion: Number(raw.moduleVersion),
    platform: raw.platform,
    arch: raw.arch
  };
}

/**
 * Classify a single native addon descriptor against the probed runtime node.
 * @param {object} addon - { relativePath, abiIndependent?, requiredModuleVersion?, expectedSha256? }
 * @param {object} runtimeNode - result of probeRuntimeNode (ok=true)
 * @param {{exists?:function, sha256?:function}} [fsProbe] - injectable filesystem probe
 */
function classifyAddon(addon, runtimeNode, fsProbe) {
  const rel = addon.relativePath;
  if (fsProbe && typeof fsProbe.exists === 'function' && !fsProbe.exists(rel)) {
    return { relativePath: rel, status: 'MISSING', detail: 'addon file absent' };
  }
  if (fsProbe && typeof fsProbe.sha256 === 'function' && addon.expectedSha256) {
    const actual = fsProbe.sha256(rel);
    if (actual !== addon.expectedSha256) {
      return { relativePath: rel, status: 'HASH_MISMATCH', detail: { actual, expected: addon.expectedSha256 } };
    }
  }
  if (addon.abiIndependent) {
    return { relativePath: rel, status: 'NAPI_COMPATIBLE', detail: 'ABI-independent NAPI addon' };
  }
  if (Number(addon.requiredModuleVersion) === Number(runtimeNode.moduleVersion)) {
    return { relativePath: rel, status: 'COMPATIBLE', detail: `moduleVersion ${runtimeNode.moduleVersion} matches` };
  }
  return {
    relativePath: rel,
    status: 'INCOMPATIBLE_ABI',
    detail: `addon built for moduleVersion ${addon.requiredModuleVersion}, runtime is ${runtimeNode.moduleVersion}`
  };
}

/**
 * Evaluate compatibility of a set of native addons against the runtime node.
 * @returns {{compatible:boolean, recommendation:string, runtimeNode:object, addons:Array, summary:string}}
 *   recommendation: 'ACCEPT' | 'REBUILD_REQUIRED' | 'ROLLBACK_REQUIRED'
 */
function evaluateNativeCompatibility({ runtimeNode, addons = [], fsProbe } = {}) {
  if (!runtimeNode || !runtimeNode.ok) {
    return {
      compatible: false,
      recommendation: 'ROLLBACK_REQUIRED',
      runtimeNode: runtimeNode || { ok: false, error: 'RUNTIME_NODE_UNAVAILABLE' },
      addons: [],
      summary: 'runtime node unavailable'
    };
  }
  const evaluated = addons.map(a => classifyAddon(a, runtimeNode, fsProbe));
  const hasBroken = evaluated.some(a => a.status === 'MISSING' || a.status === 'HASH_MISMATCH');
  const hasIncompatible = evaluated.some(a => a.status === 'INCOMPATIBLE_ABI');
  const recommendation = hasBroken ? 'ROLLBACK_REQUIRED' : hasIncompatible ? 'REBUILD_REQUIRED' : 'ACCEPT';
  const compatibleCount = evaluated.filter(a => a.status === 'NAPI_COMPATIBLE' || a.status === 'COMPATIBLE').length;
  return {
    compatible: recommendation === 'ACCEPT',
    recommendation,
    runtimeNode,
    addons: evaluated,
    summary: `moduleVersion=${runtimeNode.moduleVersion}; ${compatibleCount}/${evaluated.length} compatible`
  };
}

/**
 * Convenience entry: probe a node executable and evaluate the given addons against it.
 */
function governRuntimeNodeNativeBinaries(nodeExePath, addons, options = {}) {
  const runNode = options.runNode || spawnNodeProbe;
  const runtimeNode = probeRuntimeNode({ nodeExePath, runNode });
  return evaluateNativeCompatibility({ runtimeNode, addons, fsProbe: options.fsProbe });
}

/**
 * Plan (do not execute) an atomic runtime-node swap with backup.
 * Returns the slot dir, backup dir, and an ordered step list for the installer/updater.
 */
function planRuntimeSwap({ installDir, runtimeSlot = RUNTIME_SLOT, fs } = {}) {
  const base = path.join(installDir, 'resources', 'runtime');
  const slotDir = path.join(base, runtimeSlot);
  const backupDir = path.join(base, `${runtimeSlot}.bak`);
  const steps = [
    { op: 'VERIFY_EXISTS', target: slotDir, description: `ensure current runtime slot "${runtimeSlot}" exists` },
    { op: 'BACKUP', source: slotDir, target: backupDir, description: `move current slot to "${runtimeSlot}.bak"` },
    { op: 'PLACE_NEW', source: '<newRuntime>', target: slotDir, description: 'place replacement runtime node' },
    { op: 'VERIFY_NEW', target: slotDir, description: 'verify replacement `node --version`' }
  ];
  return { installDir, runtimeSlot, slotDir, backupDir, steps };
}

/**
 * Check whether a usable rollback backup exists for the runtime slot.
 */
function verifyRollbackAvailable({ installDir, runtimeSlot = RUNTIME_SLOT, fs, expectedTreeSha256 } = {}) {
  const backupDir = path.join(installDir, 'resources', 'runtime', `${runtimeSlot}.bak`);
  if (!fs || typeof fs.existsSync !== 'function' || !fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    return { available: false, backupDir };
  }
  return { available: true, backupDir };
}

/**
 * Final rollback authority given post-swap health signals.
 * @returns {'KEEP_NEW'|'ROLLBACK'|'BLOCK'}
 */
function decideRollback({ runtimeNodeOk, addonsCompatible, hasBackup } = {}) {
  if (runtimeNodeOk && addonsCompatible) return 'KEEP_NEW';
  if (hasBackup) return 'ROLLBACK';
  return 'BLOCK';
}

module.exports = {
  RUNTIME_SLOT,
  KNOWN_NATIVE_ADDONS,
  spawnNodeProbe,
  probeRuntimeNode,
  classifyAddon,
  evaluateNativeCompatibility,
  governRuntimeNodeNativeBinaries,
  planRuntimeSwap,
  verifyRollbackAvailable,
  decideRollback
};
