'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function readOrEmpty(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function allProductSource() {
  const dir = path.join(ROOT, 'integration/element-module/src/product-experience');
  if (!fs.existsSync(dir)) return '';
  const out = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|tsx|css)$/u.test(entry.name)) continue;
    const parent = entry.parentPath || entry.path || dir;
    out.push(fs.readFileSync(path.join(parent, entry.name), 'utf8'));
  }
  return out.join('\n');
}

test('Action Dock exposes Chinese relationship tools while preserving exact action kinds', () => {
  const accessory = readOrEmpty('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
  for (const label of ['照片', '语音', '实时陪伴', '附件']) {
    assert.match(accessory, new RegExp(label, 'u'));
  }
  for (const kind of ['photo', 'voice', 'live', 'attachment']) {
    assert.match(accessory, new RegExp(`kind:\\s*["']${kind}["']`, 'u'));
  }
  assert.match(accessory, /Popover/u);
  assert.match(accessory, /roomId/u);
});

test('Action Dock is mounted around the existing Element composer rather than replacing it', () => {
  const index = readOrEmpty('integration/element-module/src/index.tsx');
  assert.match(index, /registerComposerPreview/u);
  assert.match(index, /originalComponent|OriginalComponent/u);
  assert.doesNotMatch(index, /createMessageComposer|replaceComposer|new\s+Composer/u);
});

test('Overlay lifecycle preserves focus without reading private Element timeline or composer state', () => {
  const session = readOrEmpty('integration/element-module/src/product-experience/experienceSession.ts');
  const source = allProductSource();
  assert.match(session, /document\.activeElement/u);
  assert.match(session, /\.focus\s*\(/u);
  assert.doesNotMatch(source, /querySelector\s*\([^)]*(?:timeline|composer)|mx_RoomView|mx_MessageComposer|timelineScrollTop/u);
  assert.doesNotMatch(session, /messages|messageStore|composerDraft|sendQueue|outbox/iu);
});

test('Rive companion implements the approved seven-state living AI vocabulary', () => {
  const rive = readOrEmpty('integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx');
  assert.match(rive, /@rive-app\/react-canvas/u);
  for (const state of ['idle', 'wake', 'listening', 'thinking', 'ready', 'speaking', 'error']) {
    assert.match(rive, new RegExp(`\\b${state}\\b`, 'u'));
  }
});

test('Howler sound policy has exact modes and no thinking sound event', () => {
  const sound = readOrEmpty('integration/element-module/src/product-experience/experienceSound.ts');
  assert.match(sound, /Howl/u);
  for (const mode of ['Off', 'Essential only', 'Immersive']) assert.match(sound, new RegExp(mode, 'u'));
  assert.doesNotMatch(sound, /thinking[^\\n]*(?:sound|play)|play[^\\n]*thinking/iu);
  assert.doesNotMatch(sound, /\bhover\b[^\\n]*(?:sound|play)|play[^\\n]*hover/iu);
});
