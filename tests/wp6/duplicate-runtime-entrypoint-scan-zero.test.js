'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inventoryRuntimeEntrypoints } = require('../../tools/wp6/entrypoint-inventory');

test('production runtime composition and API v2 control entrypoints are unique', () => {
  const report = inventoryRuntimeEntrypoints();
  assert.equal(report.status, 'PASS', JSON.stringify(report.duplicates, null, 2));
  assert.equal(report.duplicateExecutableEntrypointCount, 0);
  assert.equal(report.allowedProductionCompositionRoot, 'backend/runtime/AppRuntimeComposition.js');
});
