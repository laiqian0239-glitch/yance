'use strict';

/**
 * M10 — Developer Toolkit (pure, wires prior-module capabilities into dev-facing checks).
 *
 * Consolidates developer tooling introduced across M2..M9 into one contract-validation
 * and diagnostics surface:
 *   - validateLayoutContract : M6 release-layout contract (production / dev)
 *   - validateIpcManifestDenylist : M2 ipcManifest `rebuild-native` denylist stays intact
 *   - validateNativeGovernance : M8 native addon ABI compatibility vs bundled node
 *   - diagnose : M9 headless verification gate + M8 native governance health
 *
 * All external I/O (fs, node spawn, orchestrator) is injectable so the logic is unit-testable.
 */

const fs = require('node:fs');
const path = require('node:path');

function loadReleaseLayout() { return require('../../electron/m2/releaseLayout'); }
function ipcManifestPath() { return path.join(__dirname, '..', '..', 'electron', 'm2', 'ipcManifest.json'); }
function loadNativeGovernance() { return require('../../electron/m2/nativeBinaryGovernance'); }
function loadOrchestrator() { return require('../wp9/verifyOrchestrator'); }

function validateLayoutContract({ mode = 'production', cwd = process.cwd(), resourcesPath, existsSync } = {}) {
  const rl = loadReleaseLayout();
  const ctx = { installDir: cwd, resourcesPath: resourcesPath || cwd };
  const res = rl.validateLayout(mode, ctx, existsSync ? { existsSync } : undefined);
  return { name: 'release-layout', mode, valid: res.valid, missing: res.missingKeys, present: res.presentKeys };
}

function validateIpcManifestDenylist({ manifestPath } = {}) {
  const p = manifestPath || ipcManifestPath();
  if (!fs.existsSync(p)) return { name: 'ipc-manifest-denylist', valid: false, reason: 'manifest missing' };
  const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
  const denied = (manifest.denylist || []).map(d => (typeof d === 'string' ? d : d.action));
  const rebuildNativeDenied = denied.includes('rebuild-native');
  return { name: 'ipc-manifest-denylist', valid: rebuildNativeDenied, deniedActions: denied, rebuildNativeDenied };
}

function validateNativeGovernance({ nodeExePath = process.execPath, runNode, fsProbe } = {}) {
  const ng = loadNativeGovernance();
  const report = ng.governRuntimeNodeNativeBinaries(nodeExePath, ng.KNOWN_NATIVE_ADDONS, { runNode, fsProbe });
  return { name: 'native-governance', valid: report.compatible, recommendation: report.recommendation, summary: report.summary };
}

function validateContracts(opts = {}) {
  const contracts = [
    validateLayoutContract(opts),
    validateIpcManifestDenylist(opts),
    validateNativeGovernance(opts)
  ];
  return { contracts, allValid: contracts.every(c => c.valid) };
}

function diagnose({ runAll, runNode, requireRealMachine = false } = {}) {
  const orch = loadOrchestrator();
  const runAllFn = runAll || orch.runAll;
  const verification = runAllFn({ tiers: ['headless'], requireRealMachine });
  const native = validateNativeGovernance({ runNode });
  return {
    verificationGate: verification.gate,
    nativeGovernance: native,
    healthy: verification.gate.passed && native.valid
  };
}

function formatContracts(result) {
  const lines = ['# Contract Validation', ''];
  for (const c of result.contracts) {
    lines.push(`- [${c.valid ? 'PASS' : 'FAIL'}] ${c.name}` + (c.reason ? ` (${c.reason})` : ''));
  }
  lines.push('');
  lines.push(`OVERALL: ${result.allValid ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

module.exports = {
  loadReleaseLayout,
  ipcManifestPath,
  loadNativeGovernance,
  loadOrchestrator,
  validateLayoutContract,
  validateIpcManifestDenylist,
  validateNativeGovernance,
  validateContracts,
  diagnose,
  formatContracts
};
