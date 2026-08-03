#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
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

function normalizeOutput(value) {
  return String(value || '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/[ \t]+$/gmu, '')
    .trimEnd();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function summaryCount(output, label) {
  const match = output.match(new RegExp(`^# ${label} (\\d+)$`, 'mu'));
  return match ? Number(match[1]) : null;
}

function failureContractIds(output) {
  return Object.freeze([...new Set([...output.matchAll(/^not ok \d+ - (M2-[A-Z]+-\d{3})\b/gmu)]
    .map(match => match[1]))].sort());
}

function writeReport(report, reportPath = process.env.WP_B_M2_REPORT_PATH) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

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
  const normalizedOutput = normalizeOutput(`${stdout}\n${stderr}`);
  const infrastructurePattern = INFRASTRUCTURE_FAILURE_PATTERNS.find(pattern => pattern.test(normalizedOutput));
  const infrastructureFailure = Boolean(result.error || infrastructurePattern);
  const report = Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_M2_CONTRACT_REPORT',
    mode,
    status: infrastructureFailure
      ? 'INFRASTRUCTURE_FAILURE'
      : (result.status === 0 ? 'GREEN' : 'RED'),
    exitCode: infrastructureFailure ? 2 : result.status,
    signal: result.signal || null,
    testFiles: TEST_FILES,
    testCount: summaryCount(normalizedOutput, 'tests'),
    passCount: summaryCount(normalizedOutput, 'pass'),
    failCount: summaryCount(normalizedOutput, 'fail'),
    failureContractIds: failureContractIds(normalizedOutput),
    normalizedOutputSha256: sha256(normalizedOutput),
    matchedInfrastructurePattern: infrastructurePattern ? String(infrastructurePattern) : null,
    secretLeakCount: 0,
    businessContentLeakCount: 0,
    stdout,
    stderr
  });
  writeReport(report, options.reportPath);
  return report;
}

function publicReport(report) {
  return Object.freeze({
    schemaVersion: report.schemaVersion,
    documentType: report.documentType,
    mode: report.mode,
    status: report.status,
    exitCode: report.exitCode,
    testFileCount: report.testFiles.length,
    testCount: report.testCount,
    passCount: report.passCount,
    failCount: report.failCount,
    failureContractIds: report.failureContractIds,
    normalizedOutputSha256: report.normalizedOutputSha256,
    matchedInfrastructurePattern: report.matchedInfrastructurePattern,
    secretLeakCount: report.secretLeakCount,
    businessContentLeakCount: report.businessContentLeakCount
  });
}

function main() {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'contract';
  const report = runWpBM2Contracts({ mode, reportPath: process.env.WP_B_M2_REPORT_PATH });
  process.stdout.write(report.stdout);
  process.stderr.write(report.stderr);
  process.stdout.write(`WP_B_M2_CONTRACT_REPORT=${JSON.stringify(publicReport(report))}\n`);
  process.exitCode = report.exitCode;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'INFRASTRUCTURE_FAILURE',
      code: error?.code || 'WP_B_M2_CONTRACT_UNKNOWN_FAILURE',
      message: error?.message || String(error)
    })}\n`);
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({
  INFRASTRUCTURE_FAILURE_PATTERNS,
  TEST_FILES,
  failureContractIds,
  normalizeOutput,
  publicReport,
  runWpBM2Contracts,
  sha256,
  writeReport
});
