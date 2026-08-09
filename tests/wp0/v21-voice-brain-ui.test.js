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

test('Voice is a visible modular Yance capability with enrollment, preview and send controls', () => {
  assert.equal(fs.existsSync(workspacePath), true, 'VoiceWorkspace.tsx must exist');
  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  assert.match(yance, /VoiceWorkspace/u, 'YanceWorkspace must compose the modular Voice workspace');
  assert.match(yance, /["']Voice["']/u, 'Voice must be a top-level capability');

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
