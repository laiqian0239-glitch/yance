'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const workspacePath = path.join(ROOT, 'integration/element-module/src/VoiceWorkspace.tsx');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Voice is a modular relationship capability composed only through the Product Experience overlay', () => {
  assert.equal(fs.existsSync(workspacePath), true, 'VoiceWorkspace.tsx must exist');
  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  assert.match(yance, /ProductExperienceShell/u, 'YanceWorkspace must retain ProductExperienceShell as top-level authority');
  assert.doesNotMatch(yance, /VoiceWorkspace/u, 'YanceWorkspace must not restore the legacy direct Voice composition');
  assert.match(
    overlay,
    /import\s+\{\s*VoiceWorkspace\s*\}\s+from\s+["']\.\.\/VoiceWorkspace["']/u,
    'RelationshipOverlayHost must import the modular Voice workspace'
  );
  assert.match(
    overlay,
    /overlay\s*===\s*["']voice["'][\s\S]*?<VoiceWorkspace\s+routeBinding=\{relationshipToolRoute\}/u,
    'the Product Experience voice seam must render VoiceWorkspace with the current relationship route binding'
  );
  assert.doesNotMatch(
    overlay,
    /Voice stays with the Voice Brain authority/u,
    'the Product shell placeholder must be replaced rather than retained beside VoiceWorkspace'
  );
  for (const token of ['Dialog.Root', 'closeRelationshipOverlay', 'activeMatrixRoomId']) {
    assert.match(overlay, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `${token} Product overlay semantics must remain`);
  }

  for (const label of [
    'Enroll',
    'Delete',
    'Test voice',
    'Language',
    'Generate',
    'Preview',
    'Regenerate',
    'Send'
  ]) assert.match(workspace, new RegExp(label, 'iu'), `${label} control must be visible`);

  assert.match(workspace, /local|private/iu, 'local/private voice profile status must be visible');
  assert.match(workspace, /degraded|unavailable|missing/iu, 'runtime/model failure state must be visible');
});

test('Desktop preload and IPC manifest expose Voice runtime operations', () => {
  const preload = read('electron/preload.js');
  const manifest = JSON.parse(read('electron/m2/ipcManifest.json'));
  const manifestText = JSON.stringify(manifest);

  for (const token of [
    'getVoiceBrainHealth',
    'transcribeVoiceAudio',
    'enrollVoiceProfile',
    'deleteVoiceProfile',
    'generateVoiceSpeech',
    'sendVoiceArtifact'
  ]) assert.match(preload, new RegExp(token, 'u'), `${token} must be exposed by preload`);

  for (const channel of [
    'desktop:voice-brain-health',
    'desktop:voice-brain-transcribe',
    'desktop:voice-brain-enroll-profile',
    'desktop:voice-brain-delete-profile',
    'desktop:voice-brain-generate-speech',
    'desktop:voice-brain-send-artifact'
  ]) assert.match(manifestText, new RegExp(channel, 'u'), `${channel} must be declared in the IPC manifest`);
});

test('Voice send remains a thin adapter over the existing send-media-stream authority', () => {
  const workspace = read('integration/element-module/src/VoiceWorkspace.tsx');
  const main = read('electron/main.js');

  assert.match(workspace, /sendVoiceArtifact/u);
  assert.match(main, /send-media-stream/u, 'Voice send must delegate to the existing unique media send authority');
  assert.doesNotMatch(
    `${workspace}\n${main}`,
    /VoiceSendAuthority|createVoiceSendQueue|voiceOutbox|voiceSendQueue/iu,
    'Voice must not create a second send authority or outbox'
  );
});

test('Voice workspace CSS exists as a dedicated modular capability surface', () => {
  const cssPath = path.join(ROOT, 'integration/element-module/src/VoiceWorkspace.css');
  assert.equal(fs.existsSync(cssPath), true, 'VoiceWorkspace.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /yance-voice-workspace/u);
});

test('Voice Product-bound mode consumes the resolved relationship route and never falls back to copied internal identifiers', () => {
  const workspace = read('integration/element-module/src/VoiceWorkspace.tsx');
  const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  assert.match(workspace, /RelationshipToolRouteBinding/u, 'Voice must accept the shared Product route binding');
  assert.match(workspace, /routeBinding/u);
  assert.match(workspace, /routeBinding\?\.status\s*===\s*["']resolved["']/u, 'only a uniquely resolved Product route may enable Product-bound send');
  assert.match(workspace, /routeBinding\s*===\s*undefined/u, 'manual internal route controls may exist only in standalone mode');
  assert.match(overlay, /<VoiceWorkspace\s+routeBinding=\{relationshipToolRoute\}/u, 'Product overlay must pass the resolved binding into Voice');
  assert.doesNotMatch(overlay, /<VoiceWorkspace\s*\/>/u, 'Product-bound Voice must not silently fall back to standalone manual route mode');
});

test('Voice normal-user controls are Chinese-first', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const label of ['录入声音', '删除', '测试声音', '语言', '生成', '预览', '重新生成', '发送']) {
    assert.match(workspace, new RegExp(label, 'u'), `Voice missing Chinese-first label: ${label}`);
  }
});
