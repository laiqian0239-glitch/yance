'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PRESENCE = path.join(ROOT, 'integration/element-module/src/PresenceWorkspace.tsx');
const LIVEKIT = path.join(ROOT, 'integration/element-module/src/presenceLiveKit.ts');
const OVERLAY = path.join(ROOT, 'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/PresenceWorkspace.css');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('M01 Live overlay exposes the five approved interaction states from mature runtime state', () => {
  const source = read(PRESENCE);
  for (const label of ['准备开始', '连接中', 'Live 中', '断线恢复', '已结束']) {
    assert.match(source, new RegExp(label, 'u'), `missing M01 state label: ${label}`);
  }
  for (const state of ['connecting', 'connected', 'reconnecting', 'disconnected']) {
    assert.match(source, new RegExp(`liveKit\\.state[^\\n]*${state}|${state}[^\\n]*liveKit\\.state`, 'u'), `missing mature LiveKit state projection: ${state}`);
  }
});

test('M01 stays on CyberVerse session plus official LiveKit lifecycle and does not create a shadow realtime owner', () => {
  const source = read(PRESENCE);
  const livekit = read(LIVEKIT);
  assert.match(source, /createPresenceSession/u);
  assert.match(source, /closePresenceSession/u);
  assert.match(source, /connectPresenceLiveKit/u);
  assert.match(source, /disconnectPresenceLiveKit/u);
  assert.match(livekit, /from "livekit-client"/u);
  assert.doesNotMatch(source, /RTCPeerConnection|new WebSocket|setTimeout\(|setInterval\(/u);
});

test('M01 remains a route-bound relationship overlay and closing it does not own timeline or composer state', () => {
  const overlay = read(OVERLAY);
  const source = read(PRESENCE);
  assert.match(overlay, /overlay === "live"[^\n]*<PresenceWorkspace routeBinding=\{relationshipToolRoute\}/u);
  assert.match(source, /routeBinding\.status !== "resolved"/u);
  assert.doesNotMatch(source, /timeline|composer|draft|setActiveMatrixRoomId|clearSelectedRelationship/u);
});

test('M01 CSS materializes the approved centered Live state surface responsively', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-presence-workspace--m01/u);
  assert.match(css, /\.presence-live-state/u);
  assert.match(css, /data-live-phase/u);
  assert.match(css, /@media\s*\(max-width:/u);
});
