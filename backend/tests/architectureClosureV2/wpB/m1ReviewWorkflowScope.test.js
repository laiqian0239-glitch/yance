'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
const EXACT_M2_CONTRACT_WORKFLOW = '.github/workflows/wp-b-m2-red.yml';
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
    EXACT_M2_CONTRACT_WORKFLOW,
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

test('WP-B M2 shared-runtime workflow uses base-owned generic implementation authority and preserves exact validation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../../../', EXACT_M2_CONTRACT_WORKFLOW), 'utf8');

  assert.match(workflow, /- electron\/main\.js/u);
  assert.match(workflow, /backend\/tests\/architectureClosureV2\/wpB\/m1ReviewWorkflowScope\.test\.js/u);
  assert.match(workflow, /TRUSTED_POLICY_SHA/u);
  assert.match(workflow, /TRUSTED_POLICY_ROOT/u);
  assert.match(workflow, /shared\/release\/implementationBranchPolicy/u);
  assert.match(workflow, /isAuthorizedImplementationBranch/u);
  assert.doesNotMatch(workflow, /isAuthorizedWpBImplementationBranch/u);
  assert.match(workflow, /refs\/remotes\/origin\/\$\{IMPLEMENTATION_BRANCH\}/u);
  assert.match(workflow, /node --test backend\/tests\/architectureClosureV2\/wpB\/m1ReviewWorkflowScope\.test\.js/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /run: node tools\/architecture-closure-v2\/run-wp-b-m2-contracts\.js --mode contract/u);
});