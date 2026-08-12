'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, assertExternalOutput, canonicalTimestamp } = require('../../tools/wp7/run-windows-final-builder');

const ROOT = path.resolve(__dirname, '..', '..');

test('formal Builder CLI requires all identity and external artifact arguments', () => {
  assert.throws(() => parseArgs(['--output-root', 'D:\\out']), /missing required option/);
  const parsed = parseArgs([
    '--output-root', 'D:\\out',
    '--preacceptance-record', 'D:\\pre.json',
    '--preacceptance-sha256', 'a'.repeat(64),
    '--windows-round1-result', 'D:\\round1.json',
    '--windows-round1-sha256', 'd'.repeat(64),
    '--windows-round2-result', 'D:\\round2.json',
    '--windows-round2-sha256', 'e'.repeat(64),
    '--electron-dist', 'D:\\electron',
    '--electron-archive', 'D:\\electron.zip',
    '--compiler-path', 'C:\\NSIS\\makensis.exe',
    '--trusted-node-executable', 'D:\\trusted-node-22.23.1\\node.exe',
    '--expected-branch', 'rebuild/windows-release-closure-test',
    '--expected-commit', 'b'.repeat(40),
    '--expected-tree', 'c'.repeat(40),
    '--build-timestamp-utc', '2026-07-12T16:00:00.000Z'
  ]);
  assert.equal(parsed['compiler-path'], 'C:\\NSIS\\makensis.exe');
  assert.equal(parsed['trusted-node-executable'], 'D:\\trusted-node-22.23.1\\node.exe');
});

test('formal Builder output must remain outside the source repository', () => {
  assert.throws(() => assertExternalOutput(ROOT, path.join(ROOT, 'builder-output')), /outside/);
  assert.doesNotThrow(() => assertExternalOutput(ROOT, path.resolve(ROOT, '..', 'external-builder-output')));
});

test('formal Builder timestamp must be canonical UTC ISO', () => {
  assert.equal(canonicalTimestamp('2026-07-12T16:00:00.000Z'), '2026-07-12T16:00:00.000Z');
  assert.throws(() => canonicalTimestamp('2026-07-12 16:00:00'), /canonical/);
});

test('PowerShell Builder wrapper contains the formal isolation and split runtime custody contract', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  for (const token of [
    'Global\\YanceWindowsFinalBuilder',
    'bundle verify',
    'heartbeat.jsonl',
    'overall-exit-code.txt',
    'status --porcelain',
    'residual-processes.json',
    'run-windows-final-builder.js',
    'ExpectedBranch',
    'RequireSignedInstaller',
    'SigningCertificate',
    'WindowsRound1Result',
    'WindowsRound2Result',
    'ExpectedBundleSha256',
    'NodeRoot',
    'TrustedNodeExecutable',
    '--trusted-node-executable',
    'v22.23.1',
    'YANCE_NPM_CLI_JS',
    'ELECTRON_SKIP_BINARY_DOWNLOAD',
    'Expand-ValidatedElectronArchive',
    'electron-offline-bootstrap.json',
    'Get-SanitizedPath',
    'SignToolPath'
  ]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /\$NodeExe --version\)\.Trim\(\) -ne 'v22\.16\.0'/u);
  assert.match(script, /\$TrustedNodeExecutable --version\)\.Trim\(\) -ne 'v22\.23\.1'/u);
  assert.match(script, /\$NodeExe \$NpmCli --version\)\.Trim\(\) -ne '10\.9\.2'/u);
  assert.doesNotMatch(script, /allowNonWindows/i);
  assert.doesNotMatch(script, /--branch rebuild\/windows-release-closure-20260712-controlled-builder/);
});

test('PowerShell Builder bootstraps Electron from the reviewed archive without network binary download', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  const skip = script.indexOf("$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'");
  const npmCi = script.indexOf('& $NodeExe $NpmCli ci --no-audit --no-fund');
  const extract = script.indexOf('Expand-ValidatedElectronArchive $ElectronArchive');
  assert.ok(skip >= 0 && npmCi > skip && extract > npmCi, 'Electron download must be disabled before npm ci and the reviewed archive extracted afterwards');
  assert.match(script, /Electron archive path escapes destination/);
  assert.match(script, /Electron archive contains a duplicate path/);
  assert.match(script, /Electron archive contains a dot path segment/);
  assert.match(script, /Electron archive contains a symbolic link/);
  assert.match(script, /archive version \$archiveVersion does not match npm package version \$packageVersion/);
  assert.match(script, /WriteAllText\(\(Join-Path \$PackageRoot 'path\.txt'\), 'electron\.exe'/);
  assert.match(script, /electron-offline-bootstrap\.json/);
  assert.doesNotMatch(script, /& \$NodeExe \$NpmCli ci --no-audit --no-fund[\s\S]{0,300}Electron distribution was not installed'\s*\}/);
});

test('PowerShell Builder treats npm warnings as stderr diagnostics and uses the native exit code', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  const npmStart = script.indexOf("$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'");
  const extract = script.indexOf('Expand-ValidatedElectronArchive $ElectronArchive', npmStart);
  const npmBlock = script.slice(npmStart, extract);
  assert.match(npmBlock, /\$previousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(npmBlock, /\$ErrorActionPreference = 'Continue'/);
  assert.match(npmBlock, /\$npmCiExitCode = \$LASTEXITCODE/);
  assert.match(npmBlock, /if \(\$npmCiExitCode -ne 0\)/);
  assert.match(npmBlock, /\$ErrorActionPreference = \$previousErrorActionPreference/);
  assert.match(script, /Final Builder is still running; do not close this window/);
});
