'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const PS = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-manager-wsl.ps1');
const SH = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-manager-install.sh');
const CMD = path.join(ROOT, 'tools', 'multibridge-lab', 'RUN_FACEBOOK_PERSONAL_MANAGER_WSL.cmd');
const README = path.join(ROOT, 'tools', 'multibridge-lab', 'FACEBOOK_PERSONAL_MANAGER_WSL_README.txt');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-facebook-wsl-manager.yml');

function text(file) {
  assert.ok(fs.existsSync(file), `missing required file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test('Windows operator preflight proves and repairs the real Facebook provisioning endpoint before any install', () => {
  const script = text(PS);
  assert.match(script, /Ubuntu-24\.04/);
  assert.match(script, /C:\\Users\\1\\Downloads\\yance-multibridge-lab/);
  assert.match(script, /runtime[\\/]docker-compose\.lab\.yml/);
  assert.match(script, /upstream-builds\.json/);
  assert.match(script, /facebook-personal/);
  assert.match(script, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(script, /Ensure-FacebookPersonalProvisioningAuthority/);
  assert.match(script, /\.InternalPort/);
  assert.match(script, /\.HostPort/);
  assert.match(script, /\.BridgeUrl/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /\/dev\/tcp/);
  assert.match(script, /FACEBOOK_PROVISIONING_ENDPOINT_GREEN/);
  assert.match(script, /http:\/\/127\.0\.0\.1:8008/);

  for (const forbidden of ['--install', '--update', '--set-version', '--set-default', '--shutdown', '--unregister']) {
    const escaped = forbidden.replaceAll('-', '\\-');
    assert.doesNotMatch(script, new RegExp(`-Arguments\\s+@\\([^)]*['\"]${escaped}['\"]`, 'i'));
    assert.doesNotMatch(script, new RegExp(`(?:wsl|wsl\\.exe)\\s+${escaped}(?:\\s|$)`, 'i'));
  }
  assert.doesNotMatch(script, /\.wslconfig|netsh|Set-NetFirewall|New-NetFirewall|portproxy/i);
});

test('Linux installer uses only the exact official deb and package-manager sandbox semantics', () => {
  const script = text(SH);
  assert.match(script, /mautrix-manager_0\.2\.1_amd64\.deb/);
  assert.match(script, /94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd/);
  assert.match(script, /dpkg-deb\s+-f[\s\S]*Version/);
  assert.match(script, /dpkg-deb\s+-f[\s\S]*Architecture/);
  assert.match(script, /sudo\s+-v/);
  assert.match(script, /sudo\s+apt-get\s+update/);
  assert.match(script, /sudo\s+apt-get\s+install\s+-y/);
  assert.match(script, /owner=root/);
  assert.match(script, /mode=4755/);
  assert.match(script, /ldd/);
  assert.match(script, /MAUTRIX_MANAGER_LINUX_DEB_SANDBOX_GREEN/);
  assert.match(script, /MAUTRIX_MANAGER_GUI_LAUNCHED/);
  assert.match(script, /FINAL STATUS: HUMAN_AUTH_REQUIRED/);

  assert.doesNotMatch(script, /--no-sandbox|--disable-setuid-sandbox/i);
  assert.doesNotMatch(script, /\bchown\b|\bchmod\s+4755\b/i);
  assert.doesNotMatch(script, /npm\s+(?:ci|install|start)|electron-forge|@electron\/rebuild/i);
  assert.doesNotMatch(script, /facebook\.com|cookie|password|2fa|access[_ -]?token/i);
});

