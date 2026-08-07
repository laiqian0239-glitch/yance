#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REQUIRED_TESTS = Object.freeze([
  'tests/verification/jcs.test.js',
  'tests/verification/canonical-evidence-receipt.test.js',
  'tests/verification/command-set-registry.test.js',
  'tests/verification/executor-registry.test.js',
  'tests/verification/signed-executor-verifier.test.js',
  'tests/verification/runner.test.js',
  'tests/verification/cli.test.js',
  'tests/verification/github-actions-verifier.test.js',
  'tests/verification/requirement-aggregator.test.js',
  'tests/verification/adversarial.test.js'
]);

function runRequiredTests({ repoRoot = path.resolve(__dirname, '..', '..') } = {}) {
  for (const file of REQUIRED_TESTS) {
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: repoRoot,
      shell: false,
      stdio: 'inherit'
    });
    if (result.status !== 0 || result.signal || result.error) return { pass: false, file, status: result.status, signal: result.signal, error: result.error || null };
  }
  return { pass: true, files: [...REQUIRED_TESTS] };
}

if (require.main === module) process.exitCode = runRequiredTests().pass ? 0 : 1;
module.exports = { REQUIRED_TESTS, runRequiredTests };
