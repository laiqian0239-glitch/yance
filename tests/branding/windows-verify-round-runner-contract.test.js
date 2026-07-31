'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(ROOT, 'tools', 'release-closure', 'RUN_WINDOWS_VERIFY_ROUND.ps1');
const source = fs.readFileSync(SCRIPT_PATH, 'utf8');

test('controlled Windows verification runner has PowerShell-safe native failure interpolation', () => {
  assert.match(source, /exit code \$\{code\}:/);
  assert.doesNotMatch(source, /exit code \$code:/);
});

test('controlled Windows verification runner binds bundle and source identity', () => {
  for (const parameter of ['BundlePath', 'ExpectedBundleSha256', 'ExpectedBranch', 'ExpectedCommit', 'ExpectedTree', 'NodeRoot']) {
    assert.match(source, new RegExp(`\\[string\\]\\$${parameter}`));
  }
  assert.match(source, /Get-FileHash[^\n]+SHA256/);
  assert.match(source, /Commit mismatch/);
  assert.match(source, /Tree mismatch/);
  assert.match(source, /Branch mismatch/);
});

test('controlled Windows verification runner preserves isolated two-round contract', () => {
  assert.match(source, /\[ValidateSet\(1, 2\)\]/);
  for (const directory of ['source', 'npm-cache', 'temp', 'evidence', 'logs']) {
    assert.match(source, new RegExp(`'${directory}'`));
  }
  assert.match(source, /npm-cli\.js/);
  assert.match(source, /YANCE_NPM_CLI_JS/);
  assert.match(source, /YANCE_NODE_EXE/);
  assert.match(source, /'ci', '--ignore-scripts', '--no-audit', '--no-fund'/);
  assert.match(source, /tools\\wp7\\verify\.js/);
  assert.match(source, /Repository is dirty after verification/);
  assert.match(source, /git -C \$SourceRoot fsck --full/);
  assert.match(source, /Assert-NoHiddenIndexFlags/);
  assert.match(source, /windows-verify-preflight\.js/);
  assert.match(source, /--temp-selection-evidence/);
  assert.match(source, /\$TempSelectionPath/);
  assert.match(source, /Select-CompatibleTempRoot/);
  assert.match(source, /ROUND_RESULT\.json/);
  assert.match(source, /ENVIRONMENT_MANIFEST\.json/);
  assert.match(source, /STEP_RESULTS\.json/);
  assert.match(source, /PROCESS_TIMELINE\.json/);
  assert.match(source, /FINAL_STATUS\.txt/);
});

test('controlled Windows verification runner scopes the proven PowerShell 5.1 native stderr workaround to logged Node execution', () => {
  const loggedNodeStart = source.indexOf('function Invoke-LoggedNode');
  const nextFunction = source.indexOf('function Normalize-WindowsPathForLexicalComparison', loggedNodeStart);
  assert.notEqual(loggedNodeStart, -1);
  assert.notEqual(nextFunction, -1);
  const loggedNode = source.slice(loggedNodeStart, nextFunction);

  assert.match(loggedNode, /\$previousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(loggedNode, /\$ErrorActionPreference = 'Continue'/);
  assert.match(loggedNode, /& \$NodeExe @Arguments 1> \$stdout 2> \$stderr/);
  assert.match(loggedNode, /\$exitCode = \$LASTEXITCODE/);
  assert.match(loggedNode, /\$ErrorActionPreference = \$previousErrorActionPreference/);
  assert.match(loggedNode, /completed npm ci and WP7 on the/);
  assert.match(loggedNode, /determined exclusively by \$LASTEXITCODE/);
  assert.doesNotMatch(loggedNode, /stderr[^\n]*throw/i);
});

test('logged Node execution writes live stage status and judges npm warnings only by native exit code', () => {
  const loggedNodeStart = source.indexOf('function Invoke-LoggedNode');
  const nextFunction = source.indexOf('function Normalize-WindowsPathForLexicalComparison', loggedNodeStart);
  const loggedNode = source.slice(loggedNodeStart, nextFunction);

  assert.match(loggedNode, /Write-LiveStatus/);
  assert.match(loggedNode, /finished with exit code/);
  assert.match(source, /LIVE_STATUS\.json/);
});

test('controlled Windows verification runner is compatible with WorkBuddy restricted PowerShell hosts', () => {
  assert.doesNotMatch(source, /Scripting\.FileSystemObject|New-Object\s+-ComObject/i);
  assert.match(source, /cmd\.exe/);
  assert.match(source, /%~sI/);
  assert.match(source, /WINDOWS_SHORT_PATH_COMMAND_FAILED/);
  assert.match(source, /YANCE_WINDOWS_TEMP_SHORT_PATH_UNAVAILABLE/);
  assert.match(source, /LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION/);
  assert.match(source, /Normalize-WindowsPathForLexicalComparison/);
  assert.doesNotMatch(source, /GetFullPath\(\$shortPath\)/);
});


test('controlled Windows verification runner distinguishes ordinary H from hidden index flags', () => {
  assert.match(source, /\[char\]::IsLower\(\$flag\)/);
  assert.match(source, /\$flag -ceq \[char\]'S'/);
  assert.doesNotMatch(source, /\$_ -match '\^\[a-zS\]'/);
});

test('controlled Windows verification runner always emits valid and truthful early-failure evidence', () => {
  assert.match(source, /ConvertTo-Json -InputObject \$Value/);
  assert.match(source, /TEMP_SELECTION\.json/);
  assert.match(source, /status = 'BOOTSTRAP'/);
  assert.match(source, /Get-ChildItem -LiteralPath \$RoundRoot -File -Recurse/);
  assert.match(source, /formalRoundEligible = \(\$VerificationMode -eq 'STRICT' -and \$overallStatus -eq 'PASS'\)/);
});
