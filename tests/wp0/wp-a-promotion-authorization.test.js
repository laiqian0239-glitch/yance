'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const authorizationDocument = require('../../governance/architecture-closure-v2/wp-a-promotion-authorization.json');
const {
  EXACT_PROMOTION_FILES,
  changedFileSetSha256,
  validateAuthorization,
  validatePromotionEvidence
} = require('../../tools/architecture-closure-v2/verify-wp-a-promotion-authorization');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  const authorization = clone(authorizationDocument);
  const candidateFiles = Array.from({ length: 127 }, (_, index) => `candidate/${String(index).padStart(3, '0')}.txt`);
  authorization.promotionCandidate.changedFileSetSha256 = changedFileSetSha256(candidateFiles);

  const requiredAcv2Jobs = Object.values(authorization.verification.acv2.jobs)
    .map(id => ({ id, status: 'completed', conclusion: 'success' }));
  const requiredWp0Jobs = Object.values(authorization.verification.wp0.jobs)
    .map(id => ({ id, status: 'completed', conclusion: 'success' }));

  return {
    authorization,
    pullRequest: {
      number: 5,
      state: 'open',
      draft: true,
      merged: false,
      changed_files: 127,
      base: { ref: 'main' },
      head: {
        ref: 'acv2/wp-a-identity-ledger-write-host',
        sha: authorization.promotionCandidate.candidateHead
      }
    },
    acv2Run: {
      id: authorization.verification.acv2.runId,
      head_sha: authorization.promotionCandidate.candidateHead,
      status: 'completed',
      conclusion: 'success'
    },
    wp0Run: {
      id: authorization.verification.wp0.runId,
      head_sha: authorization.promotionCandidate.candidateHead,
      status: 'completed',
      conclusion: 'success'
    },
    acv2Jobs: { jobs: requiredAcv2Jobs },
    wp0Jobs: { jobs: requiredWp0Jobs },
    candidateFiles,
    promotionFiles: [...EXACT_PROMOTION_FILES],
    closureReceipt: {
      documentType: 'YANCE_ACV2_TASK_CLOSURE_RECEIPT',
      workPackage: 'WP-A',
      task: 'A8',
      status: 'CLOSED',
      pullRequest: 5,
      reviewedCodeHead: authorization.promotionCandidate.reviewedCodeHead,
      reviewGateHead: authorization.promotionCandidate.reviewedCodeHead,
      independentReview: {
        reviewId: 4839751328,
        decision: 'ALLOW_MERGE',
        openP0: 0,
        openP1: 0,
        temporaryBypassDetected: false
      },
      verification: { sourceClosureViolationCount: 0 },
      governance: { readyForPromotion: false, formalRelease: false, publish: false }
    }
  };
}

test('promotion authorization remains merge-activated and fail closed before merge', () => {
  assert.equal(validateAuthorization(authorizationDocument), true);
  assert.equal(authorizationDocument.status, 'APPROVED_PENDING_MERGE');
  assert.equal(authorizationDocument.governance.readyForPromotion, false);
  assert.equal(authorizationDocument.activation.afterActivation.readyForPromotion, true);
  assert.equal(authorizationDocument.activation.afterActivation.formalRelease, false);
  assert.equal(authorizationDocument.activation.afterActivation.publish, false);
});

test('exact candidate and governance-only promotion evidence passes', () => {
  const result = validatePromotionEvidence(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.activation, 'MERGE_TO_MAIN_REQUIRED');
  assert.equal(result.readyForPromotionNow, false);
  assert.equal(result.readyForPromotionAfterActivation, true);
  assert.equal(result.wpBAuthorized, false);
});

test('candidate Head drift is rejected', () => {
  const input = fixture();
  input.pullRequest.head.sha = '0'.repeat(40);
  assert.throws(() => validatePromotionEvidence(input), /candidate PR Head drifted/u);
});

test('a non-governance file in the promotion PR is rejected', () => {
  const input = fixture();
  input.promotionFiles.push('backend/server.js');
  input.promotionFiles.sort();
  assert.throws(() => validatePromotionEvidence(input), /non-governance or missing files/u);
});

test('a failed required job is rejected', () => {
  const input = fixture();
  input.acv2Jobs.jobs[0].conclusion = 'failure';
  assert.throws(() => validatePromotionEvidence(input), /job not successful/u);
});

test('premature readyForPromotion is rejected', () => {
  const document = clone(authorizationDocument);
  document.governance.readyForPromotion = true;
  assert.throws(() => validateAuthorization(document));
});
