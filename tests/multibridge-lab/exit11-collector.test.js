'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const COLLECTOR = path.join(ROOT, 'tools', 'multibridge-lab', 'collect-exit11-evidence.ps1');
const HELPER = path.join(ROOT, 'tools', 'multibridge-lab', 'native-process.ps1');

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(command) {
  const exe = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  return spawnSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
}

test('exit-11 collector exists and is wired to the proven native-process boundary', () => {
  assert.ok(fs.existsSync(COLLECTOR), `missing exit-11 collector: ${COLLECTOR}`);
  const script = fs.readFileSync(COLLECTOR, 'utf8');
  assert.match(script, /native-process\.ps1/);
  assert.match(script, /Invoke-LabNativeProcess/);
  assert.doesNotMatch(script, /2>&1/);
  assert.doesNotMatch(script, /&\s+docker\b/i);
});

test('collector is read-only and does not restart, build, exec, mutate networks, or rewrite config', () => {
  assert.ok(fs.existsSync(COLLECTOR), `missing exit-11 collector: ${COLLECTOR}`);
  const script = fs.readFileSync(COLLECTOR, 'utf8');
  for (const forbidden of [
    /\bdocker\s+(?:compose\s+)?(?:up|start|restart|stop|kill|rm|build|exec)\b/i,
    /\bdocker\s+network\s+(?:connect|disconnect|create|rm)\b/i,
    /Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item/i
  ]) assert.doesNotMatch(script, forbidden);
  assert.match(script, /\binspect\b/i);
  assert.match(script, /\blogs\b/i);
});

test('collector targets only the five recovery bridge services and emits one bounded evidence artifact', () => {
  assert.ok(fs.existsSync(COLLECTOR), `missing exit-11 collector: ${COLLECTOR}`);
  const script = fs.readFileSync(COLLECTOR, 'utf8');
  for (const service of ['facebook-personal', 'instagram-dm', 'google-messages', 'signal', 'line']) {
    assert.match(script, new RegExp(service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(script, /['"]--tail['"]\s*,\s*['"]80['"]/);
  assert.match(script, /Select-Object\s+-Last\s+12/);
  assert.match(script, /exit11-evidence\.txt/);
  assert.match(script, /FINAL STATUS:\s*REAL_RED/);
});

test('sanitizer redacts bridge secrets, authorization data, cookies, email/phone identifiers, and message-like content', { skip: process.platform !== 'win32' }, () => {
  assert.ok(fs.existsSync(COLLECTOR), `missing exit-11 collector: ${COLLECTOR}`);
  assert.ok(fs.existsSync(HELPER), `missing native-process helper: ${HELPER}`);
  const samples = [
    'as_token: super-secret-as-token',
    'hs_token=super-secret-hs-token',
    'Authorization: Bearer secret-bearer',
    'Cookie: sessionid=secret-cookie',
    'email=user@example.com phone=+491234567890',
    'message: private conversation text'
  ];
  const command = [
    `. ${psQuote(COLLECTOR)}`,
    `$samples = @(${samples.map((line) => psQuote(line)).join(',')})`,
    '$samples | ForEach-Object { Protect-LabEvidenceLine $_ }'
  ].join('; ');
  const run = runPowerShell(command);
  assert.equal(run.status, 0, `sanitizer execution failed:\n${run.stdout}\n${run.stderr}`);
  const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
  for (const secret of ['super-secret-as-token', 'super-secret-hs-token', 'secret-bearer', 'secret-cookie', 'user@example.com', '+491234567890', 'private conversation text']) {
    assert.doesNotMatch(combined, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(combined, /\[REDACTED\]/);
});

test('collector evidence boundary turns native logs stderr plus nonzero into sanitized controlled RED', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-multibridge-collector-red-'));
  const fakeDocker = path.join(dir, 'docker.cmd');
  fs.writeFileSync(fakeDocker, [
    '@echo off',
    'if "%1"=="ps" (echo fake-container-id& exit /b 0)',
    'if "%1"=="inspect" (echo restarting^|11^|3& exit /b 0)',
    'if "%1"=="logs" (echo Configuration error: token=SECRET_NATIVE_TOKEN LAB_CONTROLLED_NATIVE_FAILURE 1>&2& exit /b 9)',
    'echo unexpected fake docker arguments 1>&2',
    'exit /b 19',
    ''
  ].join('\r\n'), 'utf8');

  try {
    const command = [
      `. ${psQuote(COLLECTOR)}`,
      'try {',
      `  $null = Get-LabExit11ServiceEvidence -DockerPath ${psQuote(fakeDocker)} -Service 'signal'`,
      "  Write-Output 'UNEXPECTED_COLLECTOR_SUCCESS'",
      '  exit 17',
      '} catch {',
      '  $safe = Protect-LabEvidenceLine $_.Exception.Message',
      '  Write-Output ("CONTROLLED_REAL_RED=" + $safe)',
      '}'
    ].join('; ');
    const run = runPowerShell(command);
    const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
    assert.equal(run.status, 0, `collector did not produce controlled RED:\n${combined}`);
    assert.match(combined, /CONTROLLED_REAL_RED=/);
    assert.match(combined, /exit code 9/i);
    assert.match(combined, /LAB_CONTROLLED_NATIVE_FAILURE/);
    assert.doesNotMatch(combined, /SECRET_NATIVE_TOKEN/);
    assert.doesNotMatch(combined, /UNEXPECTED_COLLECTOR_SUCCESS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
