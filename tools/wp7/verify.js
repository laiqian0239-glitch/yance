#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { npmInvocationForPlatform } = require('./host-command-runner');
const { gitIdentity, assertActivationBinding, sha256File } = require('./lib');
const { classifyCommandResult } = require('./tap-summary');
const { atomicWriteJson, runSupervisedCommand } = require('./command-supervisor');

const TIMEOUTS = Object.freeze({
  DEFAULT: 900000,
  REQUIRED_TESTS: 1200000,
  INSTALLED_PROBES: 1200000,
  MUTATIONS: 1200000,
  CONVERGENCE: 1800000,
  ADVERSARIAL: 2700000,
  ISOLATED_FILE: 300000
});

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const diagnosticMode = process.argv.includes('--diagnostic');
const outputRoot = path.resolve(arg('--output-dir', path.join(os.tmpdir(), `yance-wp7-verify-${process.pid}`)));
if (fs.existsSync(outputRoot)) fs.rmSync(outputRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
fs.mkdirSync(outputRoot, { recursive: true });
const resultsDir = path.join(outputRoot, 'results');
const heartbeatPath = path.join(outputRoot, 'WP7_VERIFY_HEARTBEAT.json');
const timelinePath = path.join(outputRoot, 'WP7_VERIFY_PROCESS_TIMELINE.jsonl');
const summaryPath = path.join(outputRoot, 'WP7_PRE_REVIEW_VERIFICATION_SUMMARY.json');
fs.mkdirSync(resultsDir, { recursive: true });

let identity;
try { identity = gitIdentity(); }
catch (error) { identity = { sourceCommit: '', sourceTree: '', branch: null, repositoryClean: false, identityError: error.message }; }

const summary = {
  schemaVersion: 4,
  documentType: 'WP7_PRE_REVIEW_VERIFICATION_SUMMARY',
  verificationMode: diagnosticMode ? 'DIAGNOSTIC_CONTINUE' : 'STRICT_FAIL_FAST',
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  sourceBranch: identity.branch,
  repositoryClean: identity.repositoryClean,
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    nodeExecutable: process.execPath,
    npmCli: process.env.YANCE_NPM_CLI_JS || null,
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    temp: os.tmpdir()
  },
  timeoutBudgetMs: TIMEOUTS,
  commands: [],
  status: 'PASS'
};

function persistSummary() { atomicWriteJson(summaryPath, summary); }

function writeCommandLogs(name, result) {
  const stdoutPath = path.join(resultsDir, `${name}.stdout.log`);
  const stderrPath = path.join(resultsDir, `${name}.stderr.log`);
  fs.writeFileSync(stdoutPath, result.stdout || '');
  fs.writeFileSync(stderrPath, result.stderr || '');
  return {
    stdoutPath,
    stdoutSha256: sha256File(stdoutPath),
    stderrPath,
    stderrSha256: sha256File(stderrPath)
  };
}

function finalizeCommandRow(name, command, result, options, startedAtUtc, startedMs) {
  const logs = writeCommandLogs(name, result);
  const classification = classifyCommandResult(result, { tap: options.tap === true });
  return {
    name,
    command,
    timeoutMs: options.timeout || TIMEOUTS.DEFAULT,
    startedAtUtc,
    endedAtUtc: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ...logs,
    exitCode: classification.exitCode,
    signal: classification.signal || '',
    errorCode: classification.errorCode || '',
    errorMessage: classification.errorMessage || '',
    timedOut: classification.timedOut,
    outcome: classification.outcome,
    reasonCode: classification.reasonCode || '',
    status: classification.status,
    ...(classification.tap ? { tap: classification.tap } : {})
  };
}

function recordRow(row) {
  summary.commands.push(row);
  if (row.status !== 'PASS') {
    summary.status = 'FAIL';
    if (!summary.failedCommand) {
      summary.reasonCode = row.reasonCode || 'WP7_VERIFICATION_COMMAND_FAILED';
      summary.failureOutcome = row.outcome || 'COMMAND_FAILED';
      summary.failedCommand = row.name;
      if (row.tap?.firstFailure) summary.firstFailure = row.tap.firstFailure;
    }
  }
  persistSummary();
  return row.status === 'PASS';
}

function lastRecordedCommand(name) {
  for (let index = summary.commands.length - 1; index >= 0; index -= 1) {
    if (summary.commands[index]?.name === name) return summary.commands[index];
  }
  return null;
}

async function execute(name, command, args, options = {}) {
  const startedAtUtc = new Date().toISOString();
  const startedMs = Date.now();
  const timeout = options.timeout || TIMEOUTS.DEFAULT;
  const result = await runSupervisedCommand(command, args, {
    name,
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    timeoutMs: timeout,
    maxBuffer: 96 * 1024 * 1024,
    heartbeatPath,
    timelinePath,
    shell: options.shell === true
  });
  return recordRow(finalizeCommandRow(name, [command, ...args], result, { ...options, timeout }, startedAtUtc, startedMs));
}

