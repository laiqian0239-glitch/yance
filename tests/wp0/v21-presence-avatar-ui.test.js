'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const workspacePath = path.join(ROOT, 'integration/element-module/src/PresenceWorkspace.tsx');
const liveKitPath = path.join(ROOT, 'integration/element-module/src/presenceLiveKit.ts');
const productSentinelPath = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');

function read(repositoryPath) {
  return fs.readFileSync(path.join(ROOT, repositoryPath), 'utf8');
}

test('Presence stays reachable through Product relationship tools backed by real desktop session and LiveKit actions', () => {
  assert.equal(fs.existsSync(workspacePath), true, 'PresenceWorkspace.tsx must exist');
  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  if (fs.existsSync(productSentinelPath)) {
    const composer = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
    const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
    assert.match(yance, /ProductExperienceShell/u, 'YanceWorkspace must remain the thin Product composition root');
    assert.match(composer, /label: "实时陪伴"/u);
    assert.match(composer, /实时空间/u, 'Live action must expose the existing Presence/Avatar authority through Product language');
    assert.doesNotMatch(composer, /LiveKit|CyberVerse/u, 'normal Product chrome must not expose Presence provider inventory');
    assert.match(overlay, /import \{ PresenceWorkspace \} from "\.\.\/PresenceWorkspace"/u);
    assert.match(overlay, /overlay === "live"/u, 'Product relationship Live action must route to PresenceWorkspace');
  } else {
    assert.match(yance, /Presence/u);
  }

  assert.match(workspace, /createPresenceSession|closePresenceSession|connectPresenceLiveKit|disconnectPresenceLiveKit/iu);
  assert.match(workspace, /degraded|unavailable|disconnected/iu, 'service failure must be visible');
});

test('renderer media transport uses official livekit-client and contains no custom WebRTC transport', () => {
  assert.equal(fs.existsSync(liveKitPath), true, 'presenceLiveKit.ts must exist');
  const source = fs.readFileSync(liveKitPath, 'utf8');
  assert.match(source, /from\s+['"]livekit-client['"]/u);
  assert.match(source, /Room|RoomEvent/u);
  assert.doesNotMatch(source, /new\s+RTCPeerConnection|createOffer\(|setLocalDescription\(|new\s+WebSocket\(/u, 'official LiveKit client must remain the renderer transport authority');
  assert.doesNotMatch(source, /apiSecret|apiKey|SignJWT|jsonwebtoken|jose/iu, 'renderer must never hold LiveKit signing authority');
});

test('desktop preload and IPC manifest expose only sanitized Presence session/audio operations', () => {
  const preload = read('electron/preload.js');
  const manifest = JSON.parse(read('electron/m2/ipcManifest.json'));
  const manifestText = JSON.stringify(manifest);

  for (const token of ['getPresenceHealth', 'createPresenceSession', 'closePresenceSession', 'pushPresenceVoiceAudioChunk']) {
    assert.match(preload, new RegExp(token, 'u'), `${token} must be exposed by preload`);
  }
  assert.match(manifestText, /presence-avatar/u, 'Presence IPC channels must be declared in the manifest');
  assert.doesNotMatch(preload, /livekitApiSecret|livekitApiKey|signLiveKit|mintLiveKit/iu, 'preload must not expose token-signing secrets');
});

test('Presence normal-user controls are Chinese-first', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const label of ['连接', '断开', '麦克风', '摄像头', '形象']) {
    assert.match(workspace, new RegExp(label, 'u'), `Presence missing Chinese-first label: ${label}`);
  }
});
