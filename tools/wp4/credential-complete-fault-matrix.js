#!/usr/bin/env node
'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCredentialArchitectureFaultMatrix } = require('./credential-architecture-fault-matrix');
const { runCredentialAuthorityLifecycleMatrix } = require('./credential-authority-lifecycle-matrix');
const { runBackendOwnerExitMatrix } = require('./backend-owner-exit-probe');
const { runDesktopCredentialApplicationLifecycleMatrix } = require('./desktop-credential-application-lifecycle-matrix');
const { DIRECT_CASES, MUTATION_CASES: CONTAINMENT_MUTATION_CASES, runDesktopCredentialContainmentJournalFaultMatrix } = require('./desktop-credential-containment-journal-fault-matrix');

const ROOT = path.resolve(__dirname, '../..');
function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function runMatrixCli(relativeScript, extraEnv = {}, timeoutMs = 12 * 60 * 1000) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-complete-matrix-'));
  const stdoutPath = path.join(tempDir, 'stdout.json');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const environment = Object.entries(extraEnv).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const command = `${environment ? `${environment} ` : ''}${shellQuote(process.execPath)} ${shellQuote(path.join(ROOT, relativeScript))} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;
  const result = childProcess.spawnSync('bash', ['-lc', command], { cwd: ROOT, stdio: 'inherit', timeout: timeoutMs });
  const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.error) throw Object.assign(new Error(`${relativeScript} execution failed: ${result.error.message}`), { reasonCode: result.error.code === 'ETIMEDOUT' ? 'WP4_MATRIX_PROCESS_TIMEOUT' : 'WP4_MATRIX_PROCESS_ERROR' });
  if (result.status !== 0) throw Object.assign(new Error(`${relativeScript} exited ${result.status}: ${(stderr || stdout || '').slice(-12000)}`), { reasonCode: 'WP4_MATRIX_PROCESS_FAILED' });
  try { return JSON.parse(String(stdout || '').trim()); }
  catch (cause) { throw Object.assign(new Error(`${relativeScript} returned invalid JSON: ${cause.message}`), { reasonCode: 'WP4_MATRIX_PROCESS_OUTPUT_INVALID' }); }
}

const APPLICATION_MUTATION_CASES = Object.freeze({
  M09_DESKTOP_BYPASSES_COORDINATOR: ['A01_REAL_SAVE_STOP_EXIT_COMMIT_FD5_READY'],
  M18_APPLICATION_LEASE_OMITTED: ['A01_REAL_SAVE_STOP_EXIT_COMMIT_FD5_READY'],
  M19_STOP_FAILURE_IGNORED: ['A03_STOP_FAILURE_AUTHORITY_UNCHANGED'],
  M20_READY_FAILURES_IGNORED: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
  M21_READY_GENERATION_UNBOUND: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
  M22_READY_AUTHORITY_DIGEST_UNBOUND: ['A09_READY_DIGEST_MISMATCH_STOPS_REJECTED_OWNER'],
  M23_IDEMPOTENT_REQUEST_ID_DISCARDED: ['A04_COMMIT_THEN_START_FAILURE_IDEMPOTENT_RESUME'],
  M24_SHUTDOWN_BEFORE_COMMIT_IGNORED: ['A07_SHUTDOWN_AFTER_EXIT_BLOCKS_MUTATION'],
  M25_REJECTED_NEW_OWNER_NOT_CLEANED: ['A05_READY_GENERATION_MISMATCH_STOPS_REJECTED_OWNER'],
  M26_RUNTIME_PROJECTION_NOT_VALIDATED: ['A06_RUNTIME_PROJECTION_MISMATCH_STOPS_REJECTED_OWNER'],
  M27_APPLICATION_INTERRUPTION_JOURNAL_IGNORED: ['A08_APPLICATION_RESTART_RECOVERS_COMMITTED_OPERATION'],
  M28_UI_SUCCESS_BEFORE_RUNTIME_PROJECTION: ['A11_UI_SUCCESS_WAITS_FOR_RUNTIME_PROJECTION'],
  M29_CLEANUP_FAILURE_RELEASES_APPLICATION_FENCE: ['A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'],
  M30_CLEANUP_FAILURE_LEAVES_FD6_OPEN: ['A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED'],
  M31_FAILED_SAFE_LIVE_OWNER_RESETS_IDLE: ['A23_FAILED_SAFE_LIVE_OWNER_CANNOT_RESET_IDLE'],
  M32_ALREADY_READY_SKIPS_RUNTIME_PROJECTION: ['A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION'],
  M33_LIVE_REJECTED_OWNER_ALLOWS_FD6_PREPARE: ['A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED'],
  M34_CLEANUP_FAILURE_ALLOWS_UI_MUTATION: ['A24_LIVE_REJECTED_OWNER_UI_MUTATION_DENIED']
});

const START_HANDSHAKE_MUTATIONS = new Set([
  'M57_START_FAILURE_SKIPS_HOST_CONTAINMENT',
  'M58_START_FAILURE_SKIPS_APPLICATION_CONTAINMENT',
  'M59_START_FAILURE_CLEANUP_NOT_FATAL',
  'M60_RELAUNCH_DROPS_CONTAINMENT_FAIL_STOP'
]);

function notRunTargetedSection(matrix) {
  return { schemaVersion: 1, matrix, status: 'PASS', caseCount: 0, cases: [], failedCaseIds: [], targetedSectionNotApplicable: true };
}

async function runTargetedApplicationMutationMatrix(mutationTarget) {
  const caseIds = APPLICATION_MUTATION_CASES[mutationTarget];
  if (!caseIds) return null;
  const transaction = notRunTargetedSection('CREDENTIAL_TRANSACTION');
  const authorityLifecycle = notRunTargetedSection('CREDENTIAL_AUTHORITY_LIFECYCLE');
  const ownerExit = { ...notRunTargetedSection('BACKEND_OWNER_SESSION_LIFECYCLE'), f16Synthetic: false };
  const desktopApplicationLifecycle = await runDesktopCredentialApplicationLifecycleMatrix({ caseIds });
  return { transaction, authorityLifecycle, ownerExit, desktopApplicationLifecycle };
}

async function runCredentialCompleteFaultMatrix(options = {}) {
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || options.mutationTarget || '');
  const targetEnv = mutationTarget ? { WP4_MUTATION_TARGET: mutationTarget } : {};
  const normalEnv = {};
  let targetedApplication = null;
  let targetedStartHandshake = null;
  let targetedContainment = null;

  // Route a mutation target only to the matrix that explicitly recognizes it.
  // An unrelated matrix rejecting an unknown target is a harness configuration
  // failure, not a business-oracle kill, and must never satisfy this oracle.
  if (mutationTarget && APPLICATION_MUTATION_CASES[mutationTarget]) {
    process.stderr.write('[wp4-complete-matrix] targeted-application:start\n');
    targetedApplication = runMatrixCli('tools/wp4/desktop-credential-application-lifecycle-matrix.js', targetEnv);
    process.stderr.write('[wp4-complete-matrix] targeted-application:survived\n');
  }
  if (mutationTarget && START_HANDSHAKE_MUTATIONS.has(mutationTarget)) {
    process.stderr.write('[wp4-complete-matrix] targeted-start-handshake:start\n');
    targetedStartHandshake = runMatrixCli('tools/wp4/desktop-credential-start-handshake-containment-matrix.js', targetEnv);
    process.stderr.write('[wp4-complete-matrix] targeted-start-handshake:survived\n');
  }
  if (mutationTarget && CONTAINMENT_MUTATION_CASES[mutationTarget]) {
    process.stderr.write('[wp4-complete-matrix] targeted-containment:start\n');
    targetedContainment = runMatrixCli('tools/wp4/desktop-credential-containment-journal-fault-matrix.js', { ...targetEnv, WP4_CONTAINMENT_DIRECT_ONLY: '1' });
    process.stderr.write('[wp4-complete-matrix] targeted-containment:survived\n');
  }

  // Every production matrix runs in an independent Node process. Mutation
  // selection is passed only to the authoritative targeted section above;
  // all unrelated sections exercise the mutated source as normal production
  // matrices without receiving an unknown target identifier.
  process.stderr.write('[wp4-complete-matrix] application:start\n');
  const desktopApplicationLifecycle = options.desktopApplicationLifecycle || targetedApplication || runMatrixCli('tools/wp4/desktop-credential-application-lifecycle-matrix.js', normalEnv);
  process.stderr.write('[wp4-complete-matrix] application:pass\n');
  process.stderr.write('[wp4-complete-matrix] start-handshake-containment:start\n');
  const startHandshakeContainment = options.startHandshakeContainment || targetedStartHandshake || runMatrixCli('tools/wp4/desktop-credential-start-handshake-containment-matrix.js', normalEnv);
  process.stderr.write('[wp4-complete-matrix] start-handshake-containment:pass\n');
  process.stderr.write('[wp4-complete-matrix] owner:start\n');
  const ownerExit = options.ownerExit || runMatrixCli('tools/wp4/backend-owner-exit-probe.js', normalEnv);
  process.stderr.write('[wp4-complete-matrix] owner:pass\n');
  process.stderr.write('[wp4-complete-matrix] transaction:start\n');
  const transaction = options.transaction || runMatrixCli('tools/wp4/credential-architecture-fault-matrix.js', normalEnv);
  process.stderr.write('[wp4-complete-matrix] transaction:pass\n');
  process.stderr.write('[wp4-complete-matrix] authority:start\n');
  const authorityLifecycle = options.authorityLifecycle || runMatrixCli('tools/wp4/credential-authority-lifecycle-matrix.js', normalEnv);
  process.stderr.write('[wp4-complete-matrix] authority:pass\n');
  process.stderr.write('[wp4-complete-matrix] containment:start\n');
  const containmentJournal = options.containmentJournal || targetedContainment || runMatrixCli('tools/wp4/desktop-credential-containment-journal-fault-matrix.js', { WP4_CONTAINMENT_DIRECT_ONLY: '1' });
  process.stderr.write('[wp4-complete-matrix] containment:pass\n');
  const failed = [transaction, authorityLifecycle, ownerExit, desktopApplicationLifecycle, containmentJournal, startHandshakeContainment].filter(row => row.status !== 'PASS');
  const value = {
    schemaVersion: 3,
    matrix: 'WP4_COMPLETE_CREDENTIAL_AUTHORITY_AND_TRANSACTION_FAULT_MATRIX',
    executionIsolation: 'SEPARATE_NODE_PROCESS_PER_MATRIX',
    mutationTarget,
    status: failed.length ? 'FAIL' : 'PASS',
    totalCaseCount: transaction.caseCount + authorityLifecycle.caseCount + ownerExit.caseCount + desktopApplicationLifecycle.caseCount + containmentJournal.caseCount + startHandshakeContainment.caseCount,
    transaction: { status: transaction.status, caseCount: transaction.caseCount, failedCaseIds: transaction.failedCaseIds || [] },
    authorityLifecycle: { status: authorityLifecycle.status, caseCount: authorityLifecycle.caseCount, failedCaseIds: authorityLifecycle.failedCaseIds || [] },
    backendOwnerLifecycle: { status: ownerExit.status, caseCount: ownerExit.caseCount, failedCaseIds: ownerExit.failedCaseIds || [], f16Synthetic: ownerExit.f16Synthetic },
    desktopCredentialApplicationLifecycle: { status: desktopApplicationLifecycle.status, caseCount: desktopApplicationLifecycle.caseCount, failedCaseIds: desktopApplicationLifecycle.cases.filter(row => row.status !== 'PASS').map(row => row.id) },
    rejectedOwnerContainmentJournal: { status: containmentJournal.status, caseCount: containmentJournal.caseCount, failedCaseIds: containmentJournal.failedCaseIds || [] },
    startHandshakeRejectedOwnerContainment: { status: startHandshakeContainment.status, caseCount: startHandshakeContainment.caseCount, failedCaseIds: startHandshakeContainment.failedCaseIds || [] },
    cases: [...transaction.cases, ...authorityLifecycle.cases, ...ownerExit.cases, ...desktopApplicationLifecycle.cases, ...containmentJournal.cases, ...startHandshakeContainment.cases],
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (failed.length) { const error = new Error('WP4 complete credential fault matrix failed'); error.reasonCode = 'WP4_CREDENTIAL_COMPLETE_FAULT_MATRIX_FAILED'; error.matrix = value; throw error; }
  return value;
}

module.exports = { APPLICATION_MUTATION_CASES, runCredentialCompleteFaultMatrix };
if (require.main === module) runCredentialCompleteFaultMatrix().then(value => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, () => process.exit(0));
}).catch(error => {
  const detail = `${error.reasonCode || error.code || 'WP4_CREDENTIAL_COMPLETE_FAULT_MATRIX_FAILED'} ${error.stack || error.message}\n${error.matrix ? `${JSON.stringify(error.matrix, null, 2)}\n` : ''}`;
  process.stderr.write(detail, () => process.exit(1));
});
