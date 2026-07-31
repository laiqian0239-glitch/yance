#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyIdentityBoundSourceArchive } = require('../tools/runtime-delivery/identity-bound-source-archive');
const { EXPECTED_ROUND11_PRELAUNCH_TESTS, ROUND11_PRELAUNCH_TEST_FILES } = require('../tools/runtime-delivery/round11-prelaunch-contract');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_KIND = 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE';
const PACKAGE_INTEGRITY_FILE_NAMES = Object.freeze([
  'RUN_ACCEPTANCE.cmd',
  'RUN_ACCEPTANCE.ps1',
  'RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd',
  'BATCH40_WINDOWS_ACCEPTANCE_ZH.md',
  'BATCH40_EXTERNAL_EVIDENCE_TEMPLATE.json'
]);

const EXACT_AUTOMATED_GATES = Object.freeze({
  batch14: 3,
  themeLayout: 43,
  focused: 66,
  fix6dPrelaunch: EXPECTED_ROUND11_PRELAUNCH_TESTS,
  backendFiles: 200,
  backendTests: 1201
});
const BATCH14_TEST_FILE = 'backend\\tests\\f25WindowsUatRepairBatch14.test.js';
const THEME_LAYOUT_TEST_FILES = Object.freeze([
  BATCH14_TEST_FILE,
  'backend\\tests\\phase2Batch3ThemeComputedAudit.test.js',
  'backend\\tests\\phase2ThemeSemanticContract.test.js',
  'tests\\frontend-security\\global-theme-authority.test.js',
  'tests\\uat\\componentReadabilityContract.test.js',
  'tests\\uat\\fix15-global-layout-account-media.test.js',
  'tests\\uat\\themeStudioExpansion.test.js',
  'tests\\wp2\\global-theme-completion.test.js',
  'tests\\wp6\\m6-release-layout.test.js',
  'tests\\wp7\\production-layout-contract.test.js'
]);
const POWERSHELL_SCOPE_PREFIXES = new Set(['env', 'global', 'local', 'private', 'script', 'using']);

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function write(file, value) {
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectPackageFileHashes(packageRoot, names) {
  const hashes = {};
  for (const name of names) {
    if (!name || path.isAbsolute(name) || name.split(/[\\/]+/u).includes('..')) {
      throw new Error(`unsafe acceptance package file name: ${name}`);
    }
    const file = path.join(packageRoot, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`acceptance package file is missing: ${name}`);
    }
    hashes[name] = sha256File(file);
  }
  return hashes;
}

function resolveRepositoryIdentity() {
  const lineage = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/u);
  const branch = git(['branch', '--show-current']);
  if (!branch) throw new Error('working tree must be on a named branch');
  return { branch, commit: lineage[0], tree: git(['rev-parse', 'HEAD^{tree}']), parent: lineage[1] || null };
}

function verifyAcceptanceSourceBinding({ sourceArchive, identity }) {
  return verifyIdentityBoundSourceArchive({ archivePath: sourceArchive, identity });
}

function buildAcceptanceArchiveName(commit) {
  if (!/^[0-9a-f]{40}$/iu.test(String(commit || ''))) throw new Error('commit must be a 40-character Git object ID');
  return `${PACKAGE_KIND}_${String(commit).slice(0, 7)}.zip`;
}

function buildManifest({ commit, tree, sourceArchive = null, sourceSha256 = null, payloadIdentityVerified = false, packageFiles = {}, generatedAtUtc = new Date().toISOString() }) {
  return {
    schemaVersion: 4,
    packageKind: PACKAGE_KIND,
    generatedAtUtc,
    sourceCommit: commit,
    sourceTree: tree,
    sourceArchive,
    sourceSha256,
    payloadIdentityVerified: payloadIdentityVerified === true,
    packageFiles: { ...packageFiles },
    identityFiles: ['YANCE_SOURCE_CHECKPOINT.json', 'YANCE_ARTIFACT_DESCRIPTOR.json'],
    requiredPlatform: 'win32',
    requiredNodeVersion: '22.16.0',
    requiredNpmVersion: '10.9.2',
    exactAutomatedGates: EXACT_AUTOMATED_GATES,
    externalEvidenceStatus: 'EVIDENCE_NOT_COLLECTED',
    requiredEvidence: [
      'Batch14 raw TAP output: exactly 3/3, exit code 0',
      'theme/layout raw TAP output: exactly 43/43, exit code 0',
      'Batch40 focused raw TAP output: exactly 66/66, exit code 0',
      `FIX6D UI prelaunch raw TAP output: exactly ${EXPECTED_ROUND11_PRELAUNCH_TESTS}/${EXPECTED_ROUND11_PRELAUNCH_TESTS}, exit code 0`,
      'FIX6D theme color audit output: PASS, exit code 0',
      'complete backend runner output: exactly 200 files and 1201/1201 tests, exit code 0',
      'source archive SHA-256 positive binding and negative tamper rejection receipt',
      'real Windows Named Mutex evidence',
      'real Facebook, Telegram and WhatsApp account ingress/egress receipts',
      'real AI Provider cancellation, replacement and recovery receipts',
      'installer/runtime version plus source commit, tree and archive SHA binding'
    ],
    strictSummary: { exitCode: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 },
    governance: {
      windowsUatStatus: 'WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED',
      readyForPromotion: false,
      formalRelease: false
    }
  };
}

