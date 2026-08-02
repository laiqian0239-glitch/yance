'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
function workflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

test('fast workflow exposes policy and risk checks', () => {
  const text = workflow('layered-ci-fast.yml');
  assert.match(text, /layered-ci-policy/u);
  assert.match(text, /layered-ci-risk/u);
  assert.match(text, /select-ci-level\.js/u);
});

test('A6 workflow validates frozen candidate before running exact reviewed head', () => {
  const text = workflow('reviewed-candidate-a6.yml');
  assert.match(text, /3684dbd840faec8d6e732b0b68eae25f1ad9b2b3/u);
  assert.match(text, /e877aec9e16663296e632c224a1da3b7892f1f2b/u);
  assert.match(text, /verify-reviewed-candidate\.js/u);
  assert.match(text, /git switch --force-create/u);
  assert.match(text, /npm run verify:wp0:gate/u);
  assert.doesNotMatch(text, /verify:acv2:source-closure/u);
  assert.doesNotMatch(text, /verify:wp0:gate[^\n]*--branch/u);
});

test('task workflow accepts predefined suites rather than arbitrary commands', () => {
  const text = workflow('layered-ci-task.yml');
  assert.match(text, /type: choice/u);
  assert.match(text, /acv2_wp_a_a6/u);
  assert.match(text, /full_work_package/u);
  assert.doesNotMatch(text, /task_test_command/u);
  assert.match(text, /windows-latest/u);
});

test('promotion workflow verifies exact identity and cannot publish', () => {
  const text = workflow('layered-ci-promotion.yml');
  assert.match(text, /expected_commit/u);
  assert.match(text, /expected_tree/u);
  assert.match(text, /git rev-parse 'HEAD\^\{tree\}'/u);
  assert.doesNotMatch(text, /gh release/u);
  assert.doesNotMatch(text, /publish:\s*true/u);
  assert.match(text, /readyForPromotion=false/u);
});
