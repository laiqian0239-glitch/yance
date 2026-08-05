'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'oss1a-baileys-lifecycle.yml');
const rolePolicyPath = path.resolve(__dirname, '..', '..', 'tools', 'oss1a', 'workflow-branch-role.js');
const reviewedCandidatePath = path.resolve(__dirname, '..', '..', 'governance', 'open-source-acceleration', 'oss-1a-reviewed-candidate-task11.json');
const V3_GOVERNANCE_BRANCH = 'governance/oss-1a-detached-evidence-baseline-v3';
const V4_GOVERNANCE_BRANCH = 'governance/oss-1a-pre-ready-fd6-authorization';
const V5_GOVERNANCE_BRANCH = 'governance/oss-1a-event-batch-authorization';
const V6_GOVERNANCE_BRANCH = 'governance/oss-1a-lifecycle-milestone-authorization';
const V7_GOVERNANCE_BRANCH = 'governance/oss-1a-async-store-capability-authorization';
const V8_GOVERNANCE_BRANCH = 'governance/oss-1a-canonical-projection-checkpoint-authorization';
const GOVERNANCE_BRANCHES = Object.freeze([
  V3_GOVERNANCE_BRANCH,
  V4_GOVERNANCE_BRANCH,
  V5_GOVERNANCE_BRANCH,
  V6_GOVERNANCE_BRANCH,
  V7_GOVERNANCE_BRANCH,
  V8_GOVERNANCE_BRANCH
]);

function workflowText() {
  assert.equal(fs.existsSync(workflowPath), true, 'OSS-1A runtime workflow must exist');
  return fs.readFileSync(workflowPath, 'utf8');
}

test('OSS-1A workflow uses exact branch roles and never pull_request_target', () => {
  const workflow = workflowText();
  assert.match(workflow, /^name: OSS-1A Baileys Lifecycle$/mu);
  assert.match(workflow, /^on:\s*$/mu);
  assert.match(workflow, /^  pull_request:\s*$/mu);
  assert.doesNotMatch(workflow, /pull_request_target/u);
  assert.match(workflow, /governance\/oss-1a-implementation-authorization/u);
  assert.match(workflow, /governance\/oss-1a-runtime-ci-authorization/u);
  for (const branch of GOVERNANCE_BRANCHES) {
    assert.match(workflow, new RegExp(branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(workflow, new RegExp(`refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  }
  assert.match(workflow, /refs\/heads\/oss\/1a-baileys-lifecycle/u);
  assert.doesNotMatch(workflow, /oss\/\*/u);
  assert.doesNotMatch(workflow, /governance\/oss-1a-\*/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test('runtime role executes the exact Schema 23 RED/GREEN command on the reviewed head', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-runtime-tests/u);
  assert.match(workflow, /ref: \$\{\{ env\.REVIEWED_HEAD_SHA \}\}/u);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(workflow, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u);
  assert.match(workflow, /node-version: '22'/u);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /node --test --test-concurrency=1 backend\/tests\/oss1aWhatsappAuthSchema\.test\.js/u);
});

test('governance roles validate the workflow contract without executing runtime tests', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-governance-contract/u);
  for (const branch of GOVERNANCE_BRANCHES) {
    assert.match(workflow, new RegExp(branch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.match(workflow, /node --test --test-concurrency=1 tests\/wp0\/oss1a-runtime-workflow\.test\.js/u);
});

test('aggregate job fails closed unless exactly the selected role succeeds', () => {
  const workflow = workflowText();
  assert.match(workflow, /name: oss1a-gates/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(workflow, /RUNTIME_RESULT/u);
  assert.match(workflow, /GOVERNANCE_RESULT/u);
  assert.match(workflow, /unknown OSS-1A workflow branch role/u);
});

test('reviewed-candidate role is resolved by exact manifest identity rather than a branch-name allowlist', () => {
  assert.equal(fs.existsSync(rolePolicyPath), true, 'shared OSS-1A workflow branch-role resolver must exist');
  assert.equal(fs.existsSync(reviewedCandidatePath), true, 'reviewed candidate manifest must exist');
  const workflow = workflowText();
  const rolePolicy = fs.readFileSync(rolePolicyPath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(reviewedCandidatePath, 'utf8'));

  assert.equal(manifest.documentType, 'YANCE_OSS_REVIEWED_CANDIDATE');
  assert.equal(manifest.pullRequest, 24);
  assert.equal(manifest.continuationPullRequest, 51);
  assert.equal(manifest.sourceBranch, 'oss/1a-baileys-lifecycle');
  assert.equal(manifest.reviewedCandidateBranch, 'reviewed-candidate/oss1a-task11');
  assert.equal(manifest.reviewedHead, '3e3a52ed9dd255ca5ba027a3b12704b5e281448d');
  assert.equal(manifest.review.id, 4868185392);
  assert.equal(manifest.review.decision, 'ALLOW_MERGE');
  assert.equal(manifest.review.p0Count, 0);
  assert.equal(manifest.review.p1Count, 0);
  assert.equal(manifest.governance.wildcardAuthorizationAllowed, false);
  assert.equal(manifest.governance.temporaryBypassAllowed, false);
  assert.equal(manifest.readyForPromotion, false);

  assert.match(rolePolicy, /function resolveWorkflowBranchRole\(/u);
  assert.match(rolePolicy, /REVIEWED_CANDIDATE/u);
  assert.match(rolePolicy, /reviewedHead/u);
  assert.match(rolePolicy, /reviewedCandidateBranch/u);
  assert.match(rolePolicy, /UNKNOWN/u);
  assert.match(workflow, /workflow-branch-role\.js/u);
  assert.match(workflow, /oss-1a-reviewed-candidate-task11\.json/u);
  assert.doesNotMatch(workflow, /github\.head_ref == 'reviewed-candidate\/oss1a-task11'/u);
  assert.doesNotMatch(workflow, /test "\$\{HEAD_REF\}" = "reviewed-candidate\/oss1a-task11"/u);
});
