'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-watchdog.ps1'), 'utf8');
const launcher = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-watchdog-uac-launcher.ps1'), 'utf8');

test('watchdog journals full original adapter and route state before disable', () => {
  assert.ok(source.indexOf("state = 'PREPARED'") < source.lastIndexOf("$disableOperation = Invoke-AdapterActions 'DISABLE'"));
  assert.match(source, /adaptersBefore = \$beforeAdapters/);
  assert.match(source, /routesBefore = \$beforeRoutes/);
  assert.match(source, /isolated-state\.json/);
});

test('watchdog isolates all originally enabled visible adapters and verifies no default routes remain', () => {
  assert.match(source, /Get-NetAdapter \| Sort-Object InterfaceIndex/);
  assert.match(source, /adapterScope = 'ALL_ENABLED_VISIBLE_WINDOWS_ADAPTERS'/);
  assert.match(source, /adminStatus -eq 'Up'/);
  assert.match(source, /ISOLATE_ALL_ENABLED_VISIBLE_WITH_WATCHDOG/);
  assert.match(source, /allOriginallyEnabledPhysicalAdaptersDisabled/);
  assert.match(source, /allOriginallyEnabledIsolatableAdaptersDisabled/);
  assert.match(source, /noDefaultRoutesRemain/);
  assert.match(source, /remainingDefaultRouteCount/);
});

test('watchdog restore verifies full default-route identity including metric and protocol', () => {
  assert.match(source, /\[int\] \$Route\.routeMetric/);
  assert.match(source, /\[string\] \$Route\.protocol/);
});

test('watchdog restores in finally on release, deadline or acquire failure and verifies original state', () => {
  assert.match(source, /finally\s*\{/);
  assert.match(source, /Restore-FromJournal/);
  assert.match(source, /restorePostcondition/);
  assert.match(source, /ISOLATION_FAILED/);
  assert.match(source, /RESTORE_FAILED/);
});

test('watchdog uses a global mutex and performs stale recovery before new isolation', () => {
  assert.match(source, /Global\\YanceWp7NetworkIsolation/);
  assert.match(source, /Recover-StaleSessions/);
  assert.match(source, /stale-recovery-before-new-isolation/);
  assert.match(source, /catch \[Threading\.AbandonedMutexException\]/);
  assert.match(source, /stale journal recovery can restore the previous network state/);
});

test('watchdog protects accepted request and state under audited ProgramData ACL boundary', () => {
  assert.match(source, /ProgramData 'Yance\\WP7NetworkIsolation'/);
  assert.match(source, /Set-ProtectedDirectoryAcl/);
  assert.match(source, /Set-ProtectedFileAcl/);
  assert.match(source, /request\.accepted\.json/);
  assert.match(source, /request SHA256 mismatch/i);
  assert.match(source, /Set-ProtectedDirectoryAcl \$actualProtectedRoot \$ownerSid \$false/);
  assert.match(source, /cannot enumerate sibling sessions/);
  assert.match(source, /FileSystemRights\]::Traverse/);
});


test('watchdog launches an independent elevated guardian before disable and guardian restores after owner, primary, or deadline failure', () => {
  assert.match(source, /Invoke-GuardianMode/);
  assert.match(source, /guardianPid/);
  assert.match(source, /GuardianPrimaryPid/);
  assert.match(source, /GuardianOwnerPid/);
  assert.match(source, /Stop-Process -Id \$GuardianPrimaryPid -Force/);
  assert.match(source, /guardian-owner-exit/);
  assert.match(source, /guardian-primary-exit/);
  assert.match(source, /guardian-deadline/);
  assert.match(source, /Independent network recovery guardian exited while isolation was active/);
  assert.ok(source.indexOf('$guardianProcess = Start-Process') < source.lastIndexOf("$disableOperation = Invoke-AdapterActions 'DISABLE'"));
});

test('launcher uses encoded command for paths with spaces and binds request and script hashes', () => {
  assert.match(launcher, /-EncodedCommand/);
  assert.match(launcher, /ExpectedRequestSha256/);
  assert.match(launcher, /ExpectedWatchdogSha256/);
  assert.match(launcher, /ExpectedLauncherSha256/);
  assert.match(launcher, /ExpectedPowerShellSha256/);
  assert.match(launcher, /Join-Path \$PSHOME 'powershell\.exe'/);
  assert.match(launcher, /Start-Process \$powerShellPath/);
  assert.match(source, /powerShellExecutableSha256/);
  assert.match(source, /Start-Process \$powerShellExecutablePath/);
  assert.match(launcher, /-Verb RunAs/);
  assert.match(launcher, /elevatedProcessId/);
  assert.doesNotMatch(launcher, /-Wait/);
});
