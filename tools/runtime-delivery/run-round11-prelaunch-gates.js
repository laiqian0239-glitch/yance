'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROUND11_PRELAUNCH_TEST_FILES } = require('./round11-prelaunch-contract');

const root = path.resolve(__dirname, '..', '..');
const outputRoot = path.join(root, '.tmp', 'round11-prelaunch-gates');

function run(label, command, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  const row = {
    label,
    command,
    args,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? String(result.error.stack || result.error.message || result.error) : ''
  };
  fs.writeFileSync(path.join(outputRoot, `${label}.stdout.log`), row.stdout, 'utf8');
  fs.writeFileSync(path.join(outputRoot, `${label}.stderr.log`), row.stderr, 'utf8');
  process.stdout.write(row.stdout);
  process.stderr.write(row.stderr);
  if (row.error) process.stderr.write(`${row.error}\n`);
  return row;
}

function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const testFiles = ROUND11_PRELAUNCH_TEST_FILES;
  const rows = [];
  rows.push(run('round11-production-gates', process.execPath, ['--test', '--test-concurrency=1', ...testFiles]));
  rows.push(run('round11-theme-audit', process.execPath, ['scripts/audit-theme-colors.js']));
  const ok = rows.every(row => row.exitCode === 0);
  const report = {
    schemaVersion: 1,
    documentType: 'YANCE_ROUND11_PRELAUNCH_GATES',
    generatedAtUtc: new Date().toISOString(),
    ok,
    dependencySensitiveTest: 'backend/tests/personaBrain/candidateBinding.test.js',
    rows: rows.map(({ stdout, stderr, ...row }) => ({
      ...row,
      stdoutLog: `${row.label}.stdout.log`,
      stderrLog: `${row.label}.stderr.log`
    }))
  };
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok, outputRoot, gates: report.rows }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
