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
  assert.doesNotMatch(windowsGate, /MAUTRIX_MANAGER_INTERNAL_AUTHENTICODE_GREEN/);
  assert.doesNotMatch(windowsGate, /MAUTRIX_MANAGER_RELEASE_PAYLOAD_SMOKE_GREEN/);
  assert.doesNotMatch(workflow, /Upload Facebook Personal manager source launcher/);
  assert.doesNotMatch(workflow, /yance-facebook-personal-manager-source-launch/);
  assert.match(workflow, /MAUTRIX_MANAGER_SOURCE_LAUNCH_RETIRED_SECURITY_RED/);
});

test('Facebook Personal manager has an exact official Linux x64 release gate for WSLg evaluation', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  assert.match(workflow, /manager-linux-release:/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /Validate official mautrix-manager Linux x64 release payload/);
  assert.match(workflow, new RegExp(RELEASE_COMMIT));
  assert.match(workflow, new RegExp(LINUX_RELEASE_ZIP.replaceAll('.', '\\.')));
  assert.match(workflow, new RegExp(LINUX_RELEASE_ASSET_ID));
  assert.match(workflow, new RegExp(LINUX_RELEASE_SHA256));
  assert.match(workflow, /application\/octet-stream/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /unzip/);
  assert.match(workflow, /file/);
  assert.match(workflow, /ELF 64-bit/);
  assert.match(workflow, /x86-64|x86_64/);
  assert.match(workflow, /xvfb-run/);
  assert.match(workflow, /timeout/);
  assert.match(workflow, /MAUTRIX_MANAGER_LINUX_RELEASE_PAYLOAD_SMOKE_GREEN/);

  const linuxJob = workflow.slice(workflow.indexOf('manager-linux-release:'));
  assert.doesNotMatch(linuxJob, /npm\s+(?:ci|install|start)/);
  assert.doesNotMatch(linuxJob, /electron-forge/);
});

test('Linux manager smoke failure emits bounded dependency and sandbox diagnostics before any workaround', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const linuxJob = workflow.slice(workflow.indexOf('manager-linux-release:'));

  assert.match(linuxJob, /ldd\s+"\$exe"/);
  assert.match(linuxJob, /not found/);
  assert.match(linuxJob, /chrome-sandbox/);
  assert.match(linuxJob, /stat\s+-c/);
  assert.match(linuxJob, /kernel\.apparmor_restrict_unprivileged_userns/);
  assert.match(linuxJob, /unshare\s+--user/);
  assert.match(linuxJob, /stdout\.txt/);
  assert.match(linuxJob, /stderr\.txt/);
  assert.match(linuxJob, /sed\s+-n\s+'1,80p'/);
  assert.match(linuxJob, /MAUTRIX_MANAGER_LINUX_SMOKE_DIAGNOSTICS/);

  // Diagnostics only: do not disable Electron/Chromium sandboxing to force GREEN.
  assert.doesNotMatch(linuxJob, /--no-sandbox/);
  assert.doesNotMatch(linuxJob, /--disable-setuid-sandbox/);
});