function buildWindowsCommand({ commit, tree }) {
  const themeFiles = THEME_LAYOUT_TEST_FILES.join(' ');
  const prelaunchFiles = ROUND11_PRELAUNCH_TEST_FILES.map(file => file.replaceAll('/', '\\')).join(' ');
  return [
    '@echo off',
    'setlocal enabledelayedexpansion',
    'cd /d "%~dp0\\.."',
    "for /f %%i in ('git rev-parse HEAD') do set ACTUAL_COMMIT=%%i",
    `if /I not "!ACTUAL_COMMIT!"=="${commit}" ( echo SOURCE_COMMIT_MISMATCH & exit /b 20 )`,
    "for /f %%i in ('git rev-parse HEAD^^{tree}') do set ACTUAL_TREE=%%i",
    `if /I not "!ACTUAL_TREE!"=="${tree}" ( echo SOURCE_TREE_MISMATCH & exit /b 21 )`,
    'if not "%PROCESSOR_ARCHITECTURE%"=="" ver >nul',
    'call npm ci --ignore-scripts --no-audit --no-fund || exit /b 30',
    `node --test --test-reporter=tap --test-concurrency=1 ${BATCH14_TEST_FILE} > BATCH14_THEME_CONTRACT.tap 2>&1`,
    'set BATCH14_EXIT=!ERRORLEVEL!',
    'if not "!BATCH14_EXIT!"=="0" exit /b 31',
    `node --test --test-reporter=tap --test-concurrency=1 ${themeFiles} > THEME_LAYOUT_CONTRACT.tap 2>&1`,
    'set THEME_EXIT=!ERRORLEVEL!',
    'if not "!THEME_EXIT!"=="0" exit /b 32',
    'node --test --test-reporter=tap --test-concurrency=1 backend\\tests\\batch40*.test.js > BATCH40_FOCUSED.tap 2>&1',
    'set FOCUSED_EXIT=!ERRORLEVEL!',
    'if not "!FOCUSED_EXIT!"=="0" exit /b 33',
    `node --test --test-reporter=tap --test-concurrency=1 ${prelaunchFiles} > FIX6D_UI_PRELAUNCH.tap 2>&1`,
    'set PRELAUNCH_EXIT=!ERRORLEVEL!',
    'if not "!PRELAUNCH_EXIT!"=="0" exit /b 37',
    'node scripts\\audit-theme-colors.js > FIX6D_THEME_AUDIT.log 2>&1',
    'set THEME_AUDIT_EXIT=!ERRORLEVEL!',
    'if not "!THEME_AUDIT_EXIT!"=="0" exit /b 38',
    'node backend\\run_all_tests.js > BATCH40_BACKEND_FULL.log 2>&1',
    'set BACKEND_EXIT=!ERRORLEVEL!',
    'if not "!BACKEND_EXIT!"=="0" exit /b 34',
    `node scripts\\verify-batch40-windows-evidence.js BATCH14_THEME_CONTRACT.tap !BATCH14_EXIT! THEME_LAYOUT_CONTRACT.tap !THEME_EXIT! BATCH40_FOCUSED.tap !FOCUSED_EXIT! FIX6D_UI_PRELAUNCH.tap !PRELAUNCH_EXIT! FIX6D_THEME_AUDIT.log !THEME_AUDIT_EXIT! BATCH40_BACKEND_FULL.log !BACKEND_EXIT! ${EXACT_AUTOMATED_GATES.batch14} ${EXACT_AUTOMATED_GATES.themeLayout} ${EXACT_AUTOMATED_GATES.focused} ${EXACT_AUTOMATED_GATES.fix6dPrelaunch} ${EXACT_AUTOMATED_GATES.backendFiles} ${EXACT_AUTOMATED_GATES.backendTests} 22.16.0 10.9.2 - - ${commit} ${tree} - - BATCH40_AUTOMATED_RECEIPT.json || exit /b 35`,
    'node tools\\wp3\\windows-named-mutex-evidence.js --output evidence\\wp3\\windows-named-mutex-real.json || exit /b 36',
    'echo AUTOMATED_SOURCE_GATES_COMPLETE_EXTERNAL_PLATFORM_EVIDENCE_STILL_REQUIRED',
    'exit /b 0',
    ''
  ].join('\r\n');
}

function buildOneClickLauncher() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_ACCEPTANCE.ps1"',
    'set RESULT=%ERRORLEVEL%',
    'echo.',
    'if not "%RESULT%"=="0" echo Yance Batch40 acceptance stopped with exit code %RESULT%.',
    'if "%RESULT%"=="0" echo Automated source gates completed. External platform evidence is still required.',
    'pause',
    'exit /b %RESULT%',
    ''
  ].join('\r\n');
}

