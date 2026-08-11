'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-provisioning-authority.ps1');
const OPERATOR = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-manager-wsl.ps1');
const MANAGER_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-facebook-wsl-manager.yml');

function text(file) {
  assert.ok(fs.existsSync(file), `missing required file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test('shared Facebook provisioning authority repairs only the Compose publication surface', () => {
  const helper = text(HELPER);

  for (const field of [
    '.appservice.address',
    '.appservice.hostname',
    '.appservice.port',
    '.provisioning.allow_matrix_auth'
  ]) assert.match(helper, new RegExp(field.replaceAll('.', '\\.')));

  assert.match(helper, /compose[\s\S]*config[\s\S]*--format[\s\S]*json/i);
  assert.match(helper, /127\.0\.0\.1/);
  assert.match(helper, /services[\s\S]*facebook-personal[\s\S]*ports/i);
  assert.match(helper, /FACEBOOK_PROVISIONING_COMPOSE_AUTHORITY_GREEN/);
  assert.match(helper, /\[IO\.File\]::Replace\(/);
  assert.match(helper, /--force-recreate[\s\S]*facebook-personal/);
  assert.match(helper, /RestartCount/);
  assert.match(helper, /compose[\s\S]*port[\s\S]*facebook-personal/i);
  assert.match(helper, /Get-FacebookComposeProjectionWithoutProvisioningPort/);

  assert.doesNotMatch(helper, /--network\s+host|container[_ -]?ip|\.wslconfig|netsh|Set-NetFirewall|New-NetFirewall/i);
  assert.doesNotMatch(helper, /proxy_pass|socat|nginx|iptables|portproxy/i);
});

test('pure Compose projection helpers preserve non-port semantics and require loopback identity', { skip: process.platform !== 'win32' }, () => {
  const documentJson = JSON.stringify({
    name: 'lab',
    services: {
      synapse: { image: 'synapse:test' },
      'facebook-personal': {
        image: 'facebook:test',
        volumes: ['x:/data'],
        ports: [{ target: 29319, published: '29319', host_ip: '127.0.0.1', protocol: 'tcp' }]
      }
    }
  });
  const command = [
    `. ${psQuote(HELPER)}`,
    `$doc = ${psQuote(documentJson)} | ConvertFrom-Json`,
    '$m = Get-FacebookTargetPortMappings -Document $doc -InternalPort 29319',
    'Write-Output ("COUNT=" + $m.Count)',
    'Write-Output ("LOOPBACK=" + (Test-FacebookLoopbackPortMapping -Mapping $m[0] -InternalPort 29319))',
    '$projection = Get-FacebookComposeProjectionWithoutProvisioningPort -Document $doc',
    'Write-Output ("HAS_IMAGE=" + $projection.Contains("facebook:test"))',
    'Write-Output ("HAS_PORT=" + $projection.Contains("29319"))'
  ].join('; ');
  const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(run.status, 0, `PowerShell projection helper test failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /COUNT=1/);
  assert.match(run.stdout, /LOOPBACK=True/);
  assert.match(run.stdout, /HAS_IMAGE=True/);
  assert.match(run.stdout, /HAS_PORT=False/);
});

test('WSL operator repairs and reuses the Compose authority before downloading the manager deb', () => {
  const operator = text(OPERATOR);
  assert.match(operator, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(operator, /Ensure-FacebookPersonalProvisioningAuthority/);
  assert.match(operator, /\.InternalPort/);
  assert.match(operator, /\.HostPort/);
  assert.match(operator, /\.BridgeUrl/);
  const ensureIndex = operator.indexOf('Ensure-FacebookPersonalProvisioningAuthority');
  const downloadIndex = operator.indexOf('Invoke-WebRequest -Uri $ManagerDebUrl');
  assert.ok(ensureIndex >= 0 && downloadIndex > ensureIndex,
    'Compose publication and runtime validation must precede manager download/install');
  assert.doesNotMatch(operator, /\.wslconfig|netsh|Set-NetFirewall|New-NetFirewall|portproxy/i);
});

test('sealed manager delivery validates and packages the shared provisioning authority', () => {
  const manager = text(MANAGER_WORKFLOW);
  assert.match(manager, /facebook-personal-provisioning-authority\.test\.js/);
  assert.match(manager, /facebook-personal-wsl-manager\.test\.js/);
  assert.match(manager, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(manager, /WINDOWS_POWERSHELL_5_1_MANAGER_PARSE_GREEN/);
  assert.match(manager, /yance-facebook-personal-wsl-manager/);
});
