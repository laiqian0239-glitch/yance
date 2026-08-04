'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMANENT_REVIEW_WORKFLOW_PATHS,
  evaluateAuthorizedWpBScope,
  resolveWpBImplementationAuthority
} = require('../../../../shared/release/implementationBranchPolicy');

const EXACT_M1_REVIEW_WORKFLOW = '.github/workflows/wp-b-m1-independent-review-integrity.yml';
const EXACT_M2_REVIEW_WORKFLOW = '.github/workflows/wp-b-m2-independent-review-integrity.yml';

test('WP-B authority preserves the exact M1 review workflow and admits M2 review only by exact active authorization', () => {
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  assert.deepEqual(PERMANENT_REVIEW_WORKFLOW_PATHS, [EXACT_M1_REVIEW_WORKFLOW]);

  const exactM1 = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: [EXACT_M1_REVIEW_WORKFLOW]
  });
  assert.equal(exactM1.pass, true, JSON.stringify(exactM1));
  assert.deepEqual(exactM1.unauthorizedPaths, []);

  const exactM2 = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: [EXACT_M2_REVIEW_WORKFLOW]
  });
  assert.equal(authority.milestone, 2);
  assert.equal(exactM2.pass, true, JSON.stringify(exactM2));
  assert.deepEqual(exactM2.unauthorizedPaths, []);

  const adjacent = [
    '.github/workflows/wp-b-m1-independent-review-integrity-copy.yml',
    '.github/workflows/wp-b-m1-independent-review-integrity.yaml',
    '.github/workflows/wp-b-m2-independent-review-integrity-copy.yml',
    '.github/workflows/wp-b-m2-independent-review-integrity.yaml'
  ];
  const rejected = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: adjacent
  });
  assert.equal(rejected.pass, false);
  assert.equal(rejected.reasonCode, 'ACV2_WP_B_SCOPE_VIOLATION');
  assert.deepEqual(rejected.unauthorizedPaths, [...adjacent].sort());
  assert.equal(authority.allowedProductionPaths.includes('.github/workflows/**'), false);
  assert.equal(authority.governance.temporaryBypassAllowed, false);
  assert.equal(authority.governance.readyForPromotion, false);
});