function buildCompatibilityLauncher() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'call "%~dp0RUN_ACCEPTANCE.cmd"',
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n');
}

function findAmbiguousPowerShellVariableReferences(script) {
  return [...String(script).matchAll(/\$([A-Za-z_][A-Za-z0-9_]*):/gu)]
    .map(match => match[1])
    .filter(name => !POWERSHELL_SCOPE_PREFIXES.has(name.toLowerCase()));
}

function assertPowerShellInterpolationSafety(script) {
  const ambiguousVariables = findAmbiguousPowerShellVariableReferences(script);
  if (ambiguousVariables.length > 0) {
    throw new Error(`generated PowerShell contains ambiguous variable references before a colon: ${[...new Set(ambiguousVariables)].join(', ')}`);
  }
  return script;
}

function buildOneClickPowerShell({ sourceArchive, sourceSha256, commit, tree }) {
  const quote = value => String(value).replace(/'/g, "''");
  const prelaunchPowerShellArgs = ROUND11_PRELAUNCH_TEST_FILES
    .map(file => `'${quote(file.replaceAll('/', '\\'))}'`)
    .join(', ');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Set-StrictMode -Version Latest",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    '',
    `$SourceArchiveName = '${quote(sourceArchive)}'`,
    `$ExpectedSourceSha256 = '${quote(sourceSha256.toLowerCase())}'`,
    `$SourceCommit = '${quote(commit)}'`,
    `$SourceTree = '${quote(tree)}'`,
    `$ExpectedBatch14Tests = '${EXACT_AUTOMATED_GATES.batch14}'`,
    `$ExpectedThemeTests = '${EXACT_AUTOMATED_GATES.themeLayout}'`,
    `$ExpectedFocusedTests = '${EXACT_AUTOMATED_GATES.focused}'`,
    `$ExpectedPrelaunchTests = '${EXACT_AUTOMATED_GATES.fix6dPrelaunch}'`,
    `$ExpectedBackendFiles = '${EXACT_AUTOMATED_GATES.backendFiles}'`,
    `$ExpectedBackendTests = '${EXACT_AUTOMATED_GATES.backendTests}'`,
    "$NodeArchiveName = 'node-v22.16.0-win-x64.zip'",
    "$NodeUrl = 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip'",
    "$ExpectedNodeSha256 = '21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd'",
    '',
    "if (-not [Environment]::Is64BitOperatingSystem) { throw 'WINDOWS_X64_REQUIRED' }",
    "$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$packageManifest = Join-Path $packageRoot 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json'",
    '$packageManifestSha256 = $null',
    '$packageFilesVerified = 0',
    "$Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')",
    "$RunBase = Join-Path ([System.IO.Path]::GetTempPath()) 'YB40'",
    "$RunRoot = Join-Path $RunBase $Stamp",
    "$EvidenceRoot = Join-Path $RunRoot 'evidence'",
    "$SourceRoot = Join-Path $RunRoot 'source'",
    "$RuntimeRoot = Join-Path $RunRoot 'runtime'",
    "$TestTempRoot = Join-Path $RunRoot 't'",
    "$NodeZip = Join-Path $RuntimeRoot $NodeArchiveName",
    "$NodeRoot = Join-Path $RuntimeRoot 'node-v22.16.0-win-x64'",
    "$NodeExe = Join-Path $NodeRoot 'node.exe'",
    "$NpmCli = Join-Path $NodeRoot 'node_modules\\npm\\bin\\npm-cli.js'",
    "$CommandRunner = Join-Path $SourceRoot 'scripts\\run-command-with-heartbeat.js'",
    "$SourceZip = Join-Path $packageRoot $SourceArchiveName",
    "$SummaryPath = Join-Path $EvidenceRoot 'RUN_SUMMARY.json'",
    "$EvidenceZip = Join-Path $packageRoot (\"YANCE_BATCH40_WINDOWS_EVIDENCE_$Stamp.zip\")",
    'New-Item -ItemType Directory -Force -Path $EvidenceRoot, $SourceRoot, $RuntimeRoot, $TestTempRoot | Out-Null',
    '$env:YANCE_TEST_TEMP_ROOT = $TestTempRoot',
    '$env:TEMP = $TestTempRoot',
    '$env:TMP = $TestTempRoot',
    '$env:TMPDIR = $TestTempRoot',
    'Write-Host "HEARTBEAT interval for commands: 15 seconds"',
    '',
    'function Write-Summary([string]$Status, [string]$Step, [int]$ExitCode, [string]$Message) {',
    '  [ordered]@{',
    "    schemaVersion = 4; status = $Status; failedStep = $Step; exitCode = $ExitCode; message = $Message",
    "    acceptancePackage = [ordered]@{ packageKind = 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE'; manifestName = 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json'; manifestSha256 = $packageManifestSha256; packageFilesVerified = $packageFilesVerified; bindingStatus = $(if ($packageManifestSha256) { 'MANIFEST_AND_FILES_SHA256_VERIFIED' } else { 'NOT_VERIFIED' }) }",
    '    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")',
    '    sourceArchive = $SourceArchiveName; sourceSha256 = $ExpectedSourceSha256',
    '    sourceCommit = $SourceCommit; sourceTree = $SourceTree',
    '    exactAutomatedGates = [ordered]@{ batch14 = [int]$ExpectedBatch14Tests; themeLayout = [int]$ExpectedThemeTests; focused = [int]$ExpectedFocusedTests; fix6dPrelaunch = [int]$ExpectedPrelaunchTests; backendFiles = [int]$ExpectedBackendFiles; backendTests = [int]$ExpectedBackendTests }',
    "    evidenceStatus = 'AUTOMATED_SOURCE_GATES_COMPLETE_EXTERNAL_PLATFORM_EVIDENCE_REQUIRED'",
    '    readyForPromotion = $false; formalRelease = $false',
    '  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $SummaryPath -Encoding UTF8',
    '}',
    '',
    'function Write-Stage([string]$Name) {',
    '  Write-Host ("[{0}] RUNNING STAGE: {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Name)',
    '  Write-Host ("Evidence/log directory: {0}" -f $EvidenceRoot)',
    '}',
    '',
    'function Assert-Hash([string]$Path, [string]$Expected, [string]$Code) {',
    "  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw \"$Code`:FILE_MISSING:$Path\" }",
    '  $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()',
    "  if ($Actual -ne $Expected) { throw \"$Code`:SHA256_MISMATCH:$Actual\" }",
    '}',
    '',
    'function Invoke-Logged([string]$Name, [string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {',
    '  $Log = Join-Path $EvidenceRoot ($Name + ".log")',
    '  Write-Stage $Name',
    '  $PreviousErrorActionPreference = $ErrorActionPreference',
    '  $Code = 1',
    '  try {',
    "    $ErrorActionPreference = 'Continue'",
    "    & $NodeExe $CommandRunner '--name' $Name '--log' $Log '--cwd' $WorkingDirectory '--file' $File '--heartbeat-ms' '15000' '--' @Arguments",
    '    $Code = $LASTEXITCODE',
    '  } finally {',
    '    $ErrorActionPreference = $PreviousErrorActionPreference',
    '  }',
    '  Set-Content -LiteralPath (Join-Path $EvidenceRoot ($Name + ".exit-code.txt")) -Value $Code -Encoding ASCII',
    '  if ($Code -ne 0) { throw "COMMAND_FAILED:$Name`:$Code" }',
    '}',
    '',
    "$Step = 'bootstrap'",
    '$Result = 1',
    'try {',
    "  $Step = 'package-integrity'",
    "  Write-Stage 'package-integrity'",
    "  if (-not (Test-Path -LiteralPath $packageManifest -PathType Leaf)) { throw 'ACCEPTANCE_PACKAGE_MANIFEST_MISSING' }",
    '  $packageManifestSha256 = (Get-FileHash -LiteralPath $packageManifest -Algorithm SHA256).Hash.ToLowerInvariant()',
    '  $packageManifestData = Get-Content -LiteralPath $packageManifest -Raw | ConvertFrom-Json',
    "  if ([int]$packageManifestData.schemaVersion -ne 4) { throw 'ACCEPTANCE_PACKAGE_MANIFEST_SCHEMA_MISMATCH' }",
    `  if ([string]$packageManifestData.packageKind -ne '${PACKAGE_KIND}') { throw 'ACCEPTANCE_PACKAGE_KIND_MISMATCH' }`,
    "  if ([string]$packageManifestData.sourceArchive -ne $SourceArchiveName) { throw 'ACCEPTANCE_PACKAGE_SOURCE_ARCHIVE_MISMATCH' }",
    "  if ([string]$packageManifestData.sourceSha256 -ne $ExpectedSourceSha256) { throw 'ACCEPTANCE_PACKAGE_SOURCE_SHA256_MISMATCH' }",
    "  if ([string]$packageManifestData.sourceCommit -ne $SourceCommit) { throw 'ACCEPTANCE_PACKAGE_SOURCE_COMMIT_MISMATCH' }",
    "  if ([string]$packageManifestData.sourceTree -ne $SourceTree) { throw 'ACCEPTANCE_PACKAGE_SOURCE_TREE_MISMATCH' }",
    "  if ([int]$packageManifestData.exactAutomatedGates.batch14 -ne [int]$ExpectedBatch14Tests -or [int]$packageManifestData.exactAutomatedGates.themeLayout -ne [int]$ExpectedThemeTests -or [int]$packageManifestData.exactAutomatedGates.focused -ne [int]$ExpectedFocusedTests -or [int]$packageManifestData.exactAutomatedGates.fix6dPrelaunch -ne [int]$ExpectedPrelaunchTests -or [int]$packageManifestData.exactAutomatedGates.backendFiles -ne [int]$ExpectedBackendFiles -or [int]$packageManifestData.exactAutomatedGates.backendTests -ne [int]$ExpectedBackendTests) { throw 'ACCEPTANCE_PACKAGE_GATE_CONTRACT_MISMATCH' }",
    "  $packageFileProperties = @($packageManifestData.packageFiles.PSObject.Properties)",
    "  if ($packageFileProperties.Count -lt 1) { throw 'ACCEPTANCE_PACKAGE_FILE_HASH_MAP_MISSING' }",
    "  foreach ($property in $packageFileProperties) {",
    "    $relativeName = [string]$property.Name",
    `    if ([System.IO.Path]::IsPathRooted($relativeName) -or $relativeName.Split([char[]]'\\/') -contains '..') { throw "ACCEPTANCE_PACKAGE_FILE_PATH_UNSAFE:$relativeName" }`,
    "    $packageFile = Join-Path $packageRoot $relativeName",
    "    if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { throw \"PACKAGE_FILE_MISSING:$relativeName\" }",
    '    $actualPackageFileSha256 = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()',
    '    $expectedPackageFileSha256 = ([string]$property.Value).ToLowerInvariant()',
    '    if ($actualPackageFileSha256 -ne $expectedPackageFileSha256) { throw ("PACKAGE_FILE_SHA256_MISMATCH:{0}:{1}" -f $relativeName, $actualPackageFileSha256) }',
    "    $packageFilesVerified += 1",
    "  }",
    "  Copy-Item -LiteralPath $packageManifest -Destination (Join-Path $EvidenceRoot 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json') -Force",
    "  $Step = 'source-hash'",
    "  Write-Stage 'source-hash'",
    '  Assert-Hash $SourceZip $ExpectedSourceSha256 "SOURCE_PAYLOAD"',
    "$Step = 'source-binding-negative'",
    "  Write-Stage 'SOURCE_BINDING_NEGATIVE'",
    "$TamperedSourceZip = Join-Path $TestTempRoot 'tampered-source.zip'",
    '  Copy-Item -LiteralPath $SourceZip -Destination $TamperedSourceZip -Force',
    '  $TamperedBytes = [System.IO.File]::ReadAllBytes($TamperedSourceZip)',
    "  if ($TamperedBytes.Length -lt 1) { throw 'SOURCE_PAYLOAD_NEGATIVE_EMPTY' }",
    '  $TamperedBytes[$TamperedBytes.Length - 1] = $TamperedBytes[$TamperedBytes.Length - 1] -bxor 1',
    '  [System.IO.File]::WriteAllBytes($TamperedSourceZip, $TamperedBytes)',
    '  $TamperRejected = $false',
    '  $TamperMessage = $null',
    '  try { Assert-Hash $TamperedSourceZip $ExpectedSourceSha256 "SOURCE_PAYLOAD_NEGATIVE" } catch { $TamperRejected = $true; $TamperMessage = $_.Exception.Message }',
    "  if (-not $TamperRejected) { throw 'SOURCE_PAYLOAD_NEGATIVE_NOT_REJECTED' }",
    '  [ordered]@{ schemaVersion = 1; evidenceKind = "source-archive-sha256-negative-control"; status = "PASS"; expectedSha256 = $ExpectedSourceSha256; tamperedSha256 = (Get-FileHash -LiteralPath $TamperedSourceZip -Algorithm SHA256).Hash.ToLowerInvariant(); rejection = $TamperMessage } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot "SOURCE_BINDING_NEGATIVE.json") -Encoding UTF8',
    '  Remove-Item -LiteralPath $TamperedSourceZip -Force',
    "  $Step = 'source-extract'",
    "  Write-Stage 'source-extract'",
    '  Expand-Archive -LiteralPath $SourceZip -DestinationPath $SourceRoot -Force',
    "  if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'package-lock.json'))) { throw 'SOURCE_PACKAGE_LOCK_MISSING' }",
    '',
    "  $Step = 'node-download'",
    "  Write-Stage 'node-download'",
    '  if (-not (Test-Path -LiteralPath $NodeZip)) {',
    '    Invoke-WebRequest -UseBasicParsing -Uri $NodeUrl -OutFile $NodeZip',
    '  }',
    "  $Step = 'node-hash'",
    "  Write-Stage 'node-hash'",
    '  Assert-Hash $NodeZip $ExpectedNodeSha256 "NODE_RUNTIME"',
    "  $Step = 'node-extract'",
    "  Write-Stage 'node-extract'",
    '  if (-not (Test-Path -LiteralPath $NodeExe)) { Expand-Archive -LiteralPath $NodeZip -DestinationPath $RuntimeRoot -Force }',
    "  if (-not (Test-Path -LiteralPath $NodeExe)) { throw 'NODE_EXECUTABLE_MISSING' }",
    "  if (-not (Test-Path -LiteralPath $NpmCli)) { throw 'NPM_CLI_MISSING' }",
    '',
    "  $Step = 'environment'",
    "  Write-Stage 'environment'",
    '  $NodeVersion = (& $NodeExe --version).Trim()',
    '  $NpmVersion = (& $NodeExe $NpmCli --version).Trim()',
    "  if ($NodeVersion -ne 'v22.16.0') { throw \"NODE_VERSION_MISMATCH:$NodeVersion\" }",
    "  if ($NpmVersion -ne '10.9.2') { throw \"NPM_VERSION_MISMATCH:$NpmVersion\" }",
    '  [ordered]@{ platform = "win32"; architecture = $env:PROCESSOR_ARCHITECTURE; node = $NodeVersion; npm = $NpmVersion; sourceCommit = $SourceCommit; sourceTree = $SourceTree; sourceSha256 = $ExpectedSourceSha256; acceptancePackageManifestSha256 = $packageManifestSha256; acceptancePackageFilesVerified = $packageFilesVerified } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot "ENVIRONMENT.json") -Encoding UTF8',
    '',
    "  $Step = 'npm-ci'",
    "  Invoke-Logged 'npm-ci' $NodeExe @($NpmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund') $SourceRoot # npm ci --ignore-scripts --no-audit --no-fund",
    "  $Step = 'batch14-theme-contract'",
    "  Invoke-Logged 'BATCH14_THEME_CONTRACT' $NodeExe @('--test', '--test-reporter=tap', '--test-concurrency=1', 'backend\\tests\\f25WindowsUatRepairBatch14.test.js') $SourceRoot",
    "  $Step = 'theme-layout-contract'",
    "  Invoke-Logged 'THEME_LAYOUT_CONTRACT' $NodeExe @('--test', '--test-reporter=tap', '--test-concurrency=1', 'backend\\tests\\f25WindowsUatRepairBatch14.test.js', 'backend\\tests\\phase2Batch3ThemeComputedAudit.test.js', 'backend\\tests\\phase2ThemeSemanticContract.test.js', 'tests\\frontend-security\\global-theme-authority.test.js', 'tests\\uat\\componentReadabilityContract.test.js', 'tests\\uat\\fix15-global-layout-account-media.test.js', 'tests\\uat\\themeStudioExpansion.test.js', 'tests\\wp2\\global-theme-completion.test.js', 'tests\\wp6\\m6-release-layout.test.js', 'tests\\wp7\\production-layout-contract.test.js') $SourceRoot",
    "  $Step = 'batch40-focused'",
    "  Invoke-Logged 'BATCH40_FOCUSED' $NodeExe @('--test', '--test-reporter=tap', '--test-concurrency=1', 'backend\\tests\\batch40*.test.js') $SourceRoot",
    "  $Step = 'fix6c-ui-prelaunch'",
    `  Invoke-Logged 'FIX6D_UI_PRELAUNCH' $NodeExe @('--test', '--test-reporter=tap', '--test-concurrency=1', ${prelaunchPowerShellArgs}) $SourceRoot`,
    "  $Step = 'fix6c-theme-audit'",
    "  Invoke-Logged 'FIX6D_THEME_AUDIT' $NodeExe @('scripts\\audit-theme-colors.js') $SourceRoot",
    "  $Step = 'backend-full'",
    "  Invoke-Logged 'BATCH40_BACKEND_FULL' $NodeExe @('backend\\run_all_tests.js') $SourceRoot",
    '',
    "  $Step = 'strict-evidence-verification'",
    "  $env:npm_config_user_agent = 'npm/10.9.2 node/v22.16.0 win32 x64'",
    '  $Batch14Log = Join-Path $EvidenceRoot "BATCH14_THEME_CONTRACT.log"',
    '  $ThemeLog = Join-Path $EvidenceRoot "THEME_LAYOUT_CONTRACT.log"',
    '  $FocusedLog = Join-Path $EvidenceRoot "BATCH40_FOCUSED.log"',
    '  $PrelaunchLog = Join-Path $EvidenceRoot "FIX6D_UI_PRELAUNCH.log"',
    '  $ThemeAuditLog = Join-Path $EvidenceRoot "FIX6D_THEME_AUDIT.log"',
    '  $BackendLog = Join-Path $EvidenceRoot "BATCH40_BACKEND_FULL.log"',
    '  $Receipt = Join-Path $EvidenceRoot "BATCH40_AUTOMATED_RECEIPT.json"',
    `  Invoke-Logged 'STRICT_EVIDENCE_VERIFICATION' $NodeExe @('scripts\\verify-batch40-windows-evidence.js', $Batch14Log, '0', $ThemeLog, '0', $FocusedLog, '0', $PrelaunchLog, '0', $ThemeAuditLog, '0', $BackendLog, '0', '${EXACT_AUTOMATED_GATES.batch14}', '${EXACT_AUTOMATED_GATES.themeLayout}', '${EXACT_AUTOMATED_GATES.focused}', '${EXACT_AUTOMATED_GATES.fix6dPrelaunch}', '${EXACT_AUTOMATED_GATES.backendFiles}', '${EXACT_AUTOMATED_GATES.backendTests}', '22.16.0', '10.9.2', $SourceZip, $ExpectedSourceSha256, $SourceCommit, $SourceTree, $packageManifest, $packageRoot, $Receipt) $SourceRoot`,
    '',
    "  $Step = 'named-mutex'",
    "  Invoke-Logged 'WINDOWS_NAMED_MUTEX' $NodeExe @('--test', '--test-reporter=tap', 'tests\\wp3\\windows-named-mutex-real.test.js') $SourceRoot",
    '  [ordered]@{ schemaVersion = 1; evidenceKind = "windows-named-mutex-real"; status = "PASS"; platform = "win32"; provider = "WINDOWS_SYSTEM_THREADING_MUTEX"; sourceArchive = $SourceArchiveName; sourceSha256 = $ExpectedSourceSha256; sourceCommit = $SourceCommit; sourceTree = $SourceTree; acceptancePackageManifestSha256 = $packageManifestSha256; acceptancePackageFilesVerified = $packageFilesVerified; logSha256 = (Get-FileHash -LiteralPath (Join-Path $EvidenceRoot "WINDOWS_NAMED_MUTEX.log") -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot "windows-named-mutex-real.json") -Encoding UTF8',
    "  Write-Summary 'AUTOMATED_GATES_COMPLETE' '' 0 'AUTOMATED_SOURCE_GATES_COMPLETE_EXTERNAL_PLATFORM_EVIDENCE_REQUIRED'",
    '  $Result = 0',
    '} catch {',
    '  $Message = $_.Exception.Message',
    "  Write-Summary 'FAILED' $Step 1 $Message",
    '  Write-Error $Message',
    '} finally {',
    "  Get-ChildItem -LiteralPath $EvidenceRoot -File | ForEach-Object { '{0}  {1}' -f ((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()), $_.Name } | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'SHA256SUMS.txt') -Encoding ASCII",
    '  if (Test-Path -LiteralPath $EvidenceZip) { Remove-Item -LiteralPath $EvidenceZip -Force }',
    '  Compress-Archive -Path (Join-Path $EvidenceRoot "*") -DestinationPath $EvidenceZip -Force',
    '  Write-Host "Evidence package: $EvidenceZip"',
    '}',
    'exit $Result',
    ''
  ].join('\r\n');
  return assertPowerShellInterpolationSafety(script);
}

