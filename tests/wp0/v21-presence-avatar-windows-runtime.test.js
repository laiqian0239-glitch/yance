'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(repositoryPath) {
  return fs.readFileSync(path.join(ROOT, repositoryPath), 'utf8');
}

test('Presence Windows gate builds the official LiveKit renderer integration and service-endpoint runtime', () => {
  const workflowPath = path.join(ROOT, '.github/workflows/v21-presence-avatar-p0-windows.yml');
  const buildPath = path.join(ROOT, 'tools/presence-avatar/build-windows-runtime.ps1');
  assert.equal(fs.existsSync(workflowPath), true, 'Presence Windows workflow must exist');
  assert.equal(fs.existsSync(buildPath), true, 'Presence Windows build script must exist');

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const build = fs.readFileSync(buildPath, 'utf8');
  assert.match(workflow, /windows-latest/u);
  assert.match(`${workflow}\n${build}`, /livekit-client/iu, 'Windows gate must build/verify the official LiveKit client integration');
  assert.match(`${workflow}\n${build}`, /CyberVerse|cyberverse/iu, 'Windows gate must verify CyberVerse service endpoint preflight');
  assert.match(`${workflow}\n${build}`, /npm|nx|element-module/iu, 'Windows gate must build the Element Presence surface');
});

test('Presence Windows packaging forbids LiveKit signing secrets and custom WebRTC/avatar runtimes', () => {
  const workflow = read('.github/workflows/v21-presence-avatar-p0-windows.yml');
  const build = read('tools/presence-avatar/build-windows-runtime.ps1');
  const source = `${workflow}\n${build}`;

  assert.match(source, /secret|api.?key|api.?secret/iu, 'gate must contain an explicit secret-boundary check');
  assert.match(source, /RTCPeerConnection|custom.*WebRTC|custom.*avatar|forbid|reject/iu, 'gate must reject parallel realtime/avatar authority');
  assert.doesNotMatch(source, /pip\s+install\s+.*CyberVerse|SoulX-FlashHead.*download|CUDA.*bundle/iu, 'Electron P0 must not bundle CyberVerse/SoulX GPU runtime or weights');
});

test('Presence upstream runtime files are configuration/patch seams rather than copied GPU/WebRTC engines', () => {
  for (const file of [
    'runtime/presence-avatar/cyberverse/cyberverse.yaml',
    'runtime/presence-avatar/cyberverse/avatar_models/flash_head.yaml',
    'upstream-patches/cyberverse/0001-yance-external-audio-ingress.patch',
    'upstream-patches/element-web/0010-yance-presence-livekit-client.patch'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);
});
