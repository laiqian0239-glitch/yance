'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_BASELINE_COMMIT,
  EXPECTED_TAG,
  checkFreezePolicy,
  checkRuntimeTargetGate,
  git,
  verifyImmutableTag
} = require('../../tools/wp0/lib');

test('freeze-rejected-baseline.test', () => {
  const result = checkFreezePolicy();
  assert.equal(result.pass, true, JSON.stringify(result));
});

test('real annotated immutable tag exists and peels to the rejected baseline commit', () => {
  const tag = verifyImmutableTag();
  assert.equal(tag.pass, true, JSON.stringify(tag));
  assert.equal(git(['show-ref', '--verify', '--hash', `refs/tags/${EXPECTED_TAG}`]), tag.tagRefObject);
  assert.equal(git(['cat-file', '-t', `refs/tags/${EXPECTED_TAG}`]), 'tag');
  assert.equal(git(['rev-parse', `refs/tags/${EXPECTED_TAG}^{}`]), EXPECTED_BASELINE_COMMIT);
});

test('runtime/build target Stage 6.4.5.8 is rejected by executable gate', () => {
  const result = checkRuntimeTargetGate({ targetStage: '6.4.5.8' });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
});
