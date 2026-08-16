'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const RETIRED_WORKFLOWS = Object.freeze([
  'reviewed-candidate-a6.yml',
  'reviewed-candidate-a6-sqlite.yml',
  'wp-a-promotion-authorization.yml'
]);

function workflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

function workflowExists(name) {
  return fs.existsSync(path.join(ROOT, '.github', 'workflows', name));
}

test('fast workflow exposes policy, risk and risk-selected portable L2 checks without historical A6 triggers', () => {
  const text = workflow('layered-ci-fast.yml');
  assert.match(text, /layered-ci-policy/u);
  assert.match(text, /layered-ci-risk/u);
  assert.match(text, /select-ci-level\.js/u);
  assert.match(text, /\.\/\.github\/actions\/resolve-diff-range/u);
  assert.match(text, /layered-ci-l2-governance/u);
  assert.match(text, /needs\.layered-ci-risk\.outputs\.requires_l2 == 'true'/u);
  assert.match(text, /suite:\s*layered_governance/u);
  assert.doesNotMatch(text, /reviewed-candidate-a6(?:-sqlite)?\.yml/u);
  assert.match(text, /stage-6459-wp0-gates\.yml/u);
});

test('current ACV2 and Layered owners replace the frozen A6 workflow authorities', () => {
  for (const name of RETIRED_WORKFLOWS) {
    assert.equal(workflowExists(name), false, `${name} must be retired from the current Actions surface`);
  }

  const acv2 = workflow('acv2-wp-a.yml');
  assert.match(acv2, /REVIEWED_HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(acv2, /ubuntu-latest/u);
  assert.match(acv2, /windows-latest/u);
  assert.match(acv2, /runtimeComposition\.test\.js/u);
  assert.match(acv2, /runtimeGatewaySurface\.test\.js/u);
  assert.match(acv2, /runtimeStateStoreBinding\.test\.js/u);
  assert.match(acv2, /runtimeProcessSingleton\.test\.js/u);
  assert.match(acv2, /startupOrdering\.test\.js/u);
  assert.match(acv2, /tests\/wp5\/m5-sqlite-ownership\.test\.js/u);
  assert.match(acv2, /tests\/wp4\/application-matrix-temp-path\.test\.js/u);
  assert.match(acv2, /tests\/wp3\/stale-fencing-token-outbox-denied\.test\.js/u);

  const task = workflow('layered-ci-task.yml');
  assert.match(task, /acv2_wp_a_a6/u);
  assert.match(task, /runtimeComposition\.test\.js/u);
  assert.match(task, /windows-latest/u);
});

test('task workflow separates portable suites from branch-bound WP0 suites', () => {
  const text = workflow('layered-ci-task.yml');
  assert.match(text, /workflow_call:/u);
  assert.match(text, /type: choice/u);
  assert.match(text, /layered_governance/u);
  assert.match(text, /acv2_wp_a_a6/u);
  assert.match(text, /full_work_package/u);
  assert.doesNotMatch(text, /task_test_command/u);
  assert.match(text, /candidate_branch:/u);
  assert.match(text, /Validate branch-bound WP0 candidate/u);
  assert.match(text, /refs\/remotes\/origin\/\$\{CANDIDATE_BRANCH\}/u);
  assert.match(text, /layered-ci-l2-portable-\$\{\{ matrix\.os \}\}/u);
  assert.match(text, /layered-ci-l2-branch-bound-wp0-\$\{\{ matrix\.os \}\}/u);
  assert.match(text, /windows-latest/u);
  assert.match(text, /Install locked dependencies for WP0 and work-package tests[\s\S]*Run WP0 task contracts/u);
});

test('portable governance suite never invokes branch-bound WP0 contracts', () => {
  const text = workflow('layered-ci-task.yml');
  assert.match(text, /inputs\.suite == 'layered_governance'/u);
  assert.match(text, /tests\/layered-ci\/\*\.test\.js/u);
  assert.match(text, /inputs\.suite == 'wp0' \|\| inputs\.suite == 'full_work_package'/u);
});

test('credentials are absent or removed before repository-controlled tests execute', () => {
  const acv2 = workflow('acv2-wp-a.yml');
  assert.match(acv2, /Checkout reviewed WP-A head[\s\S]*persist-credentials:\s*false/u);

  const postMerge = workflow('wp-a-post-merge-validation.yml');
  assert.match(postMerge, /Checkout exact validation commit[\s\S]*persist-credentials:\s*false/u);

  const task = workflow('layered-ci-task.yml');
  assert.match(task, /Establish authorized local branch and remove credentials[\s\S]*unset-all http\.https:\/\/github\.com\/\.extraheader[\s\S]*Set up Node\.js/u);
});

test('privileged workflow setup disables package-manager caching', () => {
  for (const name of [
    'acv2-wp-a.yml',
    'layered-ci-fast.yml',
    'layered-ci-task.yml',
    'layered-ci-promotion.yml',
    'stage-6459-wp0-gates.yml',
    'wp-a-post-merge-validation.yml'
  ]) {
    const text = workflow(name);
    assert.match(text, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u, name);
    assert.match(text, /package-manager-cache:\s*false/u, name);
  }
});

test('current WP-A post-merge validation owns integration readiness without release or publish authority', () => {
  const text = workflow('wp-a-post-merge-validation.yml');
  assert.match(text, /Verify exact integration identity and governance/u);
  assert.match(text, /source-closure-scan\.js --wp A/u);
  assert.match(text, /ubuntu-latest/u);
  assert.match(text, /windows-latest/u);
  assert.match(text, /readyForPromotion=true/u);
  assert.match(text, /formalRelease=false/u);
  assert.match(text, /publish=false/u);
  assert.match(text, /wpBAuthorized=false/u);
});

test('promotion workflow verifies exact identity and cannot publish', () => {
  const text = workflow('layered-ci-promotion.yml');
  assert.match(text, /expected_commit/u);
  assert.match(text, /expected_tree/u);
  assert.match(text, /git rev-parse 'HEAD\^\{tree\}'/u);
  for (const forbidden of [
    /gh\s+release/u,
    /npm\s+publish/u,
    /docker\s+push/u,
    /softprops\/action-gh-release/u,
    /actions\/upload-release-asset/u,
    /publish:\s*true/u,
    /contents:\s*write/u
  ]) {
    assert.doesNotMatch(text, forbidden, `promotion workflow must not publish: ${forbidden}`);
  }
  assert.match(text, /permissions:\n\s+contents:\s*read\n/u);
  assert.match(text, /persist-credentials:\s*false/u);
  assert.match(text, /GITHUB_OUTPUT/u);
  assert.match(text, /GITHUB_STEP_SUMMARY/u);
  assert.match(text, /readyForPromotion=false/u);
});
