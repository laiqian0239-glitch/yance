'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const COLLECTOR = path.join(ROOT, 'tools', 'multibridge-lab', 'collect-exit11-evidence.ps1');

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWindowsPowerShell(command) {
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
}

test('collector declares a bounded fatal-context selector instead of relying only on last matching warnings', () => {
  assert.ok(fs.existsSync(COLLECTOR), `missing collector: ${COLLECTOR}`);
  const script = fs.readFileSync(COLLECTOR, 'utf8');
  assert.match(script, /function\s+Select-LabExit11FatalContext\b/);
  assert.match(script, /Configuration error/i);
  assert.match(script, /MaxLines/);
});

test('fatal-context selector keeps the latest fatal validator context even when later upgrader warnings dominate the tail', { skip: process.platform !== 'win32' }, () => {
  const lines = [
    'startup: loading configuration',
    'validator detail: database backend SECRET_CONTEXT_TOKEN is rejected',
    '2026-08-11T10:00:00Z FTL Configuration error error="REAL_FATAL_VALIDATOR"',
    'shutdown after fatal validation',
    ...Array.from({ length: 20 }, (_, i) => `Ignoring incorrect config field type !!null at warning->${i}`)
  ];
  const command = [
    `. ${psQuote(COLLECTOR)}`,
    `$lines = @(${lines.map(psQuote).join(',')})`,
    '$selected = @(Select-LabExit11FatalContext -Lines $lines -MaxLines 12)',
    "Write-Output ('COUNT=' + $selected.Count)",
    "$selected | ForEach-Object { Write-Output ('CTX=' + $_) }"
  ].join('; ');
  const run = runWindowsPowerShell(command);
  const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, `fatal-context selector failed:\n${combined}`);
  const countMatch = combined.match(/COUNT=(\d+)/);
  assert.ok(countMatch, `missing context count:\n${combined}`);
  assert.ok(Number(countMatch[1]) >= 1 && Number(countMatch[1]) <= 12, `context is not bounded:\n${combined}`);
  assert.match(combined, /REAL_FATAL_VALIDATOR/);
  assert.match(combined, /validator detail/);
  assert.doesNotMatch(combined, /SECRET_CONTEXT_TOKEN/);
});
