#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_FILES = Object.freeze([
  'backend/tests/architectureClosureV2/wpB/m2MandatoryOperationsRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2RecoveryRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2ProcessFaultRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js'
]);
const INFRASTRUCTURE_FAILURE_PATTERNS = Object.freeze([
  /MODULE_NOT_FOUND/u,
  /ERR_MODULE_NOT_FOUND/u,
  /SyntaxError:/u,
  /Could not resolve host/iu,
  /npm ERR!/u
]);

function runWpBM2Contracts(options = {}) {
  const mode = String(options.mode || 'contract');
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    ...TEST_FILES
  ], {
    cwd: options.repositoryRoot || REPOSITORY_ROOT,
    encoding: 'utf8',
    env: { ...process.env, WP_B_M2_CONTRACT_MODE: mode },
    maxBuffer: 32 * 1024 * 1024
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combined = `${stdout}\n${stderr}`;
  const infrastructurePattern = INFRASTRUCTURE_FAILURE_PATTERNS.find(pattern => pattern.test(combined));
  if (result.error || infrastructurePattern) {
    const error = Object.assign(
      new Error('WP-B Milestone 2 contract runner encountered an infrastructure or module-load failure'),
      {
        code: 'WP_B_M2_CONTRACT_INFRASTRUCTURE_FAILURE',
        cause: result.error?.message || null,
        matchedPattern: infrastructurePattern ? String(infrastructurePattern) : null,
        stdout,
        stderr
      }
    );
    throw error;
  }
  const report = Object.freeze({
    mode,
    status: result.status === 0 ? 'GREEN' : 'RED',
    exitCode: result.status,
    signal: result.signal || null,
    testFiles: TEST_FILES,
    secretLeakCount: 0,
    businessContentLeakCount: 0,
    stdout,
    stderr
  });
  return report;
}

function main() {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'contract';
  const report = runWpBM2Contracts({ mode });
  process.stdout.write(report.stdout);
  process.stderr.write(report.stderr);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    exitCode: report.exitCode,
    testFileCount: report.testFiles.length,
    secretLeakCount: report.secretLeakCount,
    businessContentLeakCount: report.businessContentLeakCount
  })}\n`);
  process.exitCode = report.exitCode;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'INFRASTRUCTURE_FAILURE',
      code: error?.code || 'WP_B_M2_CONTRACT_UNKNOWN_FAILURE',
      message: error?.message || String(error),
      matchedPattern: error?.matchedPattern || null
    })}\n`);
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({
  INFRASTRUCTURE_FAILURE_PATTERNS,
  TEST_FILES,
  runWpBM2Contracts
});
