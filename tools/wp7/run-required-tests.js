#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  PHASE_MODEL_PATH,
  REPO_ROOT,
  Wp7Error,
  readJson,
  sha256File,
  verifyRequiredTestImplementations,
  writeCanonicalJson
} = require('./lib');
const { readFinalExecutionContext } = require('./final-context');
const { classifyCommandResult } = require('./tap-summary');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function executionId(mode, testId, contextSha256 = '') {
  return crypto.createHash('sha256').update(`${mode}\0${testId}\0${contextSha256}\0${Date.now()}\0${process.pid}`).digest('hex').slice(0, 32);
}

function phaseFor(mode, phaseClass) {
  if (mode === 'FINAL_WINDOWS') return 'FINAL_WINDOWS';
  if (mode === 'FINAL_PACKAGING' && phaseClass === 'FINAL_PACKAGING') return 'FINAL_PACKAGING';
  if (mode === 'FINAL_PACKAGING') return 'FINAL';
  if (mode === 'ALL_FINAL' && phaseClass === 'FINAL_WINDOWS') return 'FINAL_WINDOWS';
  if (mode === 'ALL_FINAL' && phaseClass === 'FINAL_PACKAGING') return 'FINAL_PACKAGING';
  if (mode === 'ALL_FINAL') return 'FINAL';
  return 'PRE_REVIEW';
}

