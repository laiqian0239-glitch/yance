'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRuntimeTargetGate } = require('../../tools/wp0/lib');

test('wp7-wp0-real-build-branch-gate.test', () => {
  const result = checkRuntimeTargetGate();
  assert.equal(result.pass, true, JSON.stringify(result));
});

test('WP0 runtime gate rejects an arbitrary non-release branch', () => {
  const result = checkRuntimeTargetGate({ branch: 'feature/unreviewed-release', changedFiles: [] });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
});
