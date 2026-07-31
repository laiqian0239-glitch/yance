'use strict';

/**
 * M9 — Verification Orchestrator (pure, injectable spawn).
 *
 * Centrally runs the M1..M10 acceptance suite with two layers:
 *   - headless:    release-blocking test commands runnable in CI / sandbox (no Electron / NSIS / real Windows).
 *   - real-machine: formal verify scripts that require a packaged Windows host (M1 owner-exit, M7 pre-review).
 *
 * Produces a consolidated report and a regression gate. The gate FAILS if any selected
 * headless module fails; a real-machine failure only fails the gate when --require-real-machine.
 *
 * All external execution is behind an injectable `spawn` so the orchestration logic is unit-testable.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Module registry. `headless` runs in CI; `realMachine` (optional) runs on a packaged Windows host. */
const MODULES = Object.freeze([
  { id: 'M1', label: 'M1 Windows Owner-Exit (FD6 custody)', tier: 'real-machine', headless: null, realMachine: 'npm run verify:m1:windows' },
  { id: 'M2', label: 'M2 Electron Main: WP2 + sound notification regression', tier: 'headless', headless: 'npm run verify:m2' },
  { id: 'M3', label: 'M3 Backend Runtime: lease liveness', tier: 'headless', headless: 'node --test tests/wp3/m3-*.test.js' },
  { id: 'M4', label: 'M4 Owner Recovery', tier: 'headless', headless: 'node --test tests/wp4/m4-*.test.js' },
  { id: 'M5', label: 'M5 SQLite Ownership', tier: 'headless', headless: 'node --test tests/wp5/m5-*.test.js' },
  { id: 'M6', label: 'M6 Release Layout contract', tier: 'headless', headless: 'node --test tests/wp6/m6-*.test.js' },
  { id: 'M7', label: 'M7 Installer orchestration', tier: 'headless', headless: 'node --test tests/wp7/m7-*.test.js', realMachine: 'node tools/wp7/run-required-tests.js --mode PRE_REVIEW' },
  { id: 'M8', label: 'M8 Native Binary governance', tier: 'headless', headless: 'node --test tests/wp8/*.test.js' },
  { id: 'M9', label: 'M9 Test System orchestration', tier: 'headless', headless: 'node --test tests/wp9/*.test.js' },
  { id: 'M10', label: 'M10 Developer Toolkit', tier: 'headless', headless: 'node --test tests/wp10/*.test.js' }
]);

function defaultSpawn(command, options = {}) {
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  const { spawnSync } = require('node:child_process');
  const started = Date.now();
  const result = spawnSync(command, { shell: true, encoding: 'utf8', timeout: options.timeout || 600000, windowsHide: true, cwd: options.cwd });
  const durationMs = Date.now() - started;
  if (result.error) {
    return { status: 1, stdout: result.stdout || '', stderr: String((result.error && result.error.message) || ''), durationMs, error: result.error.message };
  }
  return { status: result.status === null ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || '', durationMs };
}

/** Extract the test glob from a `node --test <glob>` command, else null. */
function extractTestGlob(command) {
  const m = String(command || '').match(/^node\s+--test\s+(.+)$/);
  return m ? m[1].trim() : null;
}

