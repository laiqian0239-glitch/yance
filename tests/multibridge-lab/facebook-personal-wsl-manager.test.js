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

test('Windows operator preflight proves the real Facebook provisioning endpoint before any install', () => {
  const script = text(PS);
  assert.match(script, /Ubuntu-24\.04/);
  assert.match(script, /C:\\Users\\1\\Downloads\\yance-multibridge-lab/);
  assert.match(script, /runtime[\\/]docker-compose\.lab\.yml/);
  assert.match(script, /upstream-builds\.json/);
  assert.match(script, /facebook-personal/);
  assert.match(script, /\.appservice\.address/);
  assert.match(script, /\.provisioning\.allow_matrix_auth/);
  assert.match(script, /compose[\s\S]*port/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /\/dev\/tcp/);
  assert.match(script, /FACEBOOK_PROVISIONING_ENDPOINT_GREEN/);
  assert.match(script, /http:\/\/127\.0\.0\.1:/);
  assert.match(script, /http:\/\/127\.0\.0\.1:8008/);

  for (const forbidden of ['--install', '--update', '--set-version', '--set-default', '--shutdown', '--unregister']) {
    assert.doesNotMatch(script, new RegExp(`wsl(?:\\.exe)?[^\\r\\n]*${forbidden.replaceAll('-', '\\-')}`, 'i'));
  }
  assert.doesNotMatch(script, /\.wslconfig|netsh|Set-NetFirewall|New-NetFirewall/i);
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
  assert.match(workflow, /WINDOWS_POWERSHELL_5_1_MANAGER_PARSE_GREEN/);
  assert.match(workflow, /bash\s+-n[\s\S]*facebook-personal-manager-install\.sh/);
  assert.match(workflow, /--install-and-smoke/);
  assert.match(workflow, /yance-facebook-personal-wsl-manager/);
  assert.match(workflow, /MANAGER_WSL_PACKAGE_GREEN/);

  assert.match(wrapper, /PACKAGE_INTEGRITY_GREEN/);
  assert.match(wrapper, /PACKAGE_MOTW_RELEASE_GREEN/);
  assert.match(wrapper, /Unblock-File/);
  assert.match(wrapper, /pause/i);
  assert.doesNotMatch(wrapper, /ExecutionPolicy\s+(?:Bypass|Unrestricted)|Set-ExecutionPolicy/i);

  assert.match(readme, /Ubuntu-24\.04/);
  assert.match(readme, /official.*\.deb/i);
  assert.match(readme, /http:\/\/127\.0\.0\.1:8008/);
  assert.match(readme, /HUMAN_AUTH_REQUIRED/);
  assert.match(readme, /does not.*Facebook.*password|does not.*cookie/i);
});
