'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyYanceAssets, REQUIRED_SIZES, REQUIRED_ICO_SIZES } = require('../../scripts/branding/verify-yance-assets');

test('Yance vector, PNG, ICO, runtime copies and asset manifest are consistent', () => {
  const result = verifyYanceAssets();
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.pngs.map(row => row.size), REQUIRED_SIZES);
  const icoSizes = new Set(result.icoEntries.map(row => row.width));
  for (const size of REQUIRED_ICO_SIZES) assert.ok(icoSizes.has(size), `missing ${size}px ICO entry`);
  assert.equal(result.bundledFontFiles, 0);
});
