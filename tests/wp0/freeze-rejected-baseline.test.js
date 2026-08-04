'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  REPO_ROOT,
  ALLOWED_BRANCH,
  EXPECTED_BASELINE_PROVENANCE_COMMIT,
  EXPECTED_BASELINE_ANCHOR_COMMIT,
  EXPECTED_BASELINE_ANCHOR_PATH,
  EXPECTED_BASELINE_ANCHOR_BLOB,
  checkFreezePolicy,
  checkRuntimeTargetGate,
  git,
  verifyRejectedBaselineAnchor
} = require('../../tools/wp0/lib');

test('freeze-rejected-baseline.test', () => {
  const result = checkFreezePolicy({ branch: ALLOWED_BRANCH });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.details.runtimeTargetGate.branch, ALLOWED_BRANCH);
});

test('portable repository archive anchor preserves the rejected baseline decision', () => {
  const anchor = verifyRejectedBaselineAnchor();
  assert.equal(anchor.pass, true, JSON.stringify(anchor));
  assert.equal(git(['cat-file', '-t', EXPECTED_BASELINE_ANCHOR_COMMIT]), 'commit');
  git(['merge-base', '--is-ancestor', EXPECTED_BASELINE_ANCHOR_COMMIT, 'HEAD']);
  assert.equal(
    git(['rev-parse', `${EXPECTED_BASELINE_ANCHOR_COMMIT}:${EXPECTED_BASELINE_ANCHOR_PATH}`]),
    EXPECTED_BASELINE_ANCHOR_BLOB
  );
  assert.equal(anchor.provenanceCommit, EXPECTED_BASELINE_PROVENANCE_COMMIT);
  assert.equal(anchor.originalVcsHistoryAvailable, false);
});

test('archive anchor verification fails closed on a blob mismatch', () => {
  const anchor = verifyRejectedBaselineAnchor({ expectedAnchorBlob: '0'.repeat(40) });
  assert.equal(anchor.pass, false);
  assert.equal(anchor.reasonCode, 'WP0_REJECTED_BASELINE_ANCHOR_INVALID');
  assert.match(anchor.errors.join('\n'), /blob/i);
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
  git(['update-ref', remoteRef, EXPECTED_BASELINE_ANCHOR_COMMIT]);
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
