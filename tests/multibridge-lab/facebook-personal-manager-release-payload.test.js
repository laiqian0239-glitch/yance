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

test('Facebook Personal manager path validates the exact official release payload on real Windows before delivery', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  assert.match(workflow, /Validate official mautrix-manager release payload for Facebook Personal/);
  assert.match(workflow, new RegExp(RELEASE_NUPKG.replaceAll('.', '\\.')));
  assert.match(workflow, new RegExp(RELEASE_ASSET_ID));
  assert.match(workflow, new RegExp(RELEASE_SHA256));
  assert.match(workflow, new RegExp(RELEASE_COMMIT));
  assert.match(workflow, /\$assetId\s*=\s*'495351157'/);
  assert.match(workflow, /releases\/assets\/\$assetId/);
  assert.match(workflow, /application\/octet-stream/);
  assert.match(workflow, /Get-FileHash[\s\S]*SHA256/);
  assert.match(workflow, /Expand-Archive/);
  assert.match(workflow, /lib[\\/]net45[\\/]mautrix-manager\.exe/);
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /Status[\s\S]*Valid/);
  assert.match(workflow, /MAUTRIX_MANAGER_INTERNAL_AUTHENTICODE_GREEN/);
  assert.match(workflow, /Start-Process/);
  assert.match(workflow, /MAUTRIX_MANAGER_RELEASE_PAYLOAD_SMOKE_GREEN/);

  // A validated payload path must not hand the unsigned Squirrel installer or
  // the vulnerable Forge/npm source-launch chain to the user.
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

  // The WSL candidate must be a prebuilt upstream release payload. It must not
  // rebuild the app or execute the retired vulnerable Forge/npm source chain.
  const linuxJobStart = workflow.indexOf('manager-linux-release:');
  assert.notEqual(linuxJobStart, -1);
  const linuxJob = workflow.slice(linuxJobStart);
  assert.doesNotMatch(linuxJob, /npm\s+(?:ci|install|start)/);
  assert.doesNotMatch(linuxJob, /electron-forge/);
});
