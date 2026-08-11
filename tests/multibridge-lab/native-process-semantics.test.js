'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'tools', 'multibridge-lab', 'native-process.ps1');

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

function writeCmdFixture(dir, name, stderrLine, exitCode) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `@echo off\r\necho ${stderrLine} 1>&2\r\nexit /b ${exitCode}\r\n`, 'utf8');
  return file;
}

test('legacy direct-native PowerShell path reproduces stderr+exit0 failure', { skip: process.platform !== 'win32' }, () => {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "& $env:ComSpec /d /s /c 'echo LAB_LEGACY_STDERR_ZERO 1>&2 & exit /b 0' 2>&1",
    "Write-Output 'LAB_LEGACY_SURVIVED'"
  ].join('; ');
  const result = runWindowsPowerShell(command);
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0, `legacy direct-native path unexpectedly survived:\n${combined}`);
  assert.match(combined, /LAB_LEGACY_STDERR_ZERO/);
  assert.doesNotMatch(combined, /LAB_LEGACY_SURVIVED/);
});

test('Lab native-process helper isolates native stderr from PowerShell error semantics', () => {
  assert.ok(fs.existsSync(HELPER), `missing Lab native-process helper: ${HELPER}`);
  const script = fs.readFileSync(HELPER, 'utf8');
  for (const token of [
    'System.Diagnostics.ProcessStartInfo',
    'UseShellExecute = $false',
    'RedirectStandardOutput = $true',
    'RedirectStandardError = $true',
    'ReadToEndAsync()',
    '$process.ExitCode'
  ]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(script, /2>&1/);
  assert.doesNotMatch(script, /&\s+\$FilePath\b/);
});

test('native stderr plus exit 0 is retained without being classified as failure', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-multibridge-native-zero-'));
  try {
    const fixture = writeCmdFixture(dir, 'stderr-zero.cmd', 'LAB_STDERR_ZERO', 0);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. ${psQuote(HELPER)}`,
      `$result = Invoke-LabNativeProcess -FilePath ${psQuote(fixture)}`,
      '$result | ConvertTo-Json -Compress'
    ].join('; ');
    const run = runWindowsPowerShell(command);
    assert.equal(run.status, 0, `stderr+0 was misclassified as failure:\n${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.ExitCode, 0);
    assert.match(result.StdErr, /LAB_STDERR_ZERO/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('native stderr plus non-zero preserves stderr and exit code for controlled REAL_RED classification', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-multibridge-native-red-'));
  try {
    const fixture = writeCmdFixture(dir, 'stderr-red.cmd', 'LAB_STDERR_RED', 7);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. ${psQuote(HELPER)}`,
      `$result = Invoke-LabNativeProcess -FilePath ${psQuote(fixture)}`,
      '$result | ConvertTo-Json -Compress'
    ].join('; ');
    const run = runWindowsPowerShell(command);
    assert.equal(run.status, 0, `helper threw before collector could classify REAL_RED:\n${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.ExitCode, 7);
    assert.match(result.StdErr, /LAB_STDERR_RED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