/** Minimal glob existence check for `dir/*.test.js` and `dir/prefix*.test.js` shapes. */
function hasTestFiles(glob) {
  if (!glob) return false;
  const dir = path.dirname(glob);
  const base = path.basename(glob);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const re = new RegExp('^' + base.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return fs.readdirSync(dir).some(name => re.test(name));
}

function runCommand(command, { spawn = defaultSpawn, cwd, timeout } = {}) {
  const started = Date.now();
  let res;
  try {
    res = spawn(command, { cwd, timeout });
  } catch (err) {
    return { command, ok: false, code: 1, durationMs: Date.now() - started, stdout: '', stderr: String((err && err.message) || err), error: String((err && err.message) || err) };
  }
  return { command, ok: res.status === 0, code: res.status, durationMs: res.durationMs != null ? res.durationMs : (Date.now() - started), stdout: res.stdout, stderr: res.stderr };
}

function selectCommand(mod, tier) {
  if (tier === 'real-machine') return mod.realMachine || mod.headless;
  return mod.headless;
}

function runModule(mod, { spawn, cwd, tier = 'headless', timeout } = {}) {
  const command = selectCommand(mod, tier);
  if (!command) return { id: mod.id, label: mod.label, tier: mod.tier, status: 'SKIPPED', reason: 'no command for tier', command: null };
  // Forward-compatible: a module whose unit-test glob has no files yet is SKIPPED, not FAILED.
  const glob = extractTestGlob(command);
  if (glob && !hasTestFiles(glob)) {
    return { id: mod.id, label: mod.label, tier: mod.tier, status: 'SKIPPED', reason: 'no test files match', command };
  }
  const r = runCommand(command, { spawn, cwd, timeout });
  return { id: mod.id, label: mod.label, tier: mod.tier, status: r.ok ? 'PASS' : 'FAIL', command, code: r.code, durationMs: r.durationMs, stdout: r.stdout, stderr: r.stderr };
}

function runAll({ tiers = ['headless'], modules, spawn, cwd, timeout, requireRealMachine = false } = {}) {
  const selected = (modules && modules.length)
    ? MODULES.filter(m => modules.includes(m.id))
    : MODULES.slice();
  const results = [];
  for (const mod of selected) {
    const effectiveTier = mod.tier === 'real-machine' ? 'real-machine' : 'headless';
    if (!tiers.includes(effectiveTier)) {
      results.push({ id: mod.id, label: mod.label, tier: mod.tier, status: 'SKIPPED', reason: `tier ${effectiveTier} not selected` });
      continue;
    }
    results.push(runModule(mod, { spawn, cwd, tier: effectiveTier, timeout }));
  }
  return { results, gate: evaluateGate(results, { requireRealMachine }) };
}

function evaluateGate(results, { requireRealMachine = false } = {}) {
  const passed = results.filter(r => r.status === 'PASS');
  const failed = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIPPED');
  const headlessFailed = failed.filter(r => r.tier === 'headless');
  const realMachineFailed = failed.filter(r => r.tier === 'real-machine');
  let passed_gate = true;
  if (headlessFailed.length) passed_gate = false;
  if (requireRealMachine && realMachineFailed.length) passed_gate = false;
  return {
    passed: passed_gate,
    passedCount: passed.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    headlessFailed: headlessFailed.map(r => r.id),
    realMachineFailed: realMachineFailed.map(r => r.id),
    requireRealMachine
  };
}

function formatReport(run, opts = {}) {
  const lines = [];
  lines.push('# 言策（Yance）验证报告');
  lines.push('');
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push(`- gate: ${run.gate.passed ? 'PASS' : 'FAIL'} (requireRealMachine=${!!run.gate.requireRealMachine})`);
  lines.push(`- passed=${run.gate.passedCount} failed=${run.gate.failedCount} skipped=${run.gate.skippedCount}`);
  if (run.gate.headlessFailed.length) lines.push(`- headlessFailed: ${run.gate.headlessFailed.join(', ')}`);
  if (run.gate.realMachineFailed.length) lines.push(`- realMachineFailed: ${run.gate.realMachineFailed.join(', ')}`);
  lines.push('');
  lines.push('| Module | Tier | Status | Code | Duration(ms) |');
  lines.push('|---|---|---|---|---|');
  for (const r of run.results) {
    lines.push(`| ${r.id} | ${r.tier} | ${r.status} | ${r.code != null ? r.code : '-'} | ${r.durationMs != null ? r.durationMs : '-'} |`);
  }
  return lines.join('\n');
}

module.exports = {
  MODULES,
  defaultSpawn,
  extractTestGlob,
  hasTestFiles,
  runCommand,
  selectCommand,
  runModule,
  runAll,
  evaluateGate,
  formatReport
};
