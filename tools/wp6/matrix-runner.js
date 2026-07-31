'use strict';
const { ROOT, runNode, utcNow } = require('./common');
function parseTap(text) {
  const tests = Number((text.match(/^# tests (\d+)$/m) || [])[1] || 0);
  const pass = Number((text.match(/^# pass (\d+)$/m) || [])[1] || 0);
  const fail = Number((text.match(/^# fail (\d+)$/m) || [])[1] || 0);
  const skipped = Number((text.match(/^# skipped (\d+)$/m) || [])[1] || 0);
  return { tests, passed: pass, failed: fail, skipped };
}
function runMatrix(matrixType, definitions) {
  const cases = [];
  for (const definition of definitions) {
    const result = runNode(definition.command, { cwd: ROOT, timeout: definition.timeout || 180000, env: definition.env });
    const tap = parseTap(result.stdout);
    const passed = result.status === 0;
    cases.push({ id: definition.id, category: definition.category, injectedCondition: definition.injectedCondition, expectedOracle: definition.expectedOracle, command: [process.execPath, ...definition.command].join(' '), status: passed ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal || null, tests: tap.tests, passedTests: tap.passed, failedTests: tap.failed, skippedTests: tap.skipped, outputTail: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).slice(-24) });
  }
  const passed = cases.filter(row => row.status === 'PASS').length;
  return { schemaVersion: 1, stage: '6.4.5.9', workPackage: 'WP6', matrixType, generatedAtUtc: utcNow(), status: passed === cases.length ? 'PASS' : 'FAIL', summary: { total: cases.length, passed, failed: cases.length - passed }, cases };
}
module.exports = { runMatrix };
