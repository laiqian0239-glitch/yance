'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-native-process.yml');

const RELEASE_NUPKG = 'mautrix_manager-0.2.1-full.nupkg';
const RELEASE_ASSET_ID = '495351157';
const RELEASE_SHA256 = '0ab5a822f7c1ceb830811972fb98d9849cf17080c54f2d8d6583b0b9802721ed';
const RELEASE_COMMIT = 'd2c08e60c7a877602bc6da2961daf2daffcff79b';
const LINUX_RELEASE_ZIP = 'mautrix-manager-linux-x64-0.2.1.zip';
const LINUX_RELEASE_ASSET_ID = '495350343';
const LINUX_RELEASE_SHA256 = '8a55dc5022c5d52d13c58e05c72ad2d0bfff3fa9dac19d96e5eb84608f282479';
const LINUX_DEB = 'mautrix-manager_0.2.1_amd64.deb';
const LINUX_DEB_ASSET_ID = '495350342';
const LINUX_DEB_SHA256 = '94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd';

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Facebook Personal Windows manager release path stays frozen as the exact upstream unsigned RED', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const windowsGate = between(
    workflow,
    '- name: Guard retired unsigned mautrix-manager Windows release payload',
    '- name: Stage exact GREEN exit11 evidence package'
  );

  assert.match(windowsGate, new RegExp(RELEASE_NUPKG.replaceAll('.', '\\.')));
  assert.match(windowsGate, new RegExp(RELEASE_ASSET_ID));
  assert.match(windowsGate, new RegExp(RELEASE_SHA256));
  assert.match(windowsGate, new RegExp(RELEASE_COMMIT));
  assert.match(windowsGate, /releases\/assets\/\$assetId/);
  assert.match(windowsGate, /application\/octet-stream/);
  assert.match(windowsGate, /Get-FileHash[\s\S]*SHA256/);
  assert.match(windowsGate, /Expand-Archive/);
  assert.match(windowsGate, /lib[\\/]net45[\\/]mautrix-manager\.exe/);
  assert.match(windowsGate, /Get-AuthenticodeSignature/);
  assert.match(windowsGate, /NotSigned/);
  assert.match(windowsGate, /MAUTRIX_MANAGER_WINDOWS_RELEASE_RETIRED_UNSIGNED_RED/);
  assert.doesNotMatch(windowsGate, /Start-Process/);
  assert.doesNotMatch(workflow, /yance-facebook-personal-manager-source-launch/);
  assert.match(workflow, /MAUTRIX_MANAGER_SOURCE_LAUNCH_RETIRED_SECURITY_RED/);
});

test('official Linux ZIP path is frozen as a sandbox-packaging RED and never bypasses Chromium sandboxing', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const zipJob = between(workflow, 'manager-linux-release:', 'manager-linux-deb:');

  assert.match(zipJob, new RegExp(RELEASE_COMMIT));
  assert.match(zipJob, new RegExp(LINUX_RELEASE_ZIP.replaceAll('.', '\\.')));
  assert.match(zipJob, new RegExp(LINUX_RELEASE_ASSET_ID));
  assert.match(zipJob, new RegExp(LINUX_RELEASE_SHA256));
  assert.match(zipJob, /chrome-sandbox/);
  assert.match(zipJob, /mode=755|mode.*755/);
  assert.match(zipJob, /MAUTRIX_MANAGER_LINUX_ZIP_RETIRED_SANDBOX_RED/);
  assert.doesNotMatch(zipJob, /xvfb-run/);
  assert.doesNotMatch(zipJob, /--no-sandbox/);
  assert.doesNotMatch(zipJob, /--disable-setuid-sandbox/);
  assert.doesNotMatch(zipJob, /chmod\s+4755|chown\s+root/);
});

test('Facebook Personal manager validates the exact official amd64 deb through native package-manager semantics', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const debJob = workflow.slice(workflow.indexOf('manager-linux-deb:'));

  assert.match(debJob, /manager-linux-deb:/);
  assert.match(debJob, /runs-on:\s*ubuntu-latest/);
  assert.match(debJob, /Validate official mautrix-manager amd64 deb payload/);
  assert.match(debJob, new RegExp(RELEASE_COMMIT));
  assert.match(debJob, new RegExp(LINUX_DEB.replaceAll('.', '\\.')));
  assert.match(debJob, new RegExp(LINUX_DEB_ASSET_ID));
  assert.match(debJob, new RegExp(LINUX_DEB_SHA256));
  assert.match(debJob, /application\/octet-stream/);
  assert.match(debJob, /sha256sum/);
  assert.match(debJob, /dpkg-deb\s+(?:--info|-I)/);
  assert.match(debJob, /dpkg-deb\s+(?:--contents|-c)/);
  assert.match(debJob, /apt-get\s+install/);
  assert.match(debJob, /dpkg\s+-L/);
  assert.match(debJob, /chrome-sandbox/);
  assert.match(debJob, /stat\s+-c/);
  assert.match(debJob, /owner=root/);
  assert.match(debJob, /mode=4755/);
  assert.match(debJob, /ldd/);
  assert.match(debJob, /xvfb-run/);
  assert.match(debJob, /timeout/);
  assert.match(debJob, /MAUTRIX_MANAGER_LINUX_DEB_SANDBOX_GREEN/);
  assert.match(debJob, /MAUTRIX_MANAGER_LINUX_DEB_PAYLOAD_SMOKE_GREEN/);

  // Mature upstream/package-manager path only: no source rebuild or sandbox bypass.
  assert.doesNotMatch(debJob, /npm\s+(?:ci|install|start)/);
  assert.doesNotMatch(debJob, /electron-forge/);
  assert.doesNotMatch(debJob, /--no-sandbox/);
  assert.doesNotMatch(debJob, /--disable-setuid-sandbox/);
  assert.doesNotMatch(debJob, /chmod\s+4755|chown\s+root/);
});
