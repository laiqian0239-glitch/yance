'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
function workflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

test('fast workflow exposes policy, risk and risk-selected portable L2 checks', () => {
  const text = workflow('layered-ci-fast.yml');
  assert.match(text, /layered-ci-policy/u);
  assert.match(text, /layered-ci-risk/u);
  assert.match(text, /select-ci-level\.js/u);
  assert.match(text, /\.\/\.github\/actions\/resolve-diff-range/u);
  assert.match(text, /layered-ci-l2-governance/u);
  assert.match(text, /needs\.layered-ci-risk\.outputs\.requires_l2 == 'true'/u);
  assert.match(text, /suite:\s*layered_governance/u);
  assert.match(text, /reviewed-candidate-a6-sqlite\.yml/u);
  assert.match(text, /stage-6459-wp0-gates\.yml/u);
});

test('A6 workflow validates frozen candidate before running exact reviewed head', () => {
  const text = workflow('reviewed-candidate-a6.yml');
  assert.match(text, /3684dbd840faec8d6e732b0b68eae25f1ad9b2b3/u);
  assert.match(text, /e877aec9e16663296e632c224a1da3b7892f1f2b/u);
  assert.match(text, /verify-reviewed-candidate\.js/u);
  assert.match(text, /git switch --force-create/u);
  assert.match(text, /npm run verify:wp0:gate/u);
  assert.match(text, /Install locked dependencies[\s\S]*Run WP0 required tests/u);
  assert.doesNotMatch(text, /verify:acv2:source-closure/u);
  assert.doesNotMatch(text, /verify:wp0:gate[^\n]*--branch/u);
});

test('A6 SQLite legacy workflow runs ownership tests without identity name filtering', () => {
  const text = workflow('reviewed-candidate-a6-sqlite.yml');
  assert.match(text, /a6-reviewed-sqlite-legacy/u);
  assert.match(text, /3684dbd840faec8d6e732b0b68eae25f1ad9b2b3/u);
  assert.match(text, /tests\/wp5\/m5-sqlite-ownership\.test\.js/u);
  assert.match(text, /tests\/wp4\/application-matrix-temp-path\.test\.js/u);
  assert.match(text, /tests\/wp3\/stale-fencing-token-outbox-denied\.test\.js/u);
  assert.doesNotMatch(text, /--test-name-pattern/u);
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
  const a6 = workflow('reviewed-candidate-a6.yml');
  assert.match(a6, /Checkout governance verifier[\s\S]*persist-credentials:\s*false/u);
  assert.match(a6, /Snapshot current Electron Release trust authority[\s\S]*Checkout exact reviewed WP0 head[\s\S]*Materialize official Electron Release asset and remove credentials[\s\S]*curl --fail --location --proto '=https' --tlsv1\.2[\s\S]*unset-all http\.https:\/\/github\.com\/\.extraheader[\s\S]*Install locked dependencies/u);
  assert.doesNotMatch(a6, /Fetch trusted Electron LFS object|git lfs pull[^\n]*vendor\/electron/u);

  const sqlite = workflow('reviewed-candidate-a6-sqlite.yml');
  assert.match(sqlite, /Checkout governance verifier[\s\S]*persist-credentials:\s*false/u);
  assert.match(sqlite, /Checkout exact reviewed A6 head[\s\S]*persist-credentials:\s*false/u);

  const task = workflow('layered-ci-task.yml');
  assert.match(task, /Establish authorized local branch and remove credentials[\s\S]*unset-all http\.https:\/\/github\.com\/\.extraheader[\s\S]*Set up Node\.js/u);
});

test('privileged workflow setup disables package-manager caching', () => {
  for (const name of [
    'layered-ci-fast.yml',
    'layered-ci-task.yml',
    'layered-ci-promotion.yml',
    'reviewed-candidate-a6.yml',
    'reviewed-candidate-a6-sqlite.yml',
    'stage-6459-wp0-gates.yml'
  ]) {
    const text = workflow(name);
    assert.match(text, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u, name);
    assert.match(text, /package-manager-cache:\s*false/u, name);
  }
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