function npmDisplayCommand(invocation, args) {
  return [invocation.command, ...invocation.prefixArgs, ...args];
}

async function recordNpmCommand(name, args, options = {}) {
  const invocation = npmInvocationForPlatform(process.platform, {
    nodeExecutable: process.env.YANCE_NODE_EXE || process.execPath,
    npmCli: process.env.YANCE_NPM_CLI_JS
  });
  const startedAtUtc = new Date().toISOString();
  const startedMs = Date.now();
  const timeout = options.timeout || TIMEOUTS.DEFAULT;
  const result = await runSupervisedCommand(invocation.command, [...invocation.prefixArgs, ...args], {
    name,
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    timeoutMs: timeout,
    maxBuffer: 96 * 1024 * 1024,
    heartbeatPath,
    timelinePath,
    shell: invocation.shell
  });
  return recordRow(finalizeCommandRow(name, npmDisplayCommand(invocation, args), result, { ...options, timeout }, startedAtUtc, startedMs));
}

async function recordIsolatedNodeSuite(name, directory, options = {}) {
  const files = fs.readdirSync(directory)
    .filter((entry) => entry.endsWith('.test.js'))
    .sort()
    .map((entry) => path.join(directory, entry));
  const suiteDir = path.join(resultsDir, name);
  fs.mkdirSync(suiteDir, { recursive: true });
  const rows = [];
  const totals = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const file of files) {
    const base = path.basename(file);
    const startedAtUtc = new Date().toISOString();
    const startedMs = Date.now();
    const timeout = options.timeoutPerFile || TIMEOUTS.ISOLATED_FILE;
    const result = await runSupervisedCommand(process.execPath, ['--test', file], {
      name: `${name}:${base}`,
      cwd: process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      timeoutMs: timeout,
      maxBuffer: 64 * 1024 * 1024,
      heartbeatPath,
      timelinePath
    });
    const stdoutPath = path.join(suiteDir, `${base}.stdout.log`);
    const stderrPath = path.join(suiteDir, `${base}.stderr.log`);
    fs.writeFileSync(stdoutPath, result.stdout || '');
    fs.writeFileSync(stderrPath, result.stderr || '');
    const classification = classifyCommandResult(result, { tap: true });
    const tap = classification.tap;
    for (const key of Object.keys(totals)) totals[key] += tap[key];
    rows.push({
      file: file.split(path.sep).join('/'),
      timeoutMs: timeout,
      startedAtUtc,
      endedAtUtc: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      stdoutPath,
      stdoutSha256: sha256File(stdoutPath),
      stderrPath,
      stderrSha256: sha256File(stderrPath),
      exitCode: classification.exitCode,
      signal: classification.signal || '',
      errorCode: classification.errorCode || '',
      errorMessage: classification.errorMessage || '',
      timedOut: classification.timedOut,
      outcome: classification.outcome,
      reasonCode: classification.reasonCode || '',
      tap,
      status: classification.status
    });
    if (classification.status !== 'PASS' && !diagnosticMode) break;
  }
  const passedFiles = rows.filter((row) => row.status === 'PASS').length;
  const failedRows = rows.filter((row) => row.status !== 'PASS');
  const row = {
    name,
    executionModel: 'ONE_NODE_TEST_PROCESS_PER_FILE',
    diagnosticContinuedAfterFailure: diagnosticMode,
    fileCount: files.length,
    executedFiles: rows.length,
    passedFiles,
    failedFiles: failedRows.length,
    totals,
    files: rows,
    status: passedFiles === files.length ? 'PASS' : 'FAIL',
    outcome: failedRows[0]?.outcome || 'PASS',
    reasonCode: failedRows[0]?.reasonCode || ''
  };
  atomicWriteJson(path.join(resultsDir, `${name}.summary.json`), row);
  return recordRow(row);
}

