'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPECTED_SEAL_PATHS,
  readReceipt,
  validateReceipt,
  verifyLocalRepository
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m1-review');

const EXPECTED_SEAL_HEAD = '1e3d600f0647af35e737ff92a200c67e69224c82';

test('Milestone 1 receipt binds the immutable seal to its exact commit', () => {
  const receipt = readReceipt();
  validateReceipt(receipt);
  assert.equal(
    receipt.seal.head,
    EXPECTED_SEAL_HEAD,
    'WP_B_M1_REVIEW_SEAL_HEAD_REQUIRED'
  );
});

test('Milestone 1 seal verification remains valid on authorized descendant milestones', () => {
  const result = verifyLocalRepository(readReceipt());
  assert.equal(result.ok, true);
  assert.equal(result.sealHead, EXPECTED_SEAL_HEAD);
  assert.deepEqual(result.postReviewFiles, EXPECTED_SEAL_PATHS);
  assert.equal(result.currentHeadDescendsFromSeal, true);
  assert.notEqual(result.currentHead, result.sealHead);
});
