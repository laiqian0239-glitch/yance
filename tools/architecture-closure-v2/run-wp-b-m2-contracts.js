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
  'backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js',
  'backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js',
  'backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js'
]);
const INFRASTRUCTURE_FAILURE_PATTERNS = Object.freeze([
  /MODULE_NOT_FOUND/u,
  /ERR_MODULE_NOT_FOUND/u,
  /SyntaxError:/u,
  /Could not resolve host/iu,
  /npm ERR!/u
]);
const SAFE_DIAGNOSTIC_FIELDS = Object.freeze(new Set([
  'code',
  'terminationClass',
  'providerRequestId',
  'attemptId',
  'executionId',
  'intentId',
  'dispatchAttemptId',
  'status',
  'ownerId',
  'generation',
  'fencingToken'
]));
const SAFE_ENUM_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const SAFE_FIXTURE_ID_PATTERN = /^(?:attempt|execution|intent|provider-req|dispatch|claim|owner|host|lease|fence|generation)-[a-z0-9][a-z0-9-]{0,95}$/u;
const SAFE_NUMBER_PATTERN = /^-?\d{1,18}$/u;
const SAFE_METADATA_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const MAX_FAILURE_DIAGNOSTICS = 32;
const MAX_FAILURE_BLOCK_LINES = 160;
const MAX_DIAGNOSTIC_FACTS = 8;

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

function unquoteScalar(value) {
  const scalar = String(value || '').trim();
  if (scalar.length >= 2 && (
    (scalar[0] === "'" && scalar.at(-1) === "'")
    || (scalar[0] === '"' && scalar.at(-1) === '"')
  )) {
    return scalar.slice(1, -1);
  }
  return scalar;
}

function isUnsafeDiagnosticScalar(value) {
  return value.length === 0
    || value.length > 128
    || value.includes('@')
    || /^https?:/iu.test(value)
    || /^bearer\b/iu.test(value)
    || /^sk-/iu.test(value);
}

function safeDiagnosticScalar(value) {
  const scalar = unquoteScalar(value);
  if (isUnsafeDiagnosticScalar(scalar)) return null;
  return SAFE_ENUM_PATTERN.test(scalar)
    || SAFE_FIXTURE_ID_PATTERN.test(scalar)
    || SAFE_NUMBER_PATTERN.test(scalar)
    ? scalar
    : null;
}

function safeMetadataScalar(value) {
  const scalar = unquoteScalar(value);
  if (isUnsafeDiagnosticScalar(scalar)) return null;
  return SAFE_METADATA_PATTERN.test(scalar) ? scalar : null;
}

function repositoryLocation(value) {
  const scalar = unquoteScalar(value)
    .replace(/\\/gu, '/')
    .replace(/^\(/u, '')
    .replace(/\)$/u, '');
  const match = scalar.match(/(?:^|\/)((?:backend|tools|electron|shared|governance|\.github)\/[A-Za-z0-9_.\/-]+:\d+:\d+)$/u);
  return match ? match[1] : null;
}

function topLevelScalar(block, key, parser = safeDiagnosticScalar) {
  const match = block.match(new RegExp(`^  ${key}:\\s*(.+)$`, 'mu'));
  return match ? parser(match[1]) : null;
}

function sectionFacts(block, section) {
  const lines = block.split('\n');
  const start = lines.findIndex(line => line === `  ${section}:`);
  if (start < 0) return Object.freeze({});

  const facts = {};
  for (let index = start + 1; index < lines.length && Object.keys(facts).length < MAX_DIAGNOSTIC_FACTS; index += 1) {
    const line = lines[index];
    if (/^  \S/u.test(line)) break;
    const match = line.match(/^    ([A-Za-z][A-Za-z0-9]*):\s*(.+)$/u);
    if (!match || !SAFE_DIAGNOSTIC_FIELDS.has(match[1])) continue;
    const scalar = safeDiagnosticScalar(match[2]);
    if (scalar !== null) facts[match[1]] = scalar;
  }
  return Object.freeze(facts);
}

function failureDiagnostics(output) {
  const lines = normalizeOutput(output).split('\n');
  const diagnostics = [];

  for (let index = 0; index < lines.length && diagnostics.length < MAX_FAILURE_DIAGNOSTICS; index += 1) {
    const match = lines[index].match(/^not ok \d+ - (M2-[A-Z]+-\d{3})\b/u);
    if (!match) continue;

    let end = index + 1;
    while (
      end < lines.length
      && end - index <= MAX_FAILURE_BLOCK_LINES
      && !/^(?:not ok|ok) \d+ - /u.test(lines[end])
      && !/^1\.\.\d+$/u.test(lines[end])
    ) {
      end += 1;
    }

    const block = lines.slice(index, end).join('\n');
    const locationMatch = block.match(/^  location:\s*(.+)$/mu);
    diagnostics.push(Object.freeze({
      contractId: match[1],
      errorCode: topLevelScalar(block, 'code'),
      errorName: topLevelScalar(block, 'name', safeMetadataScalar),
      operator: topLevelScalar(block, 'operator', safeMetadataScalar),
      location: locationMatch ? repositoryLocation(locationMatch[1]) : null,
      expected: sectionFacts(block, 'expected'),
      actual: sectionFacts(block, 'actual')
    }));
    index = end - 1;
  }

  return Object.freeze(diagnostics);
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
    failureDiagnostics: failureDiagnostics(normalizedOutput),
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
    failureDiagnostics: report.failureDiagnostics || Object.freeze([]),
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
  failureDiagnostics,
  normalizeOutput,
  publicReport,
  runWpBM2Contracts,
  sha256,
  writeReport
});
