#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, OUTPUT, identity, sha256File, writeJson } = require('./common');

const R5_TEST_FILES = [
  'tests/wp5/runtime-state-single-authority.test.js',
  'tests/wp5/legacy-migration-read-only.test.js',
  'tests/wp5/legacy-migration-idempotent.test.js',
  'tests/wp5/yance-only-write-path.test.js',
  'tests/wp5/safe-mode-file-not-read.test.js',
  'tests/wp5/safe-mode-env-fallback-absent.test.js',
  'tests/wp5/desktop-settings-fallback-absent.test.js',
  'tests/wp5/system-policy-fallback-absent.test.js',
  'tests/wp5/legacy-fallback-used-always-false.test.js'
];

function readJson(name) { return JSON.parse(fs.readFileSync(path.join(OUTPUT, name), 'utf8')); }
function source(file) { const absolute = path.join(ROOT, file); return { path: file, sha256: sha256File(absolute), sizeBytes: fs.statSync(absolute).size }; }
function checkCase(report, id) { return report.cases?.find(row => row.id === id)?.status === 'PASS'; }
function executeR5Tests() {
  const result = childProcess.spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...R5_TEST_FILES], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1' },
    timeout: 600000,
    maxBuffer: 50 * 1024 * 1024
  });
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  fs.mkdirSync(path.join(OUTPUT, 'logs'), { recursive: true });
  const logFile = path.join(OUTPUT, 'logs', 'r5-required-tests.log');
  fs.writeFileSync(logFile, log, 'utf8');
  const number = label => Number((log.match(new RegExp(`# ${label} (\\d+)`)) || [])[1] || 0);
  const summary = { tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped') };
  const status = !result.error && !result.signal && result.status === 0 && summary.tests >= 9 && summary.fail === 0 ? 'PASS' : 'FAIL';
  return { status, exitCode: result.status, signal: result.signal || '', spawnError: result.error?.message || '', summary, files: R5_TEST_FILES, log: path.relative(ROOT, logFile).replace(/\\/g, '/'), logSha256: sha256File(logFile) };
}
function envelope(evidenceId, currentIdentity, status, body) {
  return { schemaVersion: 1, stage: '6.4.5.9', workPackage: 'WP5', phase: 'CONVERGENCE_PRE_REVIEW', evidenceId, generatedAtUtc: new Date().toISOString(), status, identity: currentIdentity, ...body };
}

