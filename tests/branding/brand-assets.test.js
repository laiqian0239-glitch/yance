'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyYanceAssets, REQUIRED_SIZES, REQUIRED_ICO_SIZES } = require('../../scripts/branding/verify-yance-assets');

const ROOT = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Yance vector, PNG, ICO, runtime copies and asset manifest are consistent', () => {
  const result = verifyYanceAssets();
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.pngs.map(row => row.size), REQUIRED_SIZES);
  const icoSizes = new Set(result.icoEntries.map(row => row.width));
  for (const size of REQUIRED_ICO_SIZES) assert.ok(icoSizes.has(size), `missing ${size}px ICO entry`);
  assert.equal(result.bundledFontFiles, 0);
});

test('canonical Yance production palette is deep purple and white with retired teal absent', () => {
  const authority = [
    read('assets/branding/yance/branding-tokens.json'),
    read('assets/branding/yance/source/yance-mark-master.svg'),
    read('assets/branding/yance/product/yance-mark-flat.svg'),
    read('assets/branding/yance/product/yance-mark-micro.svg')
  ].join('\n');
  assert.match(authority, /#2A0F4A/iu);
  assert.match(authority, /#FFFFFF/iu);
  assert.doesNotMatch(authority, /#(?:17BDB5|3DD9D0|0F2E31)/iu);
});
