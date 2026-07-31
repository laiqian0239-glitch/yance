#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { runDesktopCredentialApplicationLifecycleMatrix } = require('./desktop-credential-application-lifecycle-matrix');

const ROOT = path.resolve(__dirname, '../..');
const DIRECT_CASES = Object.freeze([
  ['J01_JOURNAL_MKDIR_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal mkdir failure'],
  ['J02_JOURNAL_OPEN_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal open failure'],
  ['J03_JOURNAL_WRITE_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal write failure'],
  ['J04_JOURNAL_FSYNC_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal fsync failure'],
  ['J05_JOURNAL_CLOSE_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal close failure'],
  ['J06_JOURNAL_RENAME_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal rename failure'],
  ['J07_JOURNAL_DIRECTORY_FSYNC_FAILURE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal directory-fsync failure'],
  ['J08_CRASH_BEFORE_OWNER_REVOCATION', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at before-backend-owner-revocation'],
  ['J09_CRASH_AFTER_OWNER_REVOCATION', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-backend-owner-revocation'],
  ['J10_CRASH_BEFORE_APPLICATION_FENCE', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at before-application-fence'],
  ['J11_CRASH_AFTER_APPLICATION_FENCE', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-application-fence'],
  ['J12_CRASH_AFTER_ENFORCEMENT_BEFORE_OWNER_RECORD', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-enforcement-before-owner-record'],
  ['J13_CRASH_AFTER_OWNER_RECORD_BEFORE_SENTINEL', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-owner-record-before-sentinel'],
  ['J14_CRASH_AFTER_ENFORCEMENT_BEFORE_SENTINEL', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-enforcement-before-sentinel'],
  ['J15_CRASH_AFTER_SENTINEL_BEFORE_JOURNAL', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'crash at after-sentinel-before-lifecycle-journal'],
  ['J16_CORRUPT_LIFECYCLE_JOURNAL_OWNER_REGISTRY_RECOVERY', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'corrupt lifecycle journal plus live owner registry'],
  ['J17_CORRUPT_OR_TRUNCATED_SENTINEL_FAILS_CLOSED', 'tests/wp4/desktop-credential-containment-crash-recovery.test.js', 'corrupt or truncated containment sentinel'],
  ['J18_ORPHAN_PID_NO_CHILDPROCESS_TERMINATION', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'orphan owner registry restores'],
  ['J19_PID_REUSE_IS_NOT_TERMINATED', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'PID reuse never kills'],
  ['J20_EPERM_LIVENESS_REMAINS_CONTAINED', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'EPERM or unverifiable'],
  ['J21_CORRUPT_OWNER_REGISTRY_REQUIRES_MANUAL_RECOVERY', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'corrupt owner registry'],
  ['J22_LEASE_RELEASE_CANNOT_REOPEN_FENCE', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'persistent application fence survives'],
  ['J23_PERSISTED_FATAL_CONTAINMENT_BLOCKS_START', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'persisted FATAL_OWNER_CONTAINMENT'],
  ['J24_FAILED_SAFE_LIVE_OWNER_CANNOT_IDLE', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'FAILED_SAFE cannot reset'],
  ['J25_EVENTUAL_EXIT_RELEASES_ONLY_AFTER_RECOVERY', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'persisted rejected PID remains fenced'],
  ['J26_TERMINATION_PENDING_WITHOUT_PAYLOAD_RECOVERS_PID', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'termination-pending journal without containment payload'],
  ['J27_JOURNAL_FAILURE_WITH_REAL_EXIT_REMAINS_FATAL', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal durability failure remains fatal'],
  ['J28_FENCE_AND_MARKER_RELEASE_BLOCKED_BEFORE_RECOVERY', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'fence and rejected marker cannot clear'],
  ['J29_JOURNAL_FAILURE_CONCURRENT_FD6_AND_API_DENIED', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal rename failure concurrently denies FD6 PREPARE'],
  ['J30_JOURNAL_FAILURE_CONCURRENT_SHUTDOWN_RETAINS_FENCE', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'journal rename failure concurrent application shutdown'],
  ['J31_PRODUCTION_FACTS_OVERRIDE_NON_CONTAINMENT_STATE', 'tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'production enforcement objects activate containment'],
  ['J32_OWNER_RECORD_PERSISTENCE_AFTER_REAL_ENFORCEMENT', 'tests/wp4/desktop-credential-containment-journal-order.test.js', 'fallible owner registry persistence starts only'],
  ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'syntax-valid but semantically invalid active owner records fail closed'],
  ['J34_OWNER_IDENTITY_MISMATCH_REQUIRES_EXPLICIT_RECOVERY', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'persisted owner identity mismatch establishes registry recovery failure'],
  ['J35_OWNER_IDENTITY_UNREADABLE_REQUIRES_EXPLICIT_RECOVERY', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'live owner whose process identity cannot be read'],
  ['J36_EXITED_ACTIVE_RECORD_REQUIRES_DURABLE_RECOVERY', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'durable active owner proven exited still requires'],
  ['J37_LIVE_OWNER_MARKER_CLEAR_BLOCKED', 'tests/wp4/backend-owner-registry-containment-recovery.test.js', 'live identity-matched rejected owner marker cannot clear']
]);

const APPLICATION_CASES = Object.freeze([
  'A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A13_READY_DIGEST_MISMATCH_SIGKILL_FAILURE_CONTAINED',
  'A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED',
  'A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED',
  'A17_LIVE_REJECTED_OWNER_FD6_COMMIT_DENIED',
  'A18_LIVE_REJECTED_OWNER_START_ALREADY_READY_DENIED',
  'A19_LIVE_REJECTED_OWNER_RESTART_DENIED',
  'A20_LIVE_REJECTED_OWNER_APPLICATION_EXIT_RETAINS_FENCE',
  'A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER',
  'A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION',
  'A23_FAILED_SAFE_LIVE_OWNER_CANNOT_RESET_IDLE',
  'A24_LIVE_REJECTED_OWNER_UI_MUTATION_DENIED'
]);

const MUTATION_CASES = Object.freeze({
  M35_JOURNAL_BEFORE_ENFORCEMENT: ['J06_JOURNAL_RENAME_FAILURE'],
  M36_OWNER_REVOCATION_REMOVED: ['J06_JOURNAL_RENAME_FAILURE'],
  M37_APPLICATION_FENCE_REMOVED: ['J06_JOURNAL_RENAME_FAILURE'],
  M38_STATE_ONLY_CONTAINMENT_WITHOUT_FENCE: ['J06_JOURNAL_RENAME_FAILURE'],
  M39_CLEANUP_EXCEPTION_RELEASES_LEASE_UNFENCED: ['J06_JOURNAL_RENAME_FAILURE'],
  M40_CONTAINMENT_PERSISTENCE_ERROR_SWALLOWED: ['J27_JOURNAL_FAILURE_WITH_REAL_EXIT_REMAINS_FATAL'],
  M41_API_TOKEN_RETAINED: ['J06_JOURNAL_RENAME_FAILURE'],
  M42_FD6_CLOSE_NOOP: ['J06_JOURNAL_RENAME_FAILURE'],
  M43_IS_CONTAINMENT_ACTIVE_STATE_ONLY: ['J31_PRODUCTION_FACTS_OVERRIDE_NON_CONTAINMENT_STATE'],
  M44_FENCE_CLEARED_BEFORE_OWNER_RECOVERY: ['J28_FENCE_AND_MARKER_RELEASE_BLOCKED_BEFORE_RECOVERY'],
  M45_REJECTED_MARKER_CLEARED_WHILE_PID_LIVE: ['J37_LIVE_OWNER_MARKER_CLEAR_BLOCKED'],
  M46_CORRUPT_JOURNAL_FALLS_BACK_IDLE: ['J16_CORRUPT_LIFECYCLE_JOURNAL_OWNER_REGISTRY_RECOVERY'],
  M47_OWNER_POSITIVE_PID_VALIDATION_REMOVED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M48_OWNER_PID_ZERO_ACCEPTED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M49_OWNER_STATE_ENUM_VALIDATION_REMOVED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M50_OWNER_STATE_ACTIVE_CONSISTENCY_REMOVED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M51_OWNER_SESSION_IDENTITY_MISSING_ACCEPTED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M52_OWNER_PROCESS_IDENTITY_MISSING_ACCEPTED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M53_OWNER_SEMANTIC_FAILURE_RESET_EMPTY: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M54_OWNER_SEMANTIC_FAILURE_START_ALLOWED: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M55_OWNER_CORRUPTION_INTERPRETED_NO_OWNERSHIP: ['J33_OWNER_REGISTRY_SEMANTIC_VALIDATION_FAIL_CLOSED'],
  M56_OWNER_FAILURE_CLEARED_BEFORE_RECOVERY: ['J34_OWNER_IDENTITY_MISMATCH_REQUIRES_EXPLICIT_RECOVERY']
});

function runNodeTest(file, pattern) {
  const result = childProcess.spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, file], { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'test' } });
  return { status: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status ?? 1, signal: result.signal || '', outputTail: `${result.stdout || ''}\n${result.stderr || ''}`.slice(-3000) };
}

async function runDesktopCredentialContainmentJournalFaultMatrix(options = {}) {
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || options.mutationTarget || '');
  const selected = new Set(options.caseIds || MUTATION_CASES[mutationTarget] || []);
  const runAll = selected.size === 0;
  const cases = [];
  for (const [id, file, pattern] of DIRECT_CASES) {
    if (!runAll && !selected.has(id)) continue;
    const result = runNodeTest(file, pattern);
    cases.push({
      id,
      status: result.status,
      productionObjectsVerified: ['BackendProcessHost', 'CredentialCustodyHost', 'CredentialVaultHost', 'DesktopHost', 'DesktopCredentialApplicationCoordinator'],
      invariants: ['ownerTrusted=false', 'API authority revoked', 'FD6 unavailable', 'application fence installed', 'lease release cannot reopen access', 'authority boundary unchanged unless recovery is authorized'],
      ...result
    });
  }
  const selectedApplication = APPLICATION_CASES.filter(id => runAll || selected.has(id));
  if (selectedApplication.length) {
    const application = await runDesktopCredentialApplicationLifecycleMatrix({ caseIds: selectedApplication });
    for (const row of application.cases) cases.push({ ...row, matrixSection: 'REAL_APPLICATION_PROCESS_COMBINATION' });
  }
  const failedCaseIds = cases.filter(row => row.status !== 'PASS').map(row => row.id);
  const value = {
    schemaVersion: 1,
    matrix: 'WP4_REJECTED_OWNER_CONTAINMENT_JOURNAL_AND_CRASH_FAULT_MATRIX',
    mutationTarget,
    status: failedCaseIds.length ? 'FAIL' : 'PASS',
    caseCount: cases.length,
    failedCaseIds,
    cases,
    enforcementOrdering: 'OWNER_AND_API_REVOKED_THEN_FD6_CLOSED_THEN_APPLICATION_FENCE_INSTALLED_THEN_FALLIBLE_BOOKKEEPING',
    durableDiscoverySources: ['backend-owner-registry', 'containment-sentinel', 'lifecycle-journal'],
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (failedCaseIds.length) {
    const error = new Error('WP4 rejected-owner containment journal fault matrix failed');
    error.reasonCode = 'WP4_CONTAINMENT_JOURNAL_FAULT_MATRIX_FAILED';
    error.matrix = value;
    throw error;
  }
  return value;
}

module.exports = { APPLICATION_CASES, DIRECT_CASES, MUTATION_CASES, runDesktopCredentialContainmentJournalFaultMatrix };
if (require.main === module) {
  const directOnly = process.env.WP4_CONTAINMENT_DIRECT_ONLY === '1';
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || '');
  // Under mutation verification the mutation-to-case map is authoritative.
  // DIRECT_ONLY applies only to a normal production matrix run; otherwise it
  // would accidentally replace a one-case mutation oracle with all direct cases.
  const caseIds = directOnly && !mutationTarget ? DIRECT_CASES.map(row => row[0]) : [];
  runDesktopCredentialContainmentJournalFaultMatrix({ caseIds }).then(value => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, () => process.exit(0));
  }).catch(error => {
    const detail = `${error.reasonCode || error.code || 'WP4_CONTAINMENT_JOURNAL_FAULT_MATRIX_FAILED'} ${error.stack || error.message}\n${error.matrix ? `${JSON.stringify(error.matrix, null, 2)}\n` : ''}`;
    process.stderr.write(detail, () => process.exit(1));
  });
}
