'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { auditRuntimeAuthority } = require('../../tools/wp3/runtime-authority-audit');

test('production has one AppRuntime construction path and no legacy CoreRuntime or LifecycleManager construction path', () => {
  const result = auditRuntimeAuthority(path.resolve(__dirname, '../..'));
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.findings, []);
  assert.equal(result.appRuntimeConstructionPaths, 1);
  assert.equal(result.lifecycleConstructionPaths, 1);
  assert.equal(result.legacyCoreRuntimeConstructionPaths, 0);
  assert.equal(result.legacyLifecycleManagerConstructionPaths, 0);
});
