#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEST_ROOT = path.join(REPO_ROOT, 'tests', 'wp0');

function metricFromTap(stdout, label) {
  const matches = [...String(stdout || '').matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gm'))];
  return Number(matches.at(-1)?.[1] || 0);
}

function runIsolatedTest(file, rawRoot, timeout = 600000) {
  const testId = path.basename(file, '.js');
  const stdoutPath = path.join(rawRoot, `${testId}.stdout.txt`);
  const stderrPath = path.join(rawRoot, `${testId}.stderr.txt`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: REPO_ROOT,
      env: process.env,
      timeout,
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  return {
    ...result,
    testId,
    stdout: fs.readFileSync(stdoutPath, 'utf8'),
    stderr: fs.readFileSync(stderrPath, 'utf8')
  };
}

function main() {
  const files = fs.readdirSync(TEST_ROOT)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('tests', 'wp0', name));
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wp0-isolated-tests-'));
  const started = Date.now();
  const totals = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  let failedFiles = 0;

  process.stdout.write('TAP version 13\n');
  for (let index = 0; index < files.length; index += 1) {
    const result = runIsolatedTest(files[index], rawRoot);
    const child = {
      tests: metricFromTap(result.stdout, 'tests'),
      passed: metricFromTap(result.stdout, 'pass'),
      failed: metricFromTap(result.stdout, 'fail'),
      cancelled: metricFromTap(result.stdout, 'cancelled'),
      skipped: metricFromTap(result.stdout, 'skipped'),
      todo: metricFromTap(result.stdout, 'todo')
    };
    const passed = result.status === 0 && !result.signal && !result.error && child.failed === 0;
    if (!child.tests) child.tests = 1;
    if (!passed && child.failed === 0) child.failed = 1;
    if (passed && child.passed === 0) child.passed = child.tests;
    for (const key of Object.keys(totals)) totals[key] += child[key];
    if (!passed) failedFiles += 1;

    process.stdout.write(`${passed ? 'ok' : 'not ok'} ${index + 1} - ${result.testId}\n`);
    if (!passed) {
      const detail = [result.stdout, result.stderr, result.error?.stack || result.error?.message || '']
        .filter(Boolean).join('\n').slice(-12000);
      for (const line of detail.split(/\r?\n/)) process.stdout.write(`  # ${line}\n`);
    }
  }

  process.stdout.write(`1..${files.length}\n`);
  process.stdout.write(`# tests ${totals.tests}\n`);
  process.stdout.write('# suites 0\n');
  process.stdout.write(`# pass ${totals.passed}\n`);
  process.stdout.write(`# fail ${totals.failed}\n`);
  process.stdout.write(`# cancelled ${totals.cancelled}\n`);
  process.stdout.write(`# skipped ${totals.skipped}\n`);
  process.stdout.write(`# todo ${totals.todo}\n`);
  process.stdout.write(`# duration_ms ${Date.now() - started}\n`);
  process.stdout.write(`# isolated_raw_output ${rawRoot}\n`);
  process.exit(failedFiles ? 1 : 0);
}

main();
