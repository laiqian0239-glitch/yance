'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const verifierPath = path.join(
  repoRoot,
  'tools',
  'architecture-closure-v2',
  'verify-wp-b-m1-review.js'
);
const {
  EXPECTED_SEAL_PATHS,
  readReceipt,
  validateReceipt,
  verifyLocalRepository
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m1-review');

function clone(value) {
  return structuredClone(value);
}

test('Milestone 1 review receipt is fail-closed and preserves all authorization boundaries', () => {
  const receipt = readReceipt();
  const result = validateReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(receipt.review.reviewGate1, 'APPROVED');
  assert.equal(receipt.review.milestone1, 'SEALED');
  assert.equal(receipt.review.milestone2, 'NOT_STARTED');
  assert.equal(receipt.review.humanApprovalClaimed, false);
  assert.equal(receipt.governance.prMustRemainDraft, true);
  for (const field of [
    'mergeAuthorized',
    'milestone2Authorized',
    'wpCAuthorized',
    'productionUseAuthorized',
    'formalRelease',
    'publish',
    'temporaryBypassAllowed'
  ]) assert.equal(receipt.governance[field], false, field);
});

test('Milestone 1 seal binds the reviewed Git file set, reviewed blobs and exact post-review paths', () => {
  const result = verifyLocalRepository(readReceipt());
  assert.equal(result.ok, true);
  assert.equal(result.reviewedHead, '1488ce7aa594f5abb915da64f21a83dc6e4dd5c3');
  assert.equal(result.reviewedFileCount, 89);
  assert.equal(
    result.reviewedFileSetSha256,
    'bc1ec1a4b54cbbbe041e113f1192a690173dac9a6623d63475b62b067305b339'
  );
  assert.deepEqual(result.postReviewFiles, EXPECTED_SEAL_PATHS);
});

test('Milestone 1 seal verifier rejects any attempt to open downstream governance', () => {
  for (const field of [
    'mergeAuthorized',
    'milestone2Authorized',
    'wpCAuthorized',
    'productionUseAuthorized',
    'formalRelease',
    'publish',
    'temporaryBypassAllowed'
  ]) {
    const mutated = clone(readReceipt());
    mutated.governance[field] = true;
    assert.throws(
      () => validateReceipt(mutated),
      error => error?.code === 'WP_B_M1_REVIEW_GOVERNANCE_OPEN' && error?.field === field
    );
  }
});

test('Milestone 1 seal verifier rejects weakened path scope and false human-review claims', () => {
  const wildcard = clone(readReceipt());
  wildcard.seal.allowedPostReviewPaths = ['.github/workflows/**'];
  assert.throws(
    () => validateReceipt(wildcard),
    error => error?.code === 'WP_B_M1_REVIEW_SEAL_PATHS_INVALID'
  );

  const humanClaim = clone(readReceipt());
  humanClaim.review.humanApprovalClaimed = true;
  assert.throws(
    () => validateReceipt(humanClaim),
    error => error?.code === 'WP_B_M1_REVIEW_HUMAN_CLAIM_INVALID'
  );
});

test('standalone Milestone 1 seal verifier emits a machine-readable PASS result', () => {
  const stdout = execFileSync(process.execPath, [verifierPath], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.local.ok, true);
  assert.deepEqual(report.local.postReviewFiles, EXPECTED_SEAL_PATHS);
});