function createArchive(sourceDir, outputFile) {
  if (process.platform === 'win32') {
    const pattern = path.join(sourceDir, '*');
    const command = `Compress-Archive -Path '${pattern.replace(/'/g, "''")}' -DestinationPath '${outputFile.replace(/'/g, "''")}' -Force`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Compress-Archive failed');
    return;
  }
  const files = fs.readdirSync(sourceDir).sort();
  const result = spawnSync('zip', ['-q', '-j', outputFile, ...files.map(name => path.join(sourceDir, name))], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'zip failed');
}

function createStagingDirectory(outputRoot, preferredTempRoot = os.tmpdir()) {
  const base = fs.existsSync(preferredTempRoot) ? preferredTempRoot : outputRoot;
  return fs.mkdtempSync(path.join(base, 'yance-batch40-acceptance-'));
}

function main() {
  if (git(['status', '--porcelain'])) throw new Error('working tree must be clean');
  const identity = resolveRepositoryIdentity();
  const { commit, tree } = identity;
  const outputRoot = path.resolve(process.argv.includes('--output-dir')
    ? process.argv[process.argv.indexOf('--output-dir') + 1]
    : path.join(ROOT, 'artifacts'));
  fs.mkdirSync(outputRoot, { recursive: true });
  const staging = createStagingDirectory(outputRoot);
  const archive = path.join(outputRoot, buildAcceptanceArchiveName(commit));
  const sourceArchiveArg = process.argv.includes('--source-archive')
    ? process.argv[process.argv.indexOf('--source-archive') + 1]
    : '';
  const sourceArchive = sourceArchiveArg ? path.resolve(sourceArchiveArg) : '';
  const sourceSha256Arg = process.argv.includes('--source-sha256')
    ? process.argv[process.argv.indexOf('--source-sha256') + 1].toLowerCase()
    : '';
  let actualSourceSha256 = null;
  let sourceName = null;
  if (sourceArchive) {
    if (!fs.existsSync(sourceArchive)) throw new Error(`Source archive does not exist: ${sourceArchive}`);
    actualSourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourceArchive)).digest('hex');
    if (!sourceSha256Arg || actualSourceSha256 !== sourceSha256Arg) {
      throw new Error(`Source archive SHA-256 mismatch: ${actualSourceSha256} !== ${sourceSha256Arg || 'missing'}`);
    }
    sourceName = path.basename(sourceArchive);
    verifyAcceptanceSourceBinding({ sourceArchive, identity });
  }
  const manifestBase = buildManifest({
    commit,
    tree,
    sourceArchive: sourceName,
    sourceSha256: actualSourceSha256,
    payloadIdentityVerified: Boolean(sourceArchive),
    packageFiles: {}
  });
  write(path.join(staging, 'RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd'), buildWindowsCommand({ commit, tree }));
  write(path.join(staging, 'BATCH40_EXTERNAL_EVIDENCE_TEMPLATE.json'), {
    schemaVersion: 1,
    sourceCommit: commit,
    sourceTree: tree,
    sourceArchive: sourceName,
    sourceSha256: actualSourceSha256,
    evidenceStatus: 'EVIDENCE_NOT_COLLECTED',
    windows: {},
    facebook: {},
    telegram: {},
    whatsapp: {},
    aiProviders: {},
    reviewer: {},
    governance: manifestBase.governance
  });
  write(path.join(staging, 'BATCH40_WINDOWS_ACCEPTANCE_ZH.md'), [
    '# Batch40 FIX6D Windows 全量自动化验收说明',
    '',
    `本包绑定 source archive \`${sourceName || 'N/A'}\`、SHA-256 \`${actualSourceSha256 || 'N/A'}\`、commit \`${commit}\` 与 tree \`${tree}\`。`,
    '必须在真实 Windows 主机和真实平台/Provider 账号上执行；包内不含任何预制通过证据。',
    '',
    sourceArchive ? '1. 解压本验收包并运行 `RUN_ACCEPTANCE.cmd`；兼容入口 `RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd` 会转发到同一条受校验流程。' : '1. 在绑定的 Git 工作树中运行 `RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd`。',
    `2. 保存 Batch14 3/3、主题与布局 43/43、Batch40 focused 66/66、FIX6D UI 预启动 ${EXPECTED_ROUND11_PRELAUNCH_TESTS}/${EXPECTED_ROUND11_PRELAUNCH_TESTS}、主题颜色审计 PASS、完整 backend 1201/1201（200 文件）的原始日志、退出码和 Windows Named Mutex JSON。`,
    '3. 使用真实 Facebook、Telegram、WhatsApp 账号完成 ingress/egress，并保存平台 message ID、时间、账号范围和本地 durable receipt。',
    '4. 使用真实 AI Provider 验证取消、同 taskId 替换、超时、持久化降级与恢复，保存 execution ID/generation/exit receipt。',
    '5. 检查 SOURCE_BINDING_NEGATIVE.json、自动 receipt，并由独立复核者校验 archive SHA-256、commit/tree 与全部日志 SHA-256。',
    '',
    '所有外部证据通过并复核前保持：',
    '',
    '```text',
    'WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED',
    'readyForPromotion=false',
    'formalRelease=false',
    '```',
    ''
  ].join('\n'));

  if (sourceArchive) {
    fs.copyFileSync(sourceArchive, path.join(staging, sourceName));
    write(path.join(staging, 'RUN_ACCEPTANCE.cmd'), buildOneClickLauncher());
    write(path.join(staging, 'RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd'), buildCompatibilityLauncher());
    write(path.join(staging, 'RUN_ACCEPTANCE.ps1'), buildOneClickPowerShell({
      sourceArchive: sourceName,
      sourceSha256: actualSourceSha256,
      commit,
      tree
    }));
  }

  const integrityFileNames = [
    ...PACKAGE_INTEGRITY_FILE_NAMES.filter(name => fs.existsSync(path.join(staging, name))),
    ...(sourceName ? [sourceName] : [])
  ];
  const packageFiles = collectPackageFileHashes(staging, integrityFileNames);
  const manifest = buildManifest({
    commit,
    tree,
    sourceArchive: sourceName,
    sourceSha256: actualSourceSha256,
    payloadIdentityVerified: Boolean(sourceArchive),
    packageFiles
  });
  const manifestPath = path.join(staging, 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json');
  write(manifestPath, manifest);
  const manifestSha256 = sha256File(manifestPath);

  try {
    createArchive(staging, archive);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const checksum = `${archive}.sha256`;
  const manifestChecksum = `${archive}.manifest.sha256`;
  write(checksum, `${sha256}  ${path.basename(archive)}\n`);
  write(manifestChecksum, `${manifestSha256}  BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json\n`);
  process.stdout.write(`${JSON.stringify({ archive, checksum, manifestChecksum, sha256, manifestSha256, sourceCommit: commit, sourceTree: tree })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_KIND,
  PACKAGE_INTEGRITY_FILE_NAMES,
  EXACT_AUTOMATED_GATES,
  BATCH14_TEST_FILE,
  THEME_LAYOUT_TEST_FILES,
  buildAcceptanceArchiveName,
  buildManifest,
  collectPackageFileHashes,
  buildWindowsCommand,
  buildOneClickLauncher,
  buildCompatibilityLauncher,
  buildOneClickPowerShell,
  findAmbiguousPowerShellVariableReferences,
  assertPowerShellInterpolationSafety,
  createStagingDirectory,
  createArchive,
  resolveRepositoryIdentity,
  verifyAcceptanceSourceBinding,
  main
};
