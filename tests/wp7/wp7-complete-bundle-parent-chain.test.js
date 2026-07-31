'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAncestor, ACCEPTED_BINDING_COMMIT, gitIdentity } = require('../../tools/wp7/lib');
const { isFinalExecution, load } = require('./final-phase-helpers');

test('wp7-complete-bundle-parent-chain.test', () => {
  if (isFinalExecution()) {
    const closure = load('evidence/wp7/full-source-delivery-closure.json');
    assert.equal(closure.bundleAncestryIncludesWp6AcceptedHead, true);
    assert.match(closure.bundleSha256, /^[0-9a-f]{64}$/);
    assert.equal(closure.wp0ImmutableTagIncluded, true);
    return;
  }
  assert.equal(isAncestor(ACCEPTED_BINDING_COMMIT, gitIdentity().sourceCommit), true);
});
