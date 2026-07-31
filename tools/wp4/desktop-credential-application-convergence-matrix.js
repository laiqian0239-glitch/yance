#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MUTATION_CASES } = require('./desktop-credential-containment-journal-fault-matrix');

const ROOT = path.resolve(__dirname, '../..');

function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function runMatrixProcess(relativeScript, env = {}, timeoutMs = 10 * 60 * 1000) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-convergence-matrix-'));
  const stdoutPath = path.join(tempDir, 'stdout.json');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const environment = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const command = `${environment ? `${environment} ` : ''}${shellQuote(process.execPath)} ${shellQuote(path.join(ROOT, relativeScript))} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;
  const result = childProcess.spawnSync('bash', ['-lc', command], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: timeoutMs
  });
  const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.error) {
    const error = new Error(`${relativeScript} execution failed: ${result.error.message}`);
    error.reasonCode = result.error.code === 'ETIMEDOUT' ? 'WP4_MATRIX_PROCESS_TIMEOUT' : 'WP4_MATRIX_PROCESS_ERROR';
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`${relativeScript} exited ${result.status}: ${(stderr || stdout || '').slice(-12000)}`);
    error.reasonCode = 'WP4_MATRIX_PROCESS_FAILED';
    throw error;
  }
  try {
    return JSON.parse(String(stdout || '').trim());
  } catch (cause) {
    const error = new Error(`${relativeScript} returned invalid JSON: ${cause.message}`);
    error.reasonCode = 'WP4_MATRIX_PROCESS_OUTPUT_INVALID';
    throw error;
  }
}

async function runDesktopCredentialApplicationConvergenceMatrix(options = {}) {
  const mutationTarget = String(process.env.WP4_MUTATION_TARGET || options.mutationTarget || '');
  const targetedContainment = Boolean(MUTATION_CASES[mutationTarget]);
  const childEnv = mutationTarget ? { WP4_MUTATION_TARGET: mutationTarget } : {};
  const application = targetedContainment
    ? { schemaVersion: 1, matrix: 'DESKTOP_CREDENTIAL_APPLICATION_LIFECYCLE', status: 'PASS', caseCount: 0, cases: [], failedCaseIds: [], targetedSectionNotApplicable: true }
    : runMatrixProcess('tools/wp4/desktop-credential-application-lifecycle-matrix.js', childEnv);
  const containmentJournal = runMatrixProcess('tools/wp4/desktop-credential-containment-journal-fault-matrix.js', childEnv);
  const failed = [application, containmentJournal].filter(row => row.status !== 'PASS');
  const value = {
    schemaVersion: 2,
    matrix: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_CONVERGENCE_MATRIX',
    executionIsolation: 'SEPARATE_NODE_PROCESS_PER_MATRIX',
    mutationTarget,
    status: failed.length ? 'FAIL' : 'PASS',
    caseCount: application.caseCount + containmentJournal.caseCount,
    passedCount: Number(application.passedCount ?? application.caseCount) + Number(containmentJournal.passedCount ?? containmentJournal.caseCount),
    failedCount: Number(application.failedCount || 0) + Number(containmentJournal.failedCount || 0),
    applicationLifecycle: { status: application.status, caseCount: application.caseCount, failedCaseIds: application.failedCaseIds || application.cases.filter(row => row.status !== 'PASS').map(row => row.id) },
    containmentJournal: { status: containmentJournal.status, caseCount: containmentJournal.caseCount, failedCaseIds: containmentJournal.failedCaseIds || [] },
    cases: [...application.cases, ...containmentJournal.cases],
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (failed.length) {
    const error = new Error('WP4 Desktop Credential Application convergence matrix failed');
    error.reasonCode = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_CONVERGENCE_MATRIX_FAILED';
    error.matrix = value;
    throw error;
  }
  return value;
}

module.exports = { runDesktopCredentialApplicationConvergenceMatrix };
if (require.main === module) runDesktopCredentialApplicationConvergenceMatrix().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => {
  process.stderr.write(`${error.reasonCode || error.code || 'WP4_DESKTOP_CREDENTIAL_APPLICATION_CONVERGENCE_MATRIX_FAILED'} ${error.stack || error.message}\n`);
  if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`);
  process.exit(1);
});
