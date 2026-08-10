'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PRODUCT_DIR = path.join(ROOT, 'integration/element-module/src/product-experience');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readOrEmpty(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function productSource() {
  if (!fs.existsSync(PRODUCT_DIR)) return '';
  return fs.readdirSync(PRODUCT_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|css)$/u.test(entry.name))
    .map((entry) => {
      const parent = entry.parentPath || entry.path || PRODUCT_DIR;
      return fs.readFileSync(path.join(parent, entry.name), 'utf8');
    })
    .join('\n');
}

test('Living Relationship shell exists and replaces the flat capability dashboard normal path', () => {
  for (const rel of [
    'integration/element-module/src/product-experience/ProductExperienceShell.tsx',
    'integration/element-module/src/product-experience/PeopleSurface.tsx',
    'integration/element-module/src/product-experience/RelationshipWorld.tsx',
    'integration/element-module/src/product-experience/RelationshipAssistant.tsx',
    'integration/element-module/src/product-experience/ProductComposerAccessory.tsx',
    'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx',
    'integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx',
    'integration/element-module/src/product-experience/ProductExperienceShell.css'
  ]) assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `${rel} must exist`);

  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(yance, /ProductExperienceShell/u);
  assert.doesNotMatch(yance, /const\s+CAPABILITIES\s*=|yance\.workspace\.active-capability/u);
  assert.doesNotMatch(yance, /["']AI["']\s*,\s*["']Goal["']\s*,\s*["']Contact["']/u);
});

test('Element public module APIs remain the Product Shell integration boundary', () => {
  const index = read('integration/element-module/src/index.tsx');
  assert.match(index, /registerGlobalRightPanel/u);
  assert.match(index, /registerComposerPreview/u);
  assert.doesNotMatch(index, /mx_MessageComposer|mx_RoomView|RightPanelStore|dispatcher\/actions/u);
});

test('Product composition does not introduce forbidden Yance infrastructure authorities', () => {
  const source = productSource();
  for (const forbidden of [
    'YanceComponentFramework',
    'YanceAnimationEngine',
    'YanceGameUIRuntime',
    'YanceSoundEngine',
    'YanceConversationEngine',
    'YanceOverlayFramework',
    'YanceSocialGraphEngine'
  ]) assert.doesNotMatch(source, new RegExp(forbidden, 'u'));
});

test('Product Shell keeps mature domain workspaces as child authorities', () => {
  const overlay = readOrEmpty('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  assert.match(overlay, /MediaWorkspace/u);
  assert.match(overlay, /PresenceWorkspace/u);
  assert.doesNotMatch(overlay, /ComfyUI|ImmichClient|new\s+Room\s*\(|LiveKitClient|CosyVoice|SenseVoice/u);
});
