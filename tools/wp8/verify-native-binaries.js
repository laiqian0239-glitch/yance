'use strict';

/**
 * M8 acceptance CLI — verify native-binary / runtime-node governance for an install.
 *
 * Usage:
 *   node tools/wp8/verify-native-binaries.js [--install-dir=<dir>] [--runtime-node=<exe>]
 *
 * In dev (no --install-dir) it probes process.execPath and scans ./node_modules.
 * Exits 0 when the native addon set is ACCEPT-compatible with the bundled runtime node,
 * non-zero (1 = incompatible, 2 = probe failure) otherwise, so CI can gate on it.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const gov = require('../../electron/m2/nativeBinaryGovernance');

function findNativeAddons(rootDir) {
  const found = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.node')) {
        const relativePath = path.relative(rootDir, full).split(path.sep).join('/');
        found.push({ relativePath, abiIndependent: /napi/i.test(e.name), platform: process.platform, arch: process.arch });
      }
    }
  }
  walk(path.join(rootDir, 'node_modules'));
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const runtimeNodeArg = args.find(a => a.startsWith('--runtime-node='))?.split('=')[1];
  const installDirArg = args.find(a => a.startsWith('--install-dir='))?.split('=')[1];

  const nodeExe = runtimeNodeArg
    || (installDirArg
      ? path.join(installDirArg, 'resources', 'runtime', 'node22', process.platform === 'win32' ? 'node.exe' : 'node')
      : process.execPath);
  const rootDir = installDirArg ? path.join(installDirArg, 'resources', 'app') : process.cwd();

  const runtimeNode = gov.probeRuntimeNode({ nodeExePath: nodeExe });
  if (!runtimeNode.ok) {
    console.error(JSON.stringify({ ok: false, stage: 'probe', error: runtimeNode.error }, null, 2));
    process.exit(2);
  }

  const addons = findNativeAddons(rootDir);
  const report = gov.evaluateNativeCompatibility({
    runtimeNode,
    addons,
    fsProbe: {
      exists: rel => fs.existsSync(path.join(rootDir, rel)),
      sha256: rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, rel))).digest('hex')
    }
  });

  const rollback = installDirArg ? gov.verifyRollbackAvailable({ installDir: installDirArg, fs }) : { available: false };
  const swap = gov.planRuntimeSwap({ installDir: installDirArg || process.cwd() });

  const out = {
    ok: report.compatible,
    recommendation: report.recommendation,
    runtimeNode,
    addons: report.addons,
    summary: report.summary,
    rollbackAvailable: rollback.available,
    swapPlan: swap.steps.map(s => s.op)
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(report.compatible ? 0 : 1);
}

main();