test('upstream GUI lifecycle stays attached to the exact manager PID and cannot false-green on Chromium children', () => {
  const installer = text(SH);
  assert.doesNotMatch(installer, /\bnohup\b/);
  assert.doesNotMatch(installer, /\bpgrep\b/);
  assert.match(installer, /stability_seconds=['"]?15['"]?/);
  assert.match(installer, /manager_pid="\$!"/);
  assert.match(installer, /kill\s+-0\s+"\$manager_pid"/);
  assert.match(installer, /wait\s+"\$manager_pid"/);
  assert.match(installer, /MAUTRIX_MANAGER_GUI_SESSION_GREEN/);

  const stableIndex = installer.indexOf('MAUTRIX_MANAGER_GUI_SESSION_GREEN');
  const authIndex = installer.indexOf('FINAL STATUS: HUMAN_AUTH_REQUIRED');
  assert.ok(stableIndex >= 0 && authIndex > stableIndex, 'human-auth final status must follow exact-PID sustained-session proof');
});

test('Windows operator resolves a non-root WSLg user and pins GUI launch to that user', { skip: process.platform !== 'win32' }, () => {
  const script = text(PS);
  const installer = text(SH);
  assert.match(script, /function\s+Resolve-FacebookPersonalWslGuiUser/);
  assert.match(script, /WSL_GUI_USER_GREEN/);
  assert.match(script, /'--distribution',\s*\$DistroName,\s*'--user',\s*\$guiUser\.Name,\s*'--exec',\s*'bash'/);
  assert.match(installer, /MAUTRIX_MANAGER_GUI_USER_GREEN/);
  assert.match(installer, /id\s+-u/);
  assert.doesNotMatch(script, /--no-sandbox|--disable-setuid-sandbox/i);
  assert.doesNotMatch(installer, /--no-sandbox|--disable-setuid-sandbox/i);

  const command = [
    `. ${psQuote(PS)} -LibraryOnly`,
    'function Invoke-LabNativeProcess { param([string]$FilePath,[string[]]$Arguments,[string]$WorkingDirectory = ""); $joined = ($Arguments -join "|"); if ($joined -match "--exec\\|bash\\|-lc" -and $joined -notmatch "--user") { return [pscustomobject]@{ ExitCode = 0; StdOut = "UID=0`nUSER=root`n"; StdErr = "" } }; if ($joined -match "--exec\\|getent\\|passwd") { return [pscustomobject]@{ ExitCode = 0; StdOut = "root:x:0:0:root:/root:/bin/bash`nalice:x:1000:1000:Alice:/home/alice:/bin/bash`n"; StdErr = "" } }; if ($joined -match "--user\\|alice\\|--exec\\|bash\\|-lc") { return [pscustomobject]@{ ExitCode = 0; StdOut = "UID=1000`nUSER=alice`nHOME=/home/alice`nWSLG=1`nDISPLAY_OK=1`n"; StdErr = "" } }; return [pscustomobject]@{ ExitCode = 9; StdOut = ""; StdErr = $joined } }',
    `$r = Resolve-FacebookPersonalWslGuiUser -WslExe 'C:\\Windows\\System32\\wsl.exe' -DistroName 'Ubuntu-24.04'`,
    'Write-Output ("USER=" + $r.Name + " UID=" + $r.Uid)'
  ].join('; ');
  const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(run.status, 0, `PowerShell WSL GUI user resolver test failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /USER=alice UID=1000/);
});

test('root-only WSL distro bootstraps a dedicated unprivileged GUI identity and separates install from launch', { skip: process.platform !== 'win32' }, () => {
  const script = text(PS);
  const installer = text(SH);
  assert.match(script, /function\s+Ensure-FacebookPersonalWslGuiUser/);
  assert.match(script, /yance-manager/);
  assert.match(script, /useradd/);
  assert.match(script, /WSL_GUI_USER_CREATED/);
  assert.match(script, /--install-only/);
  assert.match(script, /--launch-only/);
  assert.match(installer, /--install-only/);
  assert.match(installer, /--launch-only/);
  assert.doesNotMatch(script, /--set-default|\/etc\/wsl\.conf|usermod[^\r\n]*sudo/i);
  assert.doesNotMatch(installer, /--no-sandbox|--disable-setuid-sandbox/i);

  const command = [
    `. ${psQuote(PS)} -LibraryOnly`,
    '$script:created = $false',
    'function Invoke-LabNativeProcess { param([string]$FilePath,[string[]]$Arguments,[string]$WorkingDirectory = ""); $joined = ($Arguments -join "|"); if ($joined -match "--exec\\|bash\\|-lc" -and $joined -notmatch "--user") { return [pscustomobject]@{ ExitCode = 0; StdOut = "UID=0`nUSER=root`n"; StdErr = "" } }; if ($joined -match "--exec\\|getent\\|passwd") { $out = "root:x:0:0:root:/root:/bin/bash`n"; if ($script:created) { $out += "yance-manager:x:1000:1000:Yance Manager:/home/yance-manager:/bin/bash`n" }; return [pscustomobject]@{ ExitCode = 0; StdOut = $out; StdErr = "" } }; if ($joined -match "--user\\|root\\|--exec\\|bash\\|-lc" -and $joined -match "useradd") { $script:created = $true; return [pscustomobject]@{ ExitCode = 0; StdOut = "WSL_GUI_USER_CREATED=yance-manager`n"; StdErr = "" } }; if ($joined -match "--user\\|yance-manager\\|--exec\\|bash\\|-lc") { return [pscustomobject]@{ ExitCode = 0; StdOut = "UID=1000`nUSER=yance-manager`nHOME=/home/yance-manager`nWSLG=1`nDISPLAY_OK=1`n"; StdErr = "" } }; return [pscustomobject]@{ ExitCode = 9; StdOut = ""; StdErr = $joined } }',
    `$r = Ensure-FacebookPersonalWslGuiUser -WslExe 'C:\\Windows\\System32\\wsl.exe' -DistroName 'Ubuntu-24.04'`,
    'Write-Output ("USER=" + $r.Name + " UID=" + $r.Uid + " CREATED=" + $r.Created)'
  ].join('; ');
  const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(run.status, 0, `PowerShell root-only WSL GUI user bootstrap test failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /USER=yance-manager UID=1000 CREATED=True/);
});

test('interactive native launcher classifies stderr by exit code and does not hide sudo prompts', { skip: process.platform !== 'win32' }, () => {
  text(PS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wsl-manager-test-'));
  try {
    const ok = path.join(tmp, 'stderr-ok.cmd');
    const bad = path.join(tmp, 'stderr-bad.cmd');
    fs.writeFileSync(ok, '@echo off\r\n>&2 echo warning-like stderr\r\nexit /b 0\r\n', 'ascii');
    fs.writeFileSync(bad, '@echo off\r\n>&2 echo error-like stderr\r\nexit /b 7\r\n', 'ascii');

    for (const [fixture, expected] of [[ok, 0], [bad, 7]]) {
      const command = [
        `. ${psQuote(PS)} -LibraryOnly`,
        `$r = Invoke-LabNativeInteractiveProcess -FilePath ${psQuote(fixture)}`,
        'Write-Output ("RC=" + $r.ExitCode)'
      ].join('; ');
      const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true
      });
      assert.equal(run.status, 0, `PowerShell helper test failed:\n${run.stdout}\n${run.stderr}`);
      assert.match(run.stdout, new RegExp(`RC=${expected}`));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dedicated CI validates Linux install smoke and publishes a sealed Windows user package', () => {
  const workflow = text(WORKFLOW);
  const wrapper = text(CMD);
  const readme = text(README);

  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /facebook-personal-wsl-manager\.test\.js/);
  assert.match(workflow, /facebook-personal-provisioning-authority\.test\.js/);
  assert.match(workflow, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(workflow, /WINDOWS_POWERSHELL_5_1_MANAGER_PARSE_GREEN/);
  assert.match(workflow, /foreach\s*\(\$target\s+in\s+\$targets\)/);
  assert.match(workflow, /powershell\.exe[^\r\n]*-Target\s+\$target/);
  assert.doesNotMatch(workflow, /-Target\s+\$targets\b/);
  assert.match(workflow, /bash\s+-n[\s\S]*facebook-personal-manager-install\.sh/);
  assert.match(workflow, /--install-and-smoke/);
  assert.match(workflow, /yance-facebook-personal-wsl-manager/);
  assert.match(workflow, /MANAGER_WSL_PACKAGE_GREEN/);

  assert.match(wrapper, /PACKAGE_INTEGRITY_GREEN/);
  assert.match(wrapper, /PACKAGE_MOTW_RELEASE_GREEN/);
  assert.match(wrapper, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(wrapper, /Unblock-File/);
  assert.match(wrapper, /pause/i);
  assert.doesNotMatch(wrapper, /ExecutionPolicy\s+(?:Bypass|Unrestricted)|Set-ExecutionPolicy/i);

  assert.match(readme, /Ubuntu-24\.04/);
  assert.match(readme, /official.*\.deb/i);
  assert.match(readme, /http:\/\/127\.0\.0\.1:8008/);
  assert.match(readme, /HUMAN_AUTH_REQUIRED/);
  assert.match(readme, /does not.*Facebook.*password|does not.*cookie/i);
});