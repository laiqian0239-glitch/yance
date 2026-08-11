'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-provisioning-authority.ps1');
const OPERATOR = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-manager-wsl.ps1');
const RUNTIME = path.join(ROOT, 'tools', 'multibridge-lab', 'r12-runtime-repair-readiness.ps1');
const MANAGER_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-facebook-wsl-manager.yml');
const NATIVE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-native-process.yml');

function text(file) {
  assert.ok(fs.existsSync(file), `missing required file: ${file}`);
  return fs.readFileSync(file, 'utf8');
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

test('Task E closes the host provisioning false-green before LAB_RUNTIME_READY', () => {
  const runtime = text(RUNTIME);
  assert.match(runtime, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(runtime, /Ensure-FacebookPersonalProvisioningAuthority/);
  const ensureIndex = runtime.indexOf('Ensure-FacebookPersonalProvisioningAuthority');
  const readyIndex = runtime.indexOf("Write-Host 'LAB_RUNTIME_READY'");
  assert.ok(ensureIndex >= 0 && readyIndex > ensureIndex,
    'provisioning Compose authority must be GREEN before LAB_RUNTIME_READY');
});

test('WSL operator reuses the same Compose authority before downloading the manager deb', () => {
  const operator = text(OPERATOR);
  assert.match(operator, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(operator, /Ensure-FacebookPersonalProvisioningAuthority/);
  assert.match(operator, /\.InternalPort/);
  const ensureIndex = operator.indexOf('Ensure-FacebookPersonalProvisioningAuthority');
  const downloadIndex = operator.indexOf('Invoke-WebRequest -Uri $ManagerDebUrl');
  assert.ok(ensureIndex >= 0 && downloadIndex > ensureIndex,
    'Compose publication and runtime validation must precede manager download/install');
});

test('both sealed delivery workflows include and validate the shared provisioning authority', () => {
  const manager = text(MANAGER_WORKFLOW);
  const native = text(NATIVE_WORKFLOW);
  assert.match(manager, /facebook-personal-provisioning-authority\.test\.js/);
  assert.match(manager, /facebook-personal-provisioning-authority\.ps1/);
  assert.match(native, /facebook-personal-provisioning-authority\.ps1/);
});
