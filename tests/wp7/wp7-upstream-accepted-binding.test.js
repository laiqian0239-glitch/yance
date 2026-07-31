'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertActivationBinding, gitIdentity, ACCEPTED_BINDING_COMMIT, isAncestor } = require('../../tools/wp7/lib');

test('wp7-upstream-accepted-binding.test', () => {
  const identity = gitIdentity();
  const result = assertActivationBinding(undefined, { identity, requireClean: false });
  assert.equal(result.status, 'PASS');
  assert.equal(isAncestor(ACCEPTED_BINDING_COMMIT, identity.sourceCommit), true);
});

test('WP7 activation binding rejects an arbitrary non-release branch', () => {
  const identity = { ...gitIdentity(), branch: 'feature/unreviewed-release' };
  assert.throws(
    () => assertActivationBinding(undefined, { identity, requireClean: false }),
    error => error?.reasonCode === 'WP7_WP0_GATE_BRANCH_MISMATCH'
  );
});
