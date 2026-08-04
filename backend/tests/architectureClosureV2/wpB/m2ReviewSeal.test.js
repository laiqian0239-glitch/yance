'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const verifierPath = path.join(repoRoot, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-review.js');
const {
  EXPECTED_OPERATION_KINDS,
  EXPECTED_POST_REVIEW_PATHS,
  readReceipt,
  validateReceipt,
  verifyLocalRepository
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m2-review');

function clone(value) {
  return structuredClone(value);
}

function sealedShape(receipt = readReceipt()) {
  const result = clone(receipt);
  result.seal.status = 'SEALED';
  result.seal.head = 'a'.repeat(40);
  result.seal.formalValidation = result.formalValidation.map(run => ({
    ...clone(run),
    expectedHead: result.seal.head
  }));
  result.review.milestone2 = 'SEALED';
  result.governance.milestone2Sealed = true;
  return result;
}

test('M2-SEAL-001 pending Gate 2 evidence is valid and all downstream authority remains closed', () => {
  const receipt = readReceipt();
  const result = validateReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(result.sealStatus, 'PENDING');
  assert.equal(receipt.review.reviewGate2, 'APPROVED');
  assert.equal(receipt.review.milestone1, 'SEALED');
  assert.equal(receipt.review.milestone2, 'REVIEWED_NOT_SEALED');
  assert.equal(receipt.review.milestone3, 'NOT_STARTED');
  assert.equal(receipt.review.humanApprovalClaimed, false);
  assert.equal(receipt.governance.prMustRemainDraft, true);
  assert.equal(receipt.governance.milestone2Reviewed, true);
  assert.equal(receipt.governance.milestone2Sealed, false);
  for (const field of [
    'readyForPromotion',
    'milestone3Authorized',
    'mergeAuthorized',
    'productionUseAuthorized',
    'wpCAuthorized',
    'formalRelease',
    'publish',
    'temporaryBypassAllowed',
    'warningOnlyClosureAllowed'
  ]) assert.equal(receipt.governance[field], false, field);
});

test('M2-SEAL-002 staging Head contains the exact four seal-only paths and no production source', () => {
  const result = verifyLocalRepository(readReceipt());
  assert.equal(result.ok, true);
  assert.equal(result.reviewedHead, '3e5d71f68afccb64d0f61a776170d815fed77747');
  assert.equal(result.reviewedFileCount, 156);
  assert.equal(result.reviewedFileSetSha256, '47624308f63d4f32aed4b9d280b4015c3c3e654c43e34befdb3c80089c01fe6f');
  assert.deepEqual(result.postReviewFiles, EXPECTED_POST_REVIEW_PATHS);
  assert.equal(result.postReviewFiles.some(filePath => filePath.startsWith('backend/services/')), false);
  assert.equal(result.postReviewFiles.some(filePath => filePath.startsWith('backend/runtime/')), false);
});

test('M2-SEAL-003 verifier rejects mutations to reviewed ancestry, file set and blob identities', () => {
  const wrongParent = clone(readReceipt());
  wrongParent.reviewedImplementation.parentMilestone1SealHead = 'b'.repeat(40);
  assert.throws(() => validateReceipt(wrongParent), error => error?.code === 'WP_B_M2_REVIEW_PARENT_SEAL_INVALID');

  const wrongHead = clone(readReceipt());
  wrongHead.reviewedImplementation.head = 'c'.repeat(40);
  assert.throws(() => validateReceipt(wrongHead), error => error?.code === 'WP_B_M2_REVIEW_VALIDATION_HEAD_INVALID');

  const wrongCount = clone(readReceipt());
  wrongCount.reviewedImplementation.changedFileCount += 1;
  assert.throws(() => verifyLocalRepository(wrongCount), error => error?.code === 'WP_B_M2_REVIEW_FILE_COUNT_MISMATCH');

  const wrongDigest = clone(readReceipt());
  wrongDigest.reviewedImplementation.changedFileSetSha256 = 'd'.repeat(64);
  assert.throws(() => verifyLocalRepository(wrongDigest), error => error?.code === 'WP_B_M2_REVIEW_FILE_DIGEST_MISMATCH');

  const wrongBlob = clone(readReceipt());
  wrongBlob.reviewedBlobs['backend/runtime/AppRuntimeComposition.js'] = 'e'.repeat(40);
  assert.throws(() => verifyLocalRepository(wrongBlob), error => error?.code === 'WP_B_M2_REVIEW_BLOB_MISMATCH');
});

test('M2-SEAL-004 verifier rejects operation, finding and reviewed-workflow evidence mutations', () => {
  const order = clone(readReceipt());
  order.reviewedImplementation.operationKinds = [...EXPECTED_OPERATION_KINDS].reverse();
  assert.throws(() => validateReceipt(order), error => error?.code === 'WP_B_M2_REVIEW_OPERATION_ORDER_INVALID');

  const finding = clone(readReceipt());
  finding.findings[0].resolution = '';
  assert.throws(() => validateReceipt(finding), error => error?.code === 'WP_B_M2_REVIEW_FINDING_SHAPE_INVALID');

  const workflow = clone(readReceipt());
  workflow.formalValidation[0].expectedHead = 'f'.repeat(40);
  assert.throws(() => validateReceipt(workflow), error => error?.code === 'WP_B_M2_REVIEW_VALIDATION_HEAD_INVALID');
});

test('M2-SEAL-005 verifier rejects widened seal scope, false human approval and downstream opening', () => {
  const wildcard = clone(readReceipt());
  wildcard.seal.allowedPostReviewPaths = ['.github/workflows/**'];
  assert.throws(() => validateReceipt(wildcard), error => error?.code === 'WP_B_M2_REVIEW_SEAL_PATHS_INVALID');

  const humanClaim = clone(readReceipt());
  humanClaim.review.humanApprovalClaimed = true;
  assert.throws(() => validateReceipt(humanClaim), error => error?.code === 'WP_B_M2_REVIEW_HUMAN_CLAIM_INVALID');

  for (const field of [
    'readyForPromotion',
    'milestone3Authorized',
    'mergeAuthorized',
    'productionUseAuthorized',
    'wpCAuthorized',
    'formalRelease',
    'publish',
    'temporaryBypassAllowed',
    'warningOnlyClosureAllowed'
  ]) {
    const mutated = clone(readReceipt());
    mutated.governance[field] = true;
    assert.throws(
      () => validateReceipt(mutated),
      error => error?.code === 'WP_B_M2_REVIEW_GOVERNANCE_OPEN' && error?.field === field
    );
  }
});

test('M2-SEAL-006 sealed shape requires eight successful workflows bound to one fixed Seal Head', () => {
  const sealed = sealedShape();
  const result = validateReceipt(sealed);
  assert.equal(result.ok, true);
  assert.equal(result.sealStatus, 'SEALED');
  assert.equal(sealed.seal.formalValidation.length, 8);
  assert.equal(sealed.seal.formalValidation.every(run => run.expectedHead === sealed.seal.head), true);

  const wrongSealHead = sealedShape();
  wrongSealHead.seal.formalValidation[0].expectedHead = 'b'.repeat(40);
  assert.throws(() => validateReceipt(wrongSealHead), error => error?.code === 'WP_B_M2_REVIEW_SEAL_VALIDATION_HEAD_INVALID');

  const missingWorkflow = sealedShape();
  missingWorkflow.seal.formalValidation.pop();
  assert.throws(() => validateReceipt(missingWorkflow), error => error?.code === 'WP_B_M2_REVIEW_SEAL_VALIDATION_SET_INVALID');
});

test('M2-SEAL-007 standalone verifier emits machine-readable pending review evidence', () => {
  const stdout = execFileSync(process.execPath, [verifierPath], { cwd: repoRoot, encoding: 'utf8' });
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.local.ok, true);
  assert.equal(report.local.sealStatus, 'PENDING');
  assert.deepEqual(report.local.postReviewFiles, EXPECTED_POST_REVIEW_PATHS);
});