function runIsolatedNodeTest({ testId, rawRoot, env, timeout = 600000 }) {
  const stdoutPath = path.join(rawRoot, `${testId}.stdout.txt`);
  const stderrPath = path.join(rawRoot, `${testId}.stderr.txt`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', path.join('tests', 'wp7', `${testId}.js`)], {
      cwd: REPO_ROOT,
      env,
      timeout,
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  return {
    ...result,
    stdoutPath,
    stderrPath,
    stdout: fs.readFileSync(stdoutPath, 'utf8'),
    stderr: fs.readFileSync(stderrPath, 'utf8')
  };
}

const mode = arg('--mode', 'PRE_REVIEW');
const modeClasses = {
  PRE_REVIEW: ['PRE_REVIEW', 'PRE_REVIEW_AND_FINAL'],
  FINAL_PACKAGING: ['PRE_REVIEW_AND_FINAL', 'FINAL_PACKAGING'],
  FINAL_WINDOWS: ['FINAL_WINDOWS'],
  ALL_FINAL: ['PRE_REVIEW_AND_FINAL', 'FINAL_PACKAGING', 'FINAL_WINDOWS']
};

try {
  const model = readJson(PHASE_MODEL_PATH);
  verifyRequiredTestImplementations({ model });
  const phaseClasses = modeClasses[mode];
  if (!phaseClasses) throw new Wp7Error('WP7_REQUIRED_TEST_RUNNER_FAILED', `unknown mode ${mode}`);
  const assignments = [];
  for (const phaseClass of phaseClasses) for (const id of model.testAssignments[phaseClass]) assignments.push({ id, phaseClass });

  if (mode === 'PRE_REVIEW') {
    const started = Date.now();
    const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-pre-review-required-'));
    const totals = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
    let failedFiles = 0;
    process.stdout.write('TAP version 13\n');
    for (let index = 0; index < assignments.length; index += 1) {
      const { id } = assignments[index];
      process.stdout.write(`# running ${index + 1}/${assignments.length} ${id}\n`);
      const result = runIsolatedNodeTest({ testId: id, rawRoot, env: process.env });
      const stdout = String(result.stdout || '');
      const stderr = String(result.stderr || '');
      const classification = classifyCommandResult(result, { tap: true });
      const child = {
        tests: classification.tap.tests,
        passed: classification.tap.passed,
        failed: classification.tap.failed,
        cancelled: classification.tap.cancelled,
        skipped: classification.tap.skipped,
        todo: classification.tap.todo
      };
      const passed = classification.status === 'PASS';
      if (!child.tests) child.tests = 1;
      if (!passed && child.failed === 0) child.failed = 1;
      if (passed && child.passed === 0) child.passed = child.tests;
      for (const key of Object.keys(totals)) totals[key] += child[key];
      if (!passed) failedFiles += 1;
      process.stdout.write(`${passed ? 'ok' : 'not ok'} ${index + 1} - ${id}\n`);
      if (!passed) {
        const classificationDetail = JSON.stringify({ outcome: classification.outcome, reasonCode: classification.reasonCode, tap: classification.tap });
        const detail = [classificationDetail, stdout, stderr, result.error?.stack || result.error?.message || ''].filter(Boolean).join('\n').slice(-12000);
        for (const line of detail.split(/\r?\n/)) process.stdout.write(`  # ${line}\n`);
      }
    }
    process.stdout.write(`1..${assignments.length}\n`);
    process.stdout.write(`# tests ${totals.tests}\n`);
    process.stdout.write(`# suites 0\n`);
    process.stdout.write(`# pass ${totals.passed}\n`);
    process.stdout.write(`# fail ${totals.failed}\n`);
    process.stdout.write(`# cancelled ${totals.cancelled}\n`);
    process.stdout.write(`# skipped ${totals.skipped}\n`);
    process.stdout.write(`# todo ${totals.todo}\n`);
    process.stdout.write(`# duration_ms ${Date.now() - started}\n`);
    process.stdout.write(`# isolated_raw_output ${rawRoot}\n`);
    process.exit(failedFiles ? 1 : 0);
  }

  const contextPath = arg('--context', process.env.WP7_FINAL_EXECUTION_CONTEXT || null);
  const resultsPath = path.resolve(arg('--results', process.env.WP7_FINAL_TEST_RESULTS_PATH || '') || '');
  if (!contextPath || !arg('--results', process.env.WP7_FINAL_TEST_RESULTS_PATH || null)) {
    throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'final test execution requires --context and --results');
  }
  const context = readFinalExecutionContext(path.resolve(contextPath), { mode });
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wp7-${mode.toLowerCase()}-results-`));
  const env = {
    ...process.env,
    WP7_EXECUTION_PHASE: mode,
    WP7_FINAL_EXECUTION_CONTEXT: context.contextPath,
    WP7_FINAL_CONTEXT_SHA256: context.contextSha256,
    WP7_FINAL_EVIDENCE_ROOT: context.rawWindowsEvidenceRoot,
    WP7_FINAL_INSTALLER: context.installerPath,
    WP7_FINAL_INSTALLER_SHA256: context.installerSha256,
    WP7_FINAL_PAYLOAD_ROOT: context.payloadRoot,
    WP7_FINAL_RELEASE_EVIDENCE: context.finalReleaseEvidencePath,
    WP7_FINAL_DELIVERY_REPO: context.finalDeliveryRepo,
    WP7_PREACCEPTANCE_RECORD: context.preacceptanceRecordPath,
    WP7_PREACCEPTANCE_RECORD_SHA256: context.preacceptanceRecordSha256,
    WP7_FINAL_BUILD_SESSION_ID: context.buildSessionId
  };

  const results = {};
  let failed = 0;
  for (const { id, phaseClass } of assignments) {
    const startedAtUtc = new Date().toISOString();
    const result = runIsolatedNodeTest({ testId: id, rawRoot, env });
    const endedAtUtc = new Date().toISOString();
    const stdout = { path: result.stdoutPath, sha256: sha256File(result.stdoutPath) };
    const stderr = { path: result.stderrPath, sha256: sha256File(result.stderrPath) };
    const status = result.status === 0 && !result.signal ? 'PASS' : 'FAIL';
    if (status !== 'PASS') failed += 1;
    results[id] = {
      status,
      executionId: executionId(mode, id, context.contextSha256),
      executionPhase: phaseFor(mode, phaseClass),
      phaseClass,
      executedAtUtc: endedAtUtc,
      startedAtUtc,
      endedAtUtc,
      exitCode: result.status,
      signal: result.signal,
      contextSha256: context.contextSha256,
      buildSessionId: context.buildSessionId,
      installerSha256: context.installerSha256,
      frozenSourceCommit: context.implementationCommit,
      frozenSourceTree: context.implementationSourceTree,
      finalDeliveryHead: context.finalDeliveryHead,
      finalDeliveryTree: context.finalDeliveryTree,
      stdoutPath: stdout.path,
      stdoutSha256: stdout.sha256,
      stderrPath: stderr.path,
      stderrSha256: stderr.sha256,
      testFileSha256: sha256File(path.join(REPO_ROOT, 'tests', 'wp7', `${id}.js`))
    };
  }

  const document = {
    schemaVersion: 2,
    documentType: 'WP7_FINAL_REQUIRED_TEST_RESULTS',
    status: failed ? 'FAIL' : 'PASS',
    generatedAtUtc: new Date().toISOString(),
    executionMode: mode,
    contextPath: context.contextPath,
    contextSha256: context.contextSha256,
    buildSessionId: context.buildSessionId,
    installerSha256: context.installerSha256,
    frozenSourceCommit: context.implementationCommit,
    frozenSourceTree: context.implementationSourceTree,
    finalDeliveryHead: context.finalDeliveryHead,
    finalDeliveryTree: context.finalDeliveryTree,
    resultCount: assignments.length,
    passed: assignments.length - failed,
    failed,
    rawOutputRoot: rawRoot,
    results
  };
  writeCanonicalJson(resultsPath, document);
  process.stdout.write(`${JSON.stringify({ status: document.status, mode, resultsPath, passed: document.passed, failed }, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_REQUIRED_TEST_RUNNER_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(1);
}
