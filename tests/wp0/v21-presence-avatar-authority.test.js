'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const descriptorPath = path.join(ROOT, 'config/upstreams/v21-presence-avatar-p0.json');

function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, repositoryPath), 'utf8'));
}

test('Presence P0 pins LiveKit, CyberVerse and SoulX as the only realtime/avatar authorities', () => {
  assert.equal(fs.existsSync(descriptorPath), true, 'Presence upstream descriptor must exist');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));

  assert.equal(descriptor.workPackage, 'V21-PRESENCE-AVATAR-P0-V1-V3');
  assert.deepEqual(descriptor.authority, {
    realtimeTransport: 'livekit',
    rendererClient: 'livekit-client',
    avatarRuntime: 'cyberverse',
    talkingHeadModel: 'soulx-flashhead'
  });

  assert.equal(descriptor.upstreams?.liveKitServer?.version, 'v1.13.5');
  assert.equal(descriptor.upstreams?.liveKitServer?.commit, '3b9f118327b257301083a7c4aa46076c8012918a');
  assert.equal(descriptor.upstreams?.liveKitServer?.license, 'Apache-2.0');
  assert.equal(descriptor.upstreams?.liveKitClient?.package, 'livekit-client@2.21.0');
  assert.equal(descriptor.upstreams?.liveKitClient?.commit, '15ca5f8180ab8939c3a5a4dfee1d5e44f62f71cf');
  assert.equal(descriptor.upstreams?.cyberVerse?.commit, '459abae601411d191a1f4c99fe55b60d59e59305');
  assert.equal(descriptor.upstreams?.cyberVerse?.license, 'GPL-3.0');
  assert.equal(descriptor.upstreams?.soulXFlashHead?.commit, '9bc03de06bb0de82cd6bc477804512ae06144bf2');
  assert.equal(descriptor.upstreams?.soulXFlashHead?.license, 'Apache-2.0');

  for (const flag of [
    'yanceWebRtcServerForbidden',
    'yanceTokenServerForbidden',
    'yanceAvatarRuntimeForbidden',
    'yanceLipSyncEngineForbidden',
    'yanceDigitalHumanStateMachineForbidden',
    'yanceRealtimePresenceFrameworkForbidden',
    'yanceAudioProcessingEngineForbidden'
  ]) assert.equal(descriptor.boundaries?.[flag], true, `${flag} must remain forbidden`);
});

test('Presence P0 authorizes exactly livekit-client 2.21.0 in the Element renderer manifest', () => {
  const manifest = readJson('integration/element-module/package.json');
  assert.equal(manifest.dependencies?.['livekit-client'], '2.21.0');
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.devDependencies || {}, 'livekit-client'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.peerDependencies || {}, 'livekit-client'), false);
});

test('Presence P0 carries the reviewed upstream license notices instead of copying runtime authority into Yance', () => {
  for (const file of [
    'third_party/licenses/livekit-Apache-2.0.txt',
    'third_party/licenses/livekit-client-Apache-2.0.txt',
    'third_party/licenses/cyberverse-GPL-3.0.txt',
    'third_party/licenses/soulx-flashhead-Apache-2.0.txt'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);
});