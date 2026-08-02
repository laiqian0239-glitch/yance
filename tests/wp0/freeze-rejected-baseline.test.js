'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  REPO_ROOT,
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

test('verify-gate CLI binds the gate to a reviewed branch whose remote tip equals HEAD', () => {
  const reviewedBranch = 'rebuild/windows-release-closure-20260802-cli-probe';
  const remoteRef = `refs/remotes/origin/${reviewedBranch}`;
  git(['update-ref', remoteRef, 'HEAD']);
  try {
    const child = spawnSync(process.execPath, ['tools/wp0/verify-gate.js', '--branch', reviewedBranch], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    assert.equal(child.error, undefined, child.error?.message);
    const result = JSON.parse(child.stdout);
    const freeze = result.checks.find((item) => item.id === 'freeze-rejected-baseline.test');
    assert.equal(result.branch, reviewedBranch, JSON.stringify(result));
    assert.equal(freeze?.details?.runtimeTargetGate?.branch, reviewedBranch, JSON.stringify(result));
  } finally {
    git(['update-ref', '-d', remoteRef]);
  }
});

test('verify-gate CLI rejects a reviewed branch whose remote tip does not equal HEAD', () => {
  const reviewedBranch = 'rebuild/windows-release-closure-20260802-mismatch-probe';
  const remoteRef = `refs/remotes/origin/${reviewedBranch}`;
  git(['update-ref', remoteRef, EXPECTED_BASELINE_COMMIT]);
  try {
    const child = spawnSync(process.execPath, ['tools/wp0/verify-gate.js', '--branch', reviewedBranch], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    assert.notEqual(child.status, 0);
    const error = JSON.parse(child.stderr);
    assert.equal(error.reasonCode, 'WP0_REVIEWED_BRANCH_HEAD_MISMATCH');
  } finally {
    git(['update-ref', '-d', remoteRef]);
  }
});
