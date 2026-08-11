'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-wsl-readiness.ps1');
const WRAPPER = path.join(ROOT, 'tools', 'multibridge-lab', 'RUN_FACEBOOK_PERSONAL_WSL_READINESS.cmd');
const README = path.join(ROOT, 'tools', 'multibridge-lab', 'FACEBOOK_PERSONAL_WSL_READINESS_README.txt');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-native-process.yml');

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

test('Facebook Personal WSL readiness checker exists and is strictly read-only', () => {
  assert.ok(fs.existsSync(SCRIPT), `missing WSL readiness script: ${SCRIPT}`);
  assert.ok(fs.existsSync(WRAPPER), `missing WSL readiness wrapper: ${WRAPPER}`);
  assert.ok(fs.existsSync(README), `missing WSL readiness README: ${README}`);

  const script = fs.readFileSync(SCRIPT, 'utf8');
  const wrapper = fs.readFileSync(WRAPPER, 'utf8');
  const readme = fs.readFileSync(README, 'utf8');

  assert.match(script, /wsl\.exe/);
  assert.match(script, /--status/);
  assert.match(script, /--version/);
  assert.match(script, /--list[\s\S]*--verbose/);
  assert.match(script, /ConvertFrom-WslVerboseOutput/);
  assert.match(script, /uname\s+-m/);
  assert.match(script, /command\s+-v\s+apt-get/);
  assert.match(script, /command\s+-v\s+dpkg/);
  assert.match(script, /\/mnt\/wslg/);
  assert.match(script, /WAYLAND_DISPLAY/);
  assert.match(script, /DISPLAY/);
  assert.match(script, /ip\s+route\s+show/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /8008/);
  assert.match(script, /\/dev\/tcp/);
  assert.match(script, /WSL_WINDOWS_LAB_CONNECTIVITY_GREEN/);
  assert.match(script, /WSL_LAB_NETWORK_REQUIRED/);
  assert.match(script, /WSL_GUI_READY/);
  assert.match(script, /WSL_SETUP_REQUIRED/);
  assert.match(script, /REAL_RED/);

  for (const forbidden of [
    '--install', '--update', '--set-version', '--set-default', '--set-default-version',
    '--unregister', '--shutdown', '--terminate', '--import', '--export', '--mount', '--unmount'
  ]) {
    assert.doesNotMatch(script, new RegExp(forbidden.replaceAll('-', '\\-'), 'i'), `mutating WSL command forbidden: ${forbidden}`);
  }
  assert.doesNotMatch(script, /Enable-WindowsOptionalFeature|dism(?:\.exe)?|Set-ItemProperty|New-ItemProperty/i);
  assert.doesNotMatch(script, /sudo|apt-get\s+install|dpkg\s+-i/i);
  assert.doesNotMatch(script, /cookie|password|access[_ -]?token|2fa|facebook\.com/i);
  assert.doesNotMatch(script, /netsh|Set-NetFirewall|New-NetFirewall|\.wslconfig/i);

  assert.match(wrapper, /PACKAGE_INTEGRITY_GREEN/);
  assert.match(wrapper, /PACKAGE_MOTW_RELEASE_GREEN/);
  assert.match(wrapper, /Unblock-File/);
  assert.match(wrapper, /pause/i);
  assert.doesNotMatch(wrapper, /ExecutionPolicy\s+(?:Bypass|Unrestricted)|Set-ExecutionPolicy/i);

  assert.match(readme, /read-only/i);
  assert.match(readme, /does not install/i);
  assert.match(readme, /WSL_GUI_READY/);
  assert.match(readme, /WSL_SETUP_REQUIRED/);
  assert.match(readme, /WSL_LAB_NETWORK_REQUIRED/);
});

test('WSL verbose parser preserves distro names and WSL2 identity across English and localized states', { skip: process.platform !== 'win32' }, () => {
  const english = [
    '  NAME                   STATE           VERSION',
    '* Ubuntu-24.04           Running         2',
    '  docker-desktop         Stopped         2',
    '  Legacy Linux           Stopped         1'
  ].join('\r\n');
  const localized = [
    '  NAME                   STATE           VERSION',
    '* Ubuntu                 已停止          2',
    '  Debian Test            正在运行        2'
  ].join('\r\n');

  for (const [fixture, expected] of [
    [english, ['Ubuntu-24.04|2|True', 'docker-desktop|2|False', 'Legacy Linux|1|False']],
    [localized, ['Ubuntu|2|True', 'Debian Test|2|False']]
  ]) {
    const encoded = Buffer.from(fixture, 'utf8').toString('base64');
    const command = [
      `. ${psQuote(SCRIPT)} -LibraryOnly`,
      `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
      'ConvertFrom-WslVerboseOutput -Text $text | ForEach-Object { Write-Output ($_.Name + "|" + $_.Version + "|" + $_.IsDefault) }'
    ].join('; ');
    const run = runWindowsPowerShell(command);
    assert.equal(run.status, 0, `WSL parser PowerShell failed:\n${run.stdout}\n${run.stderr}`);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/).filter(Boolean), expected);
  }
});

test('native Windows CI publishes the bounded WSL readiness package only after contracts pass', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /yance-facebook-personal-wsl-readiness/);
  assert.match(workflow, /facebook-personal-wsl-readiness\.ps1/);
  assert.match(workflow, /RUN_FACEBOOK_PERSONAL_WSL_READINESS\.cmd/);
  assert.match(workflow, /FACEBOOK_PERSONAL_WSL_READINESS_README\.txt/);
  assert.match(workflow, /WINDOWS_POWERSHELL_5_1_WSL_CHECKER_PARSE_GREEN/);
  assert.match(workflow, /WSL_READINESS_PACKAGE_GREEN/);
});
