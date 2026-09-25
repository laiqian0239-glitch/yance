'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const VOICE = path.join(ROOT, 'integration/element-module/src/VoiceWorkspace.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/VoiceWorkspace.css');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('M02 Conversation Voice exposes the approved compact state flow', () => {
  const source = read(VOICE);
  for (const marker of ['选择我的声音', '生成中', '试听 / 可发送', '重新生成', '真实会话发送']) {
    assert.match(source, new RegExp(marker, 'u'), `missing M02 marker: ${marker}`);
  }
  assert.match(source, /yance-voice-workspace--m02/u);
  assert.match(source, /routeBinding\?\.status\s*===\s*"resolved"/u);
});

test('M02 keeps generation and send on the mature Voice Brain and route-bound media send seam', () => {
  const source = read(VOICE);
  assert.match(source, /generateVoiceSpeech/u);
  assert.match(source, /sendVoiceArtifact/u);
  assert.match(source, /resolvedRoute\?\.platform/u);
  assert.match(source, /resolvedRoute\?\.accountId/u);
  assert.match(source, /resolvedRoute\?\.chatJid/u);
  assert.doesNotMatch(source, /sendMessage|sendEvent|voiceOutbox|createVoiceSendQueue/u);
});

test('M02 Product-bound mini-flow does not expose manual account routing or create a second composer', () => {
  const source = read(VOICE);
  assert.match(source, /managementOnly/u);
  assert.match(source, /standaloneMode/u);
  assert.match(source, /当前文字/u);
  assert.match(source, /当前关系会话/u);
  assert.doesNotMatch(source, /setTimeout\(|setInterval\(/u);
});

test('M02 CSS renders a compact bottom Voice surface with responsive fallback', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-voice-workspace--m02/u);
  assert.match(css, /\.yance-voice-mini-flow/u);
  assert.match(css, /data-voice-phase/u);
  assert.match(css, /@media\s*\(max-width:/u);
});
