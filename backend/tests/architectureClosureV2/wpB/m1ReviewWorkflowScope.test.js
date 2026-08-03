'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMANENT_REVIEW_WORKFLOW_PATHS,
  evaluateAuthorizedWpBScope,
  resolveWpBImplementationAuthority
} = require('../../../../shared/release/implementationBranchPolicy');

const EXACT_REVIEW_WORKFLOW = '.github/workflows/wp-b-m1-independent-review-integrity.yml';

test('WP-B authority permits only the exact permanent Milestone 1 review workflow', () => {
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  assert.deepEqual(PERMANENT_REVIEW_WORKFLOW_PATHS, [EXACT_REVIEW_WORKFLOW]);

  const exact = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: [EXACT_REVIEW_WORKFLOW]
  });
  assert.equal(exact.pass, true, JSON.stringify(exact));
  assert.deepEqual(exact.unauthorizedPaths, []);

  const adjacent = [
    '.github/workflows/wp-b-m1-independent-review-integrity-copy.yml',
    '.github/workflows/wp-b-m2-independent-review-integrity.yml',
    '.github/workflows/wp-b-m1-independent-review-integrity.yaml'
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