function steps() {
  let convergenceEvidencePath = '';
  return [
    () => recordNpmCommand('yance-brand-assets', ['run', 'verify:branding']),
    () => recordNpmCommand('yance-brand-audit-and-assets-tests', ['run', 'test:branding'], { tap: true }),
    () => recordNpmCommand('yance-brand-migration-tests', ['run', 'test:brand-migration'], { tap: true }),
    () => execute('wp7-required-tests', process.execPath, ['tools/wp7/run-required-tests.js', '--mode', 'PRE_REVIEW'], { tap: true, timeout: TIMEOUTS.REQUIRED_TESTS }),
    () => recordNpmCommand('wp7-installed-runtime-probe-tests', ['run', 'test:wp7:installed-probes'], { tap: true, timeout: TIMEOUTS.INSTALLED_PROBES }),
    () => execute('wp7-fault-matrix', process.execPath, ['tools/wp7/fault-matrix.js']),
    () => execute('wp7-concurrency-crash', process.execPath, ['tools/wp7/concurrency-crash-matrix.js']),
    () => execute('wp7-mutations', process.execPath, ['tools/wp7/run-mutations.js'], { timeout: TIMEOUTS.MUTATIONS }),
    async () => {
      const passed = await execute('wp7-convergence-correction-matrix', process.execPath, ['tools/wp7/convergence-correction-matrix.js'], { timeout: 1800000 });
      if (passed) convergenceEvidencePath = lastRecordedCommand('wp7-convergence-correction-matrix')?.stdoutPath || '';
      return passed;
    },
    () => execute('wp7-adversarial', process.execPath, ['tools/wp7/developer-adversarial-review.js'], {
      timeout: TIMEOUTS.ADVERSARIAL,
      env: convergenceEvidencePath ? { WP7_CONVERGENCE_EVIDENCE_PATH: convergenceEvidencePath } : {}
    }),
    () => execute('wp7-source-closure', process.execPath, ['tools/wp7/source-closure.js']),
    () => recordNpmCommand('wp0-regression', ['run', 'test:wp0'], { tap: true }),
    () => recordNpmCommand('wp0-gate', ['run', 'verify:wp0:gate']),
    () => recordNpmCommand('wp1-regression', ['run', 'test:wp1'], { tap: true }),
    () => recordNpmCommand('wp2-regression', ['run', 'test:wp2'], { tap: true }),
    () => recordIsolatedNodeSuite('wp3-regression', 'tests/wp3', { timeoutPerFile: TIMEOUTS.ISOLATED_FILE }),
    () => recordIsolatedNodeSuite('wp4-regression', 'tests/wp4', { timeoutPerFile: TIMEOUTS.ISOLATED_FILE }),
    () => recordNpmCommand('wp5-regression', ['run', 'test:wp5'], { tap: true }),
    () => execute('wp5-fault-matrix', process.execPath, ['tools/wp5/fault-matrix.js']),
    () => execute('wp5-concurrency-crash', process.execPath, ['tools/wp5/concurrency-crash-matrix.js']),
    () => execute('wp5-mutations', process.execPath, ['tools/wp5/run-mutations.js'], { timeout: TIMEOUTS.MUTATIONS }),
    () => recordNpmCommand('wp6-regression', ['run', 'test:wp6'], { tap: true }),
    () => execute('wp6-fault-matrix', process.execPath, ['tools/wp6/fault-matrix.js']),
    () => execute('wp6-concurrency-crash', process.execPath, ['tools/wp6/concurrency-crash-matrix.js']),
    () => execute('wp6-mutations', process.execPath, ['tools/wp6/run-mutations.js'], { timeout: TIMEOUTS.MUTATIONS }),
    () => execute('wp6-adversarial', process.execPath, ['tools/wp6/developer-adversarial-review.js']),
    () => execute('wp6-source-scan', process.execPath, ['tools/wp6/source-scan.js']),
    () => execute('wp6-installed-scan', process.execPath, ['tools/wp6/installed-scan.js'])
  ];
}

async function main() {
  try {
    assertActivationBinding(undefined, { identity, requireClean: true, requireBranch: true });
  } catch (error) {
    summary.status = 'FAIL';
    summary.reasonCode = error.reasonCode || 'WP7_ACTIVATION_CHECK_FAILED';
    summary.message = error.message;
    persistSummary();
    return;
  }

  for (const step of steps()) {
    const passed = await step();
    if (!passed && !diagnosticMode) break;
  }
  if (summary.status === 'PASS') {
    summary.evidencePackageStatus = 'NOT_GENERATED_REQUIRES_ACTUAL_TRUSTED_PRODUCT_SEAL_AND_RAW_PROBE_INPUTS';
    summary.evidenceGenerationCommand = 'tools/wp7/generate-pre-review-evidence.js';
  }
  summary.completedAtUtc = new Date().toISOString();
  persistSummary();
}

if (require.main === module) {
  main().catch((error) => {
    summary.status = 'FAIL';
    summary.reasonCode = error.reasonCode || error.code || 'WP7_VERIFICATION_UNHANDLED_ERROR';
    summary.message = error.stack || error.message;
    summary.completedAtUtc = new Date().toISOString();
    persistSummary();
  }).finally(() => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = summary.status === 'PASS' ? 0 : 1;
  });
}

module.exports = { TIMEOUTS, main };
