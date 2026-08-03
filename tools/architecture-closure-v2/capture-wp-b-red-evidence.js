#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CONTRACTS = Object.freeze([
  Object.freeze({
    id: 'LIFECYCLE',
    testPath: 'backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js',
    expectedMissingIndicators: Object.freeze(['durableExecutionLifecycle'])
  }),
  Object.freeze({
    id: 'DEEP_FREEZE_AND_AUTHORITY_TIME',
    testPath: 'backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js',
    expectedMissingIndicators: Object.freeze(['/lib/deepFreeze', 'authorityTimestamp'])
  }),
  Object.freeze({
    id: 'SCHEMA_23',
    testPath: 'backend/tests/architectureClosureV2/wpB/schema23Migration.test.js',
    expectedMissingIndicators: Object.freeze(['architectureClosureV2WpB'])
  }),
  Object.freeze({
    id: 'DURABLE_EXECUTION_CAS',
    testPath: 'backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js',
    expectedMissingIndicators: Object.freeze(['durableExecutionAuthority'])
  }),
  Object.freeze({
    id: 'EXTERNAL_ACTION_OUTBOX',
    testPath: 'backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js',
    expectedMissingIndicators: Object.freeze(['externalActionOutboxAuthority', 'externalActionDispatcher'])
  }),
  Object.freeze({
    id: 'TRANSACTION_IO_BOUNDARY',
    testPath: 'backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js',
    expectedMissingIndicators: Object.freeze(['authorityTransactionCoordinator.js'])
  }),
  Object.freeze({
    id: 'UNCERTAIN_OUTCOME_RECONCILIATION',
    testPath: 'backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js',
    expectedMissingIndicators: Object.freeze(['externalOutcomeReconciliation'])
  })
]);

const TEST_PATHS = Object.freeze(CONTRACTS.map(contract => contract.testPath));

function normalizeOutput(value) {
  return String(value || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\\/gu, '/')
    .replaceAll(process.cwd().replace(/\\/gu, '/'), '<repo>')
    .replace(/duration_ms:\s*[0-9.]+/gu, 'duration_ms:<normalized>')
    .replace(/# duration_ms\s+[0-9.]+/gu, '# duration_ms <normalized>');
}

function stableExcerpt(output) {
  return output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => !/^TAP version /u.test(line))
    .filter(line => !/^# tests? /u.test(line))
    .filter(line => !/^# suites? /u.test(line))
    .filter(line => !/^# pass /u.test(line))
    .filter(line => !/^# fail /u.test(line))
    .filter(line => !/^# cancelled /u.test(line))
    .filter(line => !/^# skipped /u.test(line))
    .filter(line => !/^# todo /u.test(line))
    .slice(0, 30)
    .join('\n');
}

function classifyContract(contract) {
  const absoluteTestPath = path.resolve(process.cwd(), contract.testPath);
  if (!fs.existsSync(absoluteTestPath)) {
    return Object.freeze({
      id: contract.id,
      testPath: contract.testPath,
      status: 'INVALID_RED_INFRASTRUCTURE',
      exitCode: 2,
      matchedIndicators: [],
      outputSha256: '',
      excerpt: `test file missing: ${contract.testPath}`
    });
  }

  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', contract.testPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024
  });
  const normalized = normalizeOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
  const matchedIndicators = contract.expectedMissingIndicators.filter(indicator => normalized.includes(indicator));
  const hasRunnerFailure = Boolean(result.error || result.signal);
  const exitCode = Number.isInteger(result.status) ? result.status : 2;

  let status;
  if (exitCode === 0) {
    status = 'GREEN';
  } else if (!hasRunnerFailure && matchedIndicators.length > 0) {
    status = 'VALID_CAPABILITY_RED';
  } else {
    status = 'INVALID_RED_INFRASTRUCTURE';
  }

  return Object.freeze({
    id: contract.id,
    testPath: contract.testPath,
    status,
    exitCode,
    signal: String(result.signal || ''),
    spawnError: result.error ? String(result.error.message || result.error) : '',
    matchedIndicators,
    outputSha256: crypto.createHash('sha256').update(normalized).digest('hex'),
    excerpt: stableExcerpt(normalized)
  });
}

function runRedContracts() {
  const contracts = CONTRACTS.map(classifyContract);
  const counts = Object.freeze({
    green: contracts.filter(contract => contract.status === 'GREEN').length,
    validCapabilityRed: contracts.filter(contract => contract.status === 'VALID_CAPABILITY_RED').length,
    invalidRedInfrastructure: contracts.filter(contract => contract.status === 'INVALID_RED_INFRASTRUCTURE').length
  });
  const status = counts.invalidRedInfrastructure > 0
    ? 'INVALID_RED_INFRASTRUCTURE'
    : counts.validCapabilityRed > 0
      ? 'VALID_CAPABILITY_RED'
      : 'GREEN';
  const report = Object.freeze({
    schemaVersion: 2,
    documentType: 'YANCE_ACV2_WP_B_M1_CONTRACT_EXECUTION',
    status,
    testPaths: TEST_PATHS,
    productionImplementationExpectedAbsent: status === 'VALID_CAPABILITY_RED',
    counts,
    contracts
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  const report = runRedContracts();
  process.exitCode = report.status === 'GREEN'
    ? 0
    : report.status === 'VALID_CAPABILITY_RED'
      ? 1
      : 2;
}

module.exports = {
  CONTRACTS,
  TEST_PATHS,
  classifyContract,
  normalizeOutput,
  runRedContracts
};
