'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMANENT_REVIEW_WORKFLOW_PATHS,
  MILESTONE_TWO_WORKFLOW_PATHS,
  MILESTONE_THREE_WORKFLOW_PATHS,
  evaluateAuthorizedWpBScope,
  resolveWpBImplementationAuthority
} = require('../../../../shared/release/implementationBranchPolicy');

const EXACT_M1_REVIEW_WORKFLOW = '.github/workflows/wp-b-m1-independent-review-integrity.yml';
const EXACT_M2_REVIEW_WORKFLOW = '.github/workflows/wp-b-m2-independent-review-integrity.yml';
const EXACT_M3_AUTHORIZATION_WORKFLOW = '.github/workflows/wp-b-m3-authorization.yml';
const EXACT_M3_POST_MERGE_WORKFLOW = '.github/workflows/wp-b-post-merge-validation.yml';

test('WP-B active authority preserves exact M1/M2/M3 workflow ownership without wildcard expansion', () => {
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  assert.equal(authority.milestone, 3, 'current WP-B authority must resolve the authorized M3 scope');
  assert.deepEqual(PERMANENT_REVIEW_WORKFLOW_PATHS, [EXACT_M1_REVIEW_WORKFLOW]);
  assert.deepEqual(MILESTONE_TWO_WORKFLOW_PATHS, [
    '.github/workflows/wp-b-m2-authorization.yml',
    '.github/workflows/wp-b-m2-red.yml',
    EXACT_M2_REVIEW_WORKFLOW
  ]);
  assert.deepEqual(MILESTONE_THREE_WORKFLOW_PATHS, [
    EXACT_M3_AUTHORIZATION_WORKFLOW,
    EXACT_M3_POST_MERGE_WORKFLOW
  ]);

  for (const workflowPath of [
    EXACT_M1_REVIEW_WORKFLOW,
    EXACT_M2_REVIEW_WORKFLOW,
    EXACT_M3_AUTHORIZATION_WORKFLOW,
    EXACT_M3_POST_MERGE_WORKFLOW
  ]) {
    const result = evaluateAuthorizedWpBScope({
      authority,
      branch: authority.authorizedBranch,
      changedFiles: [workflowPath]
    });
    assert.equal(result.pass, true, `${workflowPath}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.unauthorizedPaths, []);
  }

  const adjacent = [
    '.github/workflows/wp-b-m1-independent-review-integrity-copy.yml',
    '.github/workflows/wp-b-m1-independent-review-integrity.yaml',
    '.github/workflows/wp-b-m2-independent-review-integrity-copy.yml',
    '.github/workflows/wp-b-m2-independent-review-integrity.yaml',
    '.github/workflows/wp-b-m3-authorization-copy.yml',
    '.github/workflows/wp-b-post-merge-validation.yaml'
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
