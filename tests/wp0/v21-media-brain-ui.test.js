'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const workspacePath = path.join(ROOT, 'integration/element-module/src/MediaWorkspace.tsx');
const productSentinelPath = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Media stays reachable through Product relationship tools with real runtime-backed actions', () => {
  assert.equal(fs.existsSync(workspacePath), true, 'MediaWorkspace.tsx must exist');
  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  if (fs.existsSync(productSentinelPath)) {
    const composer = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
    const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
    assert.match(yance, /ProductExperienceShell/u, 'YanceWorkspace must remain the thin Product composition root');
    assert.match(composer, /label: "发送照片"/u, 'final V4 Product action must expose real-media selection');
    assert.match(composer, /label: "生成 \/ 编辑图片"/u, 'final V4 Product action must expose the existing generate/edit path');
    assert.match(composer, /从真实素材库选择|生成、编辑后再选择/u, 'Photo actions must expose the existing Media Brain authority through Product language');
    assert.doesNotMatch(composer, /label: "附件"|kind: "attachment"|媒体与文件/u, 'generic attachment must remain on the real Element native uploader');
    assert.match(composer, /aria-label="丰富回复"/u, 'Product relationship tools must remain grouped as Conversation rich-reply capabilities');
    assert.doesNotMatch(composer, /Immich|ComfyUI/u, 'normal Product chrome must not expose Media provider inventory');
    assert.match(overlay, /import \{ MediaWorkspace \} from "\.\.\/MediaWorkspace"/u);
    assert.match(overlay, /overlay === "photo"/u, 'Product photo relationship tool must route to MediaWorkspace');
  } else {
    assert.match(yance, /Media/u);
  }

  assert.match(workspace, /health|searchAssets|listPeople|listAlbums|queueWorkflow|saveWorkflowOutputToImmich|send/iu);
  assert.match(workspace, /missing model|degraded|unavailable/iu, 'upstream missing/degraded state must be visible');
});

test('Desktop preload and IPC manifest expose the Media runtime without creating a second send authority', () => {
  const preload = read('electron/preload.js');
  const manifest = JSON.parse(read('electron/m2/ipcManifest.json'));
  const manifestText = JSON.stringify(manifest);

  for (const token of [
    'getMediaBrainHealth',
    'importMediaAsset',
    'searchMediaAssets',
    'listMediaPeople',
    'listMediaAlbums',
    'queueMediaWorkflow',
    'getMediaWorkflowResult',
    'saveMediaWorkflowOutput'
  ]) {
    assert.match(preload, new RegExp(token, 'u'), `${token} must be exposed by preload`);
    assert.match(manifestText, /media-brain/u, 'Media IPC channels must be declared in the manifest');
  }

  assert.doesNotMatch(preload, /createMediaSendQueue|MediaSendAuthority/u, 'existing send authority must be reused');
});

test('Media workspace CSS uses lint-clean currentcolor keyword casing', () => {
  const css = read('integration/element-module/src/MediaWorkspace.css');
  assert.match(css, /currentcolor/u, 'Media CSS must satisfy the Stylelint keyword casing');
  assert.doesNotMatch(css, /currentColor/u, 'mixed-case currentColor must not remain');
});

test('Media settings use a secret-preserving Media settings IPC', () => {
  const workspace = read('integration/element-module/src/MediaWorkspace.tsx');
  const preload = read('electron/preload.js');
  const manifest = JSON.parse(read('electron/m2/ipcManifest.json'));

  assert.match(workspace, /saveMediaBrainSettings/u, 'renderer must use a Media-specific settings projection');
  assert.doesNotMatch(workspace, /api\.saveCredential\(/u, 'renderer must not replace the whole Immich credential record');
  assert.match(preload, /saveMediaBrainSettings/u, 'preload must expose the Media-specific settings projection');
  assert.equal(manifest.handlers.some(handler => handler.channel === 'desktop:media-brain-save-settings'), true, 'IPC manifest must declare the Media settings handler');
});

test('Media Product-bound mode consumes the resolved relationship route and never falls back to copied internal identifiers', () => {
  const workspace = read('integration/element-module/src/MediaWorkspace.tsx');
  const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  assert.match(workspace, /RelationshipToolRouteBinding/u, 'Media must accept the shared Product route binding');
  assert.match(workspace, /routeBinding/u);
  assert.match(workspace, /routeBinding\?\.status\s*===\s*["']resolved["']/u, 'only a uniquely resolved Product route may enable Product-bound send');
  assert.match(workspace, /routeBinding\s*===\s*undefined/u, 'manual internal route controls may exist only in standalone mode');
  assert.match(overlay, /<MediaWorkspace\s+routeBinding=\{relationshipToolRoute\}/u, 'Product overlay must pass the resolved binding into Media');
  assert.doesNotMatch(overlay, /<MediaWorkspace\s*\/>/u, 'Product-bound Media must not silently fall back to standalone manual route mode');
});

test('Media normal-user controls are Chinese-first', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const label of ['导入', '搜索', '人物', '相册', '生成', '编辑', '预览', '保存', '发送']) {
    assert.match(workspace, new RegExp(label, 'u'), `Media missing Chinese-first label: ${label}`);
  }
});
