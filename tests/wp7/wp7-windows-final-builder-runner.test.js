'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, assertExternalOutput, canonicalTimestamp, stderrFailureDocument } = require('../../tools/wp7/run-windows-final-builder');

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
    '--expected-compiler-sha256', 'f'.repeat(64),
    '--rcedit-path', 'D:\\rcedit\\rcedit.exe',
    '--trusted-node-executable', 'D:\\trusted-node-22.23.1\\node.exe',
    '--expected-branch', 'rebuild/windows-release-closure-test',
    '--expected-commit', 'b'.repeat(40),
    '--expected-tree', 'c'.repeat(40),
    '--matrix-runtime-source', 'D:\\matrix-runtime',
    '--matrix-runtime-candidate-branch', 'rebuild/windows-release-closure-test',
    '--matrix-runtime-candidate-commit', 'b'.repeat(40),
    '--matrix-runtime-candidate-tree', 'c'.repeat(40),
    '--build-timestamp-utc', '2026-07-12T16:00:00.000Z'
  ]);
  assert.equal(parsed['compiler-path'], 'C:\\NSIS\\makensis.exe');
  assert.equal(parsed['expected-compiler-sha256'], 'f'.repeat(64));
  assert.equal(parsed['rcedit-path'], 'D:\\rcedit\\rcedit.exe');
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
    'RceditPath',
    'ExpectedMakensisSha256',
    '--expected-compiler-sha256',
    '--rcedit-path',
    '--trusted-node-executable',
    'v22.23.1',
    'YANCE_NPM_CLI_JS',
    'YANCE_NODE_EXE',
    'ELECTRON_SKIP_BINARY_DOWNLOAD',
    'Expand-ValidatedElectronArchive',
    'electron-offline-bootstrap.json',
    'Get-SanitizedPath',
    'SignToolPath'
  ]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /MatrixRuntimeSource/);
  assert.match(script, /MatrixRuntimeCandidateBranch/);
  assert.match(script, /MatrixRuntimeCandidateCommit/);
  assert.match(script, /MatrixRuntimeCandidateTree/);
  assert.match(script, /sealed Matrix runtime matrix-images\.tar is required/);
  assert.match(script, /\$NodeExe --version\)\.Trim\(\) -ne 'v22\.16\.0'/u);
  assert.match(script, /\$TrustedNodeExecutable --version\)\.Trim\(\) -ne 'v22\.23\.1'/u);
  assert.match(script, /\$NodeExe \$NpmCli --version\)\.Trim\(\) -ne '10\.9\.2'/u);
  assert.match(script, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$RceditPath/u);
  assert.doesNotMatch(script, /allowNonWindows/i);
  assert.doesNotMatch(script, /--branch rebuild\/windows-release-closure-20260712-controlled-builder/);
});

test('PowerShell Builder bootstraps Electron from the reviewed archive without network binary download', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  const skip = script.indexOf("$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'");
  const npmCi = script.indexOf('& $NodeExe $NpmCli ci --no-audit --no-fund');
  const extract = script.indexOf('Expand-ValidatedElectronArchive $ElectronArchive');
  const trustedProductionNode = script.indexOf('$env:YANCE_NODE_EXE = $TrustedNodeExecutable', extract);
  assert.ok(skip >= 0 && npmCi > skip && extract > npmCi, 'Electron download must be disabled before npm ci and the reviewed archive extracted afterwards');
  assert.ok(trustedProductionNode > extract, 'Final Builder production npm install must use the trusted packaged Node runtime after root bootstrap');
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

test('PowerShell Builder exposes child logs when Final Builder fails', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  const launch = script.indexOf('Start-Process');
  const wait = script.indexOf('$process.WaitForExit()', launch);
  const exit = script.indexOf('$process.ExitCode | Set-Content', wait);
  const failure = script.indexOf('if ($process.ExitCode -ne 0)', exit);
  assert.ok(launch > 0 && wait > launch && exit > wait && failure > exit);

  const failureBlock = script.slice(failure, script.indexOf('throw "Builder failed with exit', failure));
  assert.match(failureBlock, /Final Builder stderr/u);
  assert.match(failureBlock, /Get-Content -LiteralPath \$stderr/u);
  assert.match(failureBlock, /Final Builder stdout/u);
  assert.match(failureBlock, /Get-Content -LiteralPath \$stdout/u);
});

test('formal Builder failure output preserves structured npm install diagnostics in stderr', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'run-windows-final-builder.js'), 'utf8');
  assert.match(builder, /JSON\.stringify\(stderrFailureDocument\(error\), null, 2\)/u);
  assert.match(builder, /firstInstallDiagnostic/u);
  assert.match(builder, /stdoutTail/u);
  assert.match(builder, /stderrTail/u);
  assert.match(builder, /writeBuilderFailure\(safeOutputRoot\(process\.argv\.slice\(2\)\), error\)/u);

  const document = stderrFailureDocument({
    reasonCode: 'WP7_PRODUCTION_DEPENDENCY_INSTALL_FAILED',
    message: 'production dependency installation failed',
    details: {
      failureKind: 'EXIT_CODE',
      status: 1,
      stderr: 'npm warn EBADENGINE Unsupported engine\nnpm error code EBADENGINE\nnpm error notsup Required: {"node":">=22.19.0"}\n',
      stdout: 'installing\n',
      targetPlatform: 'win32',
      targetArch: 'x64'
    }
  });
  assert.equal(document.reasonCode, 'WP7_PRODUCTION_DEPENDENCY_INSTALL_FAILED');
  assert.equal(document.status, 1);
  assert.equal(document.targetPlatform, 'win32');
  assert.match(document.firstInstallDiagnostic, /npm warn EBADENGINE Unsupported engine/u);
  assert.match(document.stderrTail, /npm error code EBADENGINE/u);
});

test('release workflow downloads and verifies the same-source sealed Matrix runtime before Final Builder', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'windows-production-release.yml'), 'utf8');
  const builder = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'run-windows-final-builder.js'), 'utf8');

  assert.match(workflow, /materialized_matrix_run_id:/u);
  assert.match(workflow, /actions:\s*read/u);
  assert.match(workflow, /gh run download \$env:MATRIX_RUN_ID[^\n]*--name \$artifactName[^\n]*--dir \$root/u);
  assert.match(workflow, /\$artifactName = "Product-Experience-Materialized-Matrix-UAT-\$\(\$run\.head_sha\)"/u);
  assert.match(workflow, /PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY/u);
  assert.match(workflow, /matrix-images\.tar/u);
  assert.match(workflow, /create-materialized-uat-candidate\.js verify/u);
  assert.match(workflow, /sealed Matrix artifact commit\/run mismatch/u);
  assert.match(workflow, /sealed Matrix artifact\/release tree mismatch/u);
  assert.match(workflow, /-MatrixRuntimeSource \$env:MATRIX_RUNTIME_SOURCE/u);
  assert.match(workflow, /-MatrixRuntimeCandidateCommit \$env:MATRIX_RUNTIME_CANDIDATE_COMMIT/u);
  assert.match(workflow, /-MatrixRuntimeCandidateTree \$env:MATRIX_RUNTIME_CANDIDATE_TREE/u);
  assert.doesNotMatch(workflow, /-RequireSignedInstaller/u);

  assert.match(builder, /matrixRuntimeSource:\s*options\.matrixRuntimeSource/u);
  assert.match(builder, /matrixRuntimeIdentity:\s*options\.matrixRuntimeIdentity/u);
  assert.match(builder, /matrixRuntimeRelativeRoot/u);
  assert.match(builder, /matrixRuntimeImagesTarSha256/u);
});
