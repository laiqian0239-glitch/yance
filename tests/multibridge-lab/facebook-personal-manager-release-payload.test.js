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

test('Facebook Personal manager path validates the exact official release payload on real Windows before delivery', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  assert.match(workflow, /Validate official mautrix-manager release payload for Facebook Personal/);
  assert.match(workflow, new RegExp(RELEASE_NUPKG.replaceAll('.', '\\.')));
  assert.match(workflow, new RegExp(RELEASE_ASSET_ID));
  assert.match(workflow, new RegExp(RELEASE_SHA256));
  assert.match(workflow, new RegExp(RELEASE_COMMIT));
  assert.match(workflow, /releases\/assets\/495351157/);
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
