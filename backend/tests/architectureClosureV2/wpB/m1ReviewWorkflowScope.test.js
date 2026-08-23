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
const EXACT_M3_VERIFIER = 'tools/architecture-closure-v2/verify-wp-b-m3-authorization.js';
const EXACT_M3_CONTRACT = 'backend/tests/architectureClosureV2/wpB/m3Authorization.test.js';

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

test('WP-B M3 authorization shared-verifier route uses base-owned generic authority and preserves complete validation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../../../', EXACT_M3_AUTHORIZATION_WORKFLOW), 'utf8');

  assert.match(workflow, /- tools\/architecture-closure-v2\/verify-wp-b-m2-review\.js/u);
  assert.match(workflow, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/u);
  assert.match(workflow, /PULL_REQUEST_BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(workflow, /TRUSTED_POLICY_SHA/u);
  assert.match(workflow, /TRUSTED_POLICY_ROOT/u);
  assert.match(workflow, /shared\/release\/implementationBranchPolicy\.js/u);
  assert.match(workflow, /shared\/release\/implementationBranchPolicyLegacy\.js/u);
  assert.match(workflow, /release\/release-source\.json/u);
  assert.match(workflow, /policy\.isAuthorizedImplementationBranch/u);
  assert.match(workflow, /delegatedGovernance:\s*\{\s*trustedMainHead\s*,\s*evaluatedHead\s*\}/u);
  assert.doesNotMatch(workflow, /isAuthorizedWpBImplementationBranch/u);
  assert.match(workflow, /refs\/remotes\/origin\/\$\{IMPLEMENTATION_BRANCH\}/u);
  assert.match(workflow, /GITHUB_ENV/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /backend\/tests\/architectureClosureV2\/wpB\/m3Authorization\.test\.js/u);
  assert.match(workflow, /tests\/wp0\/acv2-work-package-scope-wiring\.test\.js/u);
  assert.match(workflow, /tests\/wp0\/implementation-branch-policy\.test\.js/u);
  assert.match(workflow, /verify-wp-b-m3-authorization\.js --remote/u);
  assert.match(workflow, /git diff --check/u);
});

test('WP-B M3 verifier centralizes local and remote branch admission on exact trusted policy context', () => {
  const verifierPath = path.join(__dirname, '../../../../', EXACT_M3_VERIFIER);
  const source = fs.readFileSync(verifierPath, 'utf8');

  assert.match(source, /function isAuthorizedM3ImplementationBranch\(currentBranch, options = \{\}\)/u);
  assert.match(source, /isAuthorizedWpBImplementationBranch/u);
  assert.match(source, /TRUSTED_POLICY_ROOT/u);
  assert.match(source, /TRUSTED_POLICY_SHA/u);
  assert.match(source, /VALIDATION_SHA/u);
  assert.match(source, /shared\/release\/implementationBranchPolicy\.js/u);
  assert.match(source, /shared\/release\/implementationBranchPolicyLegacy\.js/u);
  assert.match(source, /release\/release-source\.json/u);
  assert.match(source, /policy\.isAuthorizedImplementationBranch/u);
  assert.match(source, /delegatedGovernance:\s*\{\s*trustedMainHead\s*,\s*evaluatedHead\s*\}/u);
  assert.equal((source.match(/requireThat\(isAuthorizedM3ImplementationBranch\(currentBranch\)/gu) || []).length, 2,
    'local and remote verification must share one branch-admission helper');
  assert.match(source, /catch \(_\) \{\s*return false;\s*\}/u);
  assert.match(source, /WP_B_M3_AUTHORIZATION_REMOTE_SUCCESSOR_PR_INVALID/u);
  assert.match(source, /matches\[0\]\.draft === true/u);
  assert.match(source, /matches\[0\]\.merged_at == null/u);
  assert.match(source, /matches\[0\]\.head\?\.sha === currentHead/u);
  assert.match(source, /module\.exports[\s\S]*isAuthorizedM3ImplementationBranch/u);
});

test('WP-B M3 permanent contracts require trusted delegated routing without retiring active WP-B authority', () => {
  const contract = fs.readFileSync(path.join(__dirname, '../../../../', EXACT_M3_CONTRACT), 'utf8');

  assert.match(contract, /M3-AUTH-008/u);
  assert.match(contract, /M3-AUTH-009/u);
  assert.match(contract, /TRUSTED_POLICY_SHA/u);
  assert.match(contract, /isAuthorizedImplementationBranch/u);
  assert.match(contract, /isAuthorizedM3ImplementationBranch/u);
  assert.match(contract, /HISTORICAL_AUTHORITY_PRESERVED/u);
  assert.doesNotMatch(contract,
    /M3-AUTH-009:[^\n]*ACTIVE_AUTHORITY_REQUIRED/u,
    'M3 verifier contract must no longer require direct-only branch admission');
});
