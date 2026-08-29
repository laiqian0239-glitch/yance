'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

test('Electron runtime icons come only from canonical Yance branding authority', () => {
  const main = read('electron/main.js');
  assert.doesNotMatch(main, /frontend[\\/]',\s*'assets[\\/]'|frontend\/assets\/icon\.(?:ico|png)/u);
  assert.match(main, /assets[\\/]',\s*'branding[\\/]',\s*'yance/u);
  assert.match(main, /Yance\.ico/u);
  assert.match(main, /yance-app-icon-(?:64|128|256|512|1024)\.png/u);
});

test('canonical production brand authority is deep purple and white, not retired teal', () => {
  const tokens = read('assets/branding/yance/branding-tokens.json');
  const master = read('assets/branding/yance/source/yance-mark-master.svg');
  const flat = read('assets/branding/yance/product/yance-mark-flat.svg');
  const micro = read('assets/branding/yance/product/yance-mark-micro.svg');
  const productionAuthority = `${tokens}\n${master}\n${flat}\n${micro}`;

  assert.match(tokens, /#2A0F4A/iu);
  assert.match(tokens, /#FFFFFF/iu);
  assert.doesNotMatch(productionAuthority, /#(?:17BDB5|3DD9D0|0F2E31)/iu);
});

test('Yance registers the pinned Element login component seam without a second auth protocol', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  assert.equal(exists('integration/element-module/src/YanceLogin.tsx'), true);
  assert.equal(exists('integration/element-module/src/YanceLogin.css'), true);
  assert.match(moduleIndex, /registerLoginComponent\s*\(/u);
  assert.match(moduleIndex, /YanceLogin/u);
});

test('product workspace mounts a visible brand preview surface', () => {
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(exists('integration/element-module/src/BrandPreviewSurface.tsx'), true);
  assert.equal(exists('integration/element-module/src/BrandPreviewSurface.css'), true);
  assert.match(workspace, /BrandPreviewSurface/u);
});
