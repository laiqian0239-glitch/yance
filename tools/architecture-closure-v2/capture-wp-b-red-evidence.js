#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const TEST_PATHS = Object.freeze([
  'backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js',
  'backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js',
  'backend/tests/architectureClosureV2/wpB/schema23Migration.test.js',
  'backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js',
  'backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js',
  'backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js',
  'backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js'
]);

function normalizeOutput(value) {
  return String(value || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\\/gu, '/')
    .replace(/duration_ms:\s*[0-9.]+/gu, 'duration_ms:<normalized>')
    .replace(/# duration_ms\s+[0-9.]+/gu, '# duration_ms <normalized>');
}

function runRedContracts() {
  const args = ['--test', '--test-concurrency=1', ...TEST_PATHS];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const normalized = normalizeOutput(`${stdout}\n${stderr}`);
  const report = Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_M1_RED_EXECUTION',
    testPaths: TEST_PATHS,
    command: [process.execPath, ...args],
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: String(result.signal || ''),
    outputSha256: crypto.createHash('sha256').update(normalized).digest('hex'),
    productionImplementationExpectedAbsent: true
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  const report = runRedContracts();
  process.exitCode = report.exitCode;
}

module.exports = {
  TEST_PATHS,
  normalizeOutput,
  runRedContracts
};