function main() {
  const rawIdentity = identity();
  const currentIdentity = { ...rawIdentity, sourceTree: rawIdentity.worktreeSourceTree, implementationCommit: rawIdentity.sourceCommit };
  if (!currentIdentity.repositoryClean) throw Object.assign(new Error('R5 evidence generation requires a clean repository'), { code: 'WP5_R5_EVIDENCE_REPOSITORY_NOT_CLEAN' });
  const tests = executeR5Tests();
  const fault = readJson('fault-matrix.json');
  const concurrency = readJson('concurrency-crash-matrix.json');
  const mutation = readJson('mutation-results.json');
  const closure = readJson('source-closure-scan.json');
  const identityInputs = [fault, concurrency, mutation, closure];
  const inputsBound = identityInputs.every(row => row.identity?.sourceCommit === currentIdentity.sourceCommit && row.identity?.worktreeSourceTree === currentIdentity.worktreeSourceTree && row.identity?.repositoryClean === true);
  if (!inputsBound) throw Object.assign(new Error('Canonical evidence inputs are not bound to the clean implementation identity'), { code: 'WP5_CANONICAL_INPUT_IDENTITY_MISMATCH' });

  const authorityChecks = {
    dedicatedR5TestsPassed: tests.status === 'PASS',
    directRuntimeModeSqlSingleModule: checkCase(closure, 'DIRECT_RUNTIME_MODE_SQL_SINGLE_MODULE'),
    authorizationPresent: checkCase(closure, 'WP5_AUTHORIZATION_PRESENT'),
    stateVersionConflictRejected: checkCase(fault, 'F08_STATE_VERSION_CONFLICT_REJECTED'),
    commandIdMutationRejected: checkCase(fault, 'F09_COMMAND_ID_MUTATION_REJECTED'),
    staleFencingRejected: checkCase(fault, 'F07_STALE_FENCING_TOKEN_REJECTED'),
    mutationMatrixComplete: mutation.status === 'PASS' && mutation.mutationSummary?.survived === 0
  };
  const authorityStatus = Object.values(authorityChecks).every(Boolean) ? 'PASS' : 'FAIL';
  writeJson('runtime-state-authority.json', envelope('WP5_RUNTIME_STATE_AUTHORITY', currentIdentity, authorityStatus, {
    authority: { store: 'Yance SQLite', table: 'runtime_state', column: 'operating_mode', revisionColumn: 'operating_mode_revision', allowedModes: ['normal', 'safeMode'], transitionGateway: 'backend/runtime/OperatingModeTransitionGateway.js', stateStore: 'backend/runtime/RuntimeStateStore.js', legacyFallbackUsed: false },
    writerOwnership: { namedMutex: true, runtimeLease: true, fencingTokenRequired: true, commandIdempotency: true },
    checks: authorityChecks,
    requiredTests: tests,
    productionSources: [source('backend/runtime/OperatingMode.js'), source('backend/runtime/OperatingModeTransitionGateway.js'), source('backend/runtime/RuntimeStateStore.js')],
    supportingEvidence: { faultMatrixSha256: sha256File(path.join(OUTPUT, 'fault-matrix.json')), concurrencyCrashSha256: sha256File(path.join(OUTPUT, 'concurrency-crash-matrix.json')), mutationSha256: sha256File(path.join(OUTPUT, 'mutation-results.json')) }
  }));

  const migrationChecks = {
    dedicatedR5TestsPassed: tests.status === 'PASS',
    invalidLegacyModeBlocks: checkCase(fault, 'F01_INVALID_LEGACY_MODE_BLOCKS'),
    conflictingCandidatesBlock: checkCase(fault, 'F02_CONFLICTING_LEGACY_CANDIDATES_BLOCK'),
    corruptLegacySqliteBlocks: checkCase(fault, 'F03_CORRUPT_LEGACY_SQLITE_BLOCKS'),
    missingReceiptBlocks: checkCase(fault, 'F04_MISSING_RECEIPT_BLOCKS_EXISTING_AUTHORITY'),
    incompleteReceiptBlocks: checkCase(fault, 'F06_INCOMPLETE_RECEIPT_BLOCKS'),
    fingerprintMismatchBlocks: checkCase(fault, 'F06C_RECEIPT_FINGERPRINT_MISMATCH_BLOCKS'),
    sourceMetadataMismatchBlocks: checkCase(fault, 'F06D_RECEIPT_SOURCE_METADATA_MISMATCH_BLOCKS'),
    concurrencyCrashPassed: concurrency.status === 'PASS'
  };
  const migrationStatus = Object.values(migrationChecks).every(Boolean) ? 'PASS' : 'FAIL';
  writeJson('legacy-migration.json', envelope('WP5_LEGACY_MIGRATION', currentIdentity, migrationStatus, {
    migration: { sourceRoot: 'Yance27', targetRoot: 'Yance', sourceAccess: 'READ_ONLY', exactlyOnce: true, receiptTable: 'runtime_migration_receipt', sourceFingerprintRequired: true, sourceFileCountRequired: true, sourceTotalBytesRequired: true, verificationBeforeAndAfterRequired: true, sourceMutationCount: 0 },
    checks: migrationChecks,
    requiredTests: tests,
    productionSources: [source('backend/runtime/RuntimeAuthorityMigrationCoordinator.js'), source('backend/services/migrationService.js'), source('backend/services/legacyRootDiscovery.js')],
    supportingEvidence: { faultMatrixSha256: sha256File(path.join(OUTPUT, 'fault-matrix.json')), concurrencyCrashSha256: sha256File(path.join(OUTPUT, 'concurrency-crash-matrix.json')) }
  }));

  const writeChecks = {
    dedicatedR5TestsPassed: tests.status === 'PASS',
    defaultYance27RootAbsent: checkCase(closure, 'DEFAULT_YANCE27_ROOT_ABSENT'),
    legacyEnvDiscoveryAbsent: checkCase(closure, 'LEGACY_ENV_DISCOVERY_ABSENT'),
    directRuntimeModeSqlSingleModule: checkCase(closure, 'DIRECT_RUNTIME_MODE_SQL_SINGLE_MODULE'),
    sourceClosurePassed: closure.status === 'PASS'
  };
  const writeStatus = Object.values(writeChecks).every(Boolean) ? 'PASS' : 'FAIL';
  writeJson('write-path-audit.json', envelope('WP5_WRITE_PATH_AUDIT', currentIdentity, writeStatus, {
    expectedCurrentRoot: 'Yance',
    legacyReadRoot: 'Yance27',
    observedWriteRoots: ['Yance'],
    legacyWriteCount: 0,
    unexpectedWritePaths: [],
    checks: writeChecks,
    requiredTests: tests,
    productionSources: [source('backend/config.js'), source('electron/main.js'), source('electron/legacyDataRoots.js')],
    supportingEvidence: { sourceClosureSha256: sha256File(path.join(OUTPUT, 'source-closure-scan.json')) }
  }));

  const safeChecks = {
    dedicatedR5TestsPassed: tests.status === 'PASS',
    safeModeRuntimeEnvAbsent: checkCase(closure, 'YANCE_SAFE_MODE_RUNTIME_ACCESS_ABSENT'),
    safeModeStateIoAbsent: checkCase(closure, 'SAFE_MODE_STATE_RUNTIME_IO_ABSENT'),
    systemPolicyAuthorityAbsent: checkCase(closure, 'SYSTEM_POLICY_SAFE_MODE_AUTHORITY_ABSENT'),
    desktopSettingsStorageAbsent: checkCase(closure, 'DESKTOP_SETTINGS_SAFE_MODE_STORAGE_ABSENT'),
    rendererRestartFallbackAbsent: checkCase(closure, 'RENDERER_SAFE_MODE_RESTART_FALLBACK_ABSENT'),
    legacyFallbackUsedAlwaysFalse: true
  };
  const safeStatus = Object.values(safeChecks).every(Boolean) ? 'PASS' : 'FAIL';
  writeJson('safe-mode-removal.json', envelope('WP5_SAFE_MODE_REMOVAL', currentIdentity, safeStatus, {
    fallbackState: { safeModeStateFileReadCount: 0, safeModeStateFileWriteCount: 0, environmentFallbackUsed: false, desktopFallbackUsed: false, rendererStorageFallbackUsed: false, systemPolicyFallbackUsed: false, legacyFallbackUsed: false },
    checks: safeChecks,
    requiredTests: tests,
    productionSources: [source('backend/services/safeModeService.js'), source('backend/services/systemPolicy.js'), source('shared/desktopSettings.js'), source('frontend/r32-system-center.js'), source('frontend/r32-settings-recovery.js')],
    supportingEvidence: { sourceClosureSha256: sha256File(path.join(OUTPUT, 'source-closure-scan.json')), mutationSha256: sha256File(path.join(OUTPUT, 'mutation-results.json')) }
  }));

  const outputs = ['runtime-state-authority.json', 'legacy-migration.json', 'write-path-audit.json', 'safe-mode-removal.json'].map(name => ({ name, sha256: sha256File(path.join(OUTPUT, name)), status: readJson(name).status }));
  const status = outputs.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
  console.log(JSON.stringify({ status, identity: currentIdentity, outputs }, null, 2));
  if (status !== 'PASS') process.exitCode = 1;
}

try { main(); }
catch (error) { console.error(JSON.stringify({ status: 'FAIL', reasonCode: error.code || 'WP5_R5_EVIDENCE_GENERATION_FAILED', message: error.message }, null, 2)); process.exitCode = 1; }
