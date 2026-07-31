'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const script = fs.readFileSync(path.join(ROOT, 'tools', 'release-closure', 'RUN_WINDOWS_ASSISTED_PIPELINE.ps1'), 'utf8');

test('assisted Windows pipeline is a single WorkBuddy-compatible entry point', () => {
  assert.match(script, /WINDOWS_ASSISTED_VALIDATION_CONFIG_/);
  assert.match(script, /VerificationMode', 'DIAGNOSTIC'/);
  assert.match(script, /VerificationMode', 'STRICT'/);
  assert.match(script, /create-windows-preacceptance\.js/);
  assert.match(script, /\$config\.builderFile/);
  assert.match(script, /Invoke-LoggedPowerShell \$builder/);
  assert.match(script, /deliveryVerifierSha256/);
  assert.match(script, /assistedPipelineSha256/);
  assert.match(script, /Compress-Archive/);
  assert.match(script, /Start-ConsoleHeartbeat/);
  assert.match(script, /Start-Sleep -Seconds 10/);
  assert.match(script, /validation is active; do not close this window/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /Get-Process -Id \$ParentProcessId/);
  assert.match(script, /DIAGNOSTIC\\Round1\\LIVE_STATUS\.json/);
  assert.match(script, /VALIDATION\\Round2\\LIVE_STATUS\.json/);
  assert.match(script, /Round \{0\} \{1\} \/ \{2\}/);
  assert.match(script, /LIVE_STATUS\.json/);
  assert.doesNotMatch(script, /Scripting\.FileSystemObject|New-Object\s+-ComObject/i);
});

test('assisted pipeline reports missing build tools as BLOCKED instead of source failure', () => {
  assert.match(script, /YANCE_ASSISTED_BUILD_TOOLS_MISSING/);
  assert.match(script, /\$finalStatus = 'BLOCKED'/);
  assert.match(script, /BUILD_TOOLS_BLOCKER\.json/);
});

test('assisted pipeline keeps release authorization fail-closed until Builder and UAT', () => {
  assert.match(script, /releaseApproved = \$false/);
  assert.match(script, /windowsUatRequired = \$true/);
  assert.match(script, /formalInstallerAuthorized/);
});


test('assisted pipeline resolves PSScriptRoot defaults after PowerShell 5.1 parameter binding', () => {
  assert.match(script, /\[string\]\$DeliveryRoot = ''/);
  assert.match(script, /IsNullOrWhiteSpace\(\$DeliveryRoot\).*\$PSScriptRoot/);
  assert.doesNotMatch(script, /\[string\]\$DeliveryRoot = \$PSScriptRoot/);
});


test('assisted pipeline packages stable evidence without mutable source, cache or temp trees', () => {
  assert.match(script, /function New-ResultPackage/);
  assert.match(script, /function Copy-RoundEvidence/);
  assert.match(script, /fresh source clones/);
  assert.match(script, /node_modules/);
  assert.match(script, /npm caches/);
  assert.match(script, /temporary directories/);
  assert.match(script, /RESULT_PACKAGE_MANIFEST\.json/);
  assert.match(script, /tar\.exe/);
  assert.match(script, /DestinationZip\.sha256/);
  assert.doesNotMatch(script, /Compress-Archive -Path \(Join-Path \$RunRoot '\*'\)/);
});

test('assisted pipeline shows the failing stage and log tail instead of a wrapper-only error', () => {
  assert.match(script, /failedStage/);
  assert.match(script, /Get-LogTail/);
  assert.match(script, /failure log tail/);
  assert.match(script, /Stage \$\{CurrentStage\}:/);
  assert.doesNotMatch(script, /Stage \$CurrentStage:/);
});


test('PowerShell 5.1 entry scripts remain ASCII-safe and never ask the user to mutate Windows settings', () => {
  const paths = [
    'tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1',
    'tools/release-closure/RUN_WINDOWS_VERIFY_ROUND.ps1',
    'tools/release-closure/VERIFY_DELIVERY.ps1',
    'tools/wp7/RUN_WINDOWS_FINAL_BUILDER.ps1'
  ];
  for (const relative of paths) {
    const value = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.equal([...value].some((character) => character.codePointAt(0) > 127), false, `${relative} must remain ASCII-safe for Windows PowerShell 5.1`);
    assert.doesNotMatch(value, /fsutil\s+8dot3name\s+set|LongPathsEnabled\s+\/t\s+REG_DWORD|reg\.exe?\s+add/i);
  }
});
