'use strict';

/**
 * M9 acceptance CLI — run the M1..M10 verification suite with headless / real-machine layering.
 *
 * Usage:
 *   node tools/wp9/verify-all.js [--tier=headless|real-machine|all] [--modules=M2,M3,...]
 *                                [--require-real-machine] [--report-dir=<dir>]
 *
 * Exits 0 when the regression gate passes, 1 otherwise. Writes evidence/wp9/verify-report.json + .md.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runAll, formatReport, MODULES } = require('./verifyOrchestrator');
const { runSourceRegressions } = require('../verify-source-regressions');

function parseArgs(argv) {
  const out = { tier: 'all', modules: null, requireRealMachine: false, reportDir: 'evidence/wp9' };
  for (const a of argv) {
    if (a.startsWith('--tier=')) out.tier = a.split('=')[1];
    else if (a.startsWith('--modules=')) out.modules = a.split('=')[1].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--require-real-machine') out.requireRealMachine = true;
    else if (a.startsWith('--report-dir=')) out.reportDir = a.split('=')[1];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let sourceRegression;
  try {
    sourceRegression = runSourceRegressions();
  } catch (error) {
    console.error(`\nSOURCE REGRESSION GATE: FAIL\n${error && error.stack ? error.stack : error}`);
    process.exit(1);
  }
  const tiers = args.tier === 'all' ? ['headless', 'real-machine'] : [args.tier];
  const run = runAll({
    tiers,
    modules: args.modules,
    requireRealMachine: args.requireRealMachine,
    cwd: process.cwd()
  });

  run.sourceRegression = sourceRegression;
  console.log(formatReport(run));
  console.log(`\nGATE: ${run.gate.passed ? 'PASS' : 'FAIL'}`);

  try {
    fs.mkdirSync(args.reportDir, { recursive: true });
    fs.writeFileSync(path.join(args.reportDir, 'verify-report.json'), JSON.stringify(run, null, 2));
    fs.writeFileSync(path.join(args.reportDir, 'verify-report.md'), formatReport(run));
  } catch (err) {
    console.error('Failed to write report:', err.message);
  }

  process.exit(run.gate.passed ? 0 : 1);
}

main();
