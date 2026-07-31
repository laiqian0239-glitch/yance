'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, DOMAINS } = require('../../tools/audit/generate-full-product-inventory');

test('full product inventory scans all twelve audit domains and preserves evidence semantics', () => {
  const inventory = collect();
  assert.equal(DOMAINS.length, 12);
  assert.equal(Object.keys(inventory.domains).length, 12);
  assert.ok(inventory.summary.sourceFilesScanned > 500);
  assert.ok(inventory.summary.assets > 200);
  assert.ok(inventory.summary.frontendWorkspaces >= 5);
  assert.ok(inventory.summary.apiRoutes > 50);
  assert.ok(inventory.summary.testFiles > 100);
  assert.equal(inventory.completionSemantics.sourceEvidence, '仅证明源码资产存在');
  assert.equal(inventory.assets.every(row => row.sourceEvidence === true && row.windowsEvidence === false), true);
});
