'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MEDIA = path.join(ROOT, 'integration/element-module/src/MediaWorkspace.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/MediaWorkspace.css');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('M03 Photo/Media exposes the five approved Conversation mini-flow states', () => {
  const source = read(MEDIA);
  for (const marker of ['素材选择', '预览已有素材', '根据对话生成', '生成后编辑', '真实会话发送']) {
    assert.match(source, new RegExp(marker, 'u'), `missing M03 marker: ${marker}`);
  }
  assert.match(source, /yance-media-workspace--m03/u);
  assert.match(source, /data-media-phase/u);
});

test('M03 reuses mature media-library, workflow, preview and route-bound send seams', () => {
  const source = read(MEDIA);
  for (const marker of ['searchMediaAssets', 'listMediaPeople', 'listMediaAlbums', 'getMediaAssetPreview', 'queueMediaWorkflow', 'getMediaWorkflowResult', 'saveMediaWorkflowOutput', 'sendMediaAsset']) {
    assert.match(source, new RegExp(marker, 'u'), `missing mature media seam: ${marker}`);
  }
  assert.match(source, /resolvedRoute\?\.platform/u);
  assert.match(source, /resolvedRoute\?\.accountId/u);
  assert.match(source, /resolvedRoute\?\.chatJid/u);
  assert.doesNotMatch(source, /sendMessage|sendEvent|mediaOutbox|createMediaSendQueue/u);
});

test('M03 route-bound mode hides provider settings and manual route identifiers', () => {
  const source = read(MEDIA);
  assert.match(source, /standaloneMode/u);
  assert.match(source, /managementOnly/u);
  assert.match(source, /当前关系会话/u);
  assert.match(source, /最近素材/u);
  assert.doesNotMatch(source, /setInterval\(|setTimeout\(/u);
});

test('M03 CSS materializes a compact media chooser/generator responsively', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-media-workspace--m03/u);
  assert.match(css, /\.yance-media-mini-flow/u);
  assert.match(css, /data-media-phase/u);
  assert.match(css, /@media\s*\(max-width:/u);
});
