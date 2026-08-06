'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  A8_POST_MERGE_DEFECT_ID,
  A8_POST_MERGE_DEFECT_PATH,
  A8_POST_MERGE_DEFECT_TARGET_BRANCH,
  REBUILD_BRANCH_PATTERN_SOURCE,
  authorizedImplementationBranchDescription,
  canonicalRebuildBranch,
  canonicalStageBranch,
  changedFileSetSha256,
  evaluateAuthorizedPostMergeDefectScope,
  evaluateAuthorizedWorkPackageScope,
  isAuthorizedImplementationBranch,
  isValidWorkPackagePostMergeDefect,
  loadWorkPackageAuthorization,
  loadWorkPackagePostMergeDefect
} = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION = loadWorkPackageAuthorization();
const AUTHORIZED_BRANCH = AUTHORIZATION.authorizedBranch;
const STAGE = '6.4.5.9';

function changedFilesFrom(base) {
  const raw = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD', '--'], {
    cwd: ROOT,
    encoding: null
  });
  return raw.toString('utf8').split('\0').filter(Boolean).sort();
}

test('canonical stage and rebuild branches remain exact', () => {
  assert.equal(canonicalStageBranch(STAGE), 'stage/6.4.5.9-architecture-closure');
  assert.equal(canonicalRebuildBranch(STAGE), 'rebuild/windows-release-closure-6.4.5.9');
  assert.equal(REBUILD_BRANCH_PATTERN_SOURCE, '^rebuild/windows-release-closure-6\\.4\\.5\\.9$');
  assert.equal(authorizedImplementationBranchDescription(STAGE),
    'stage/6.4.5.9-architecture-closure, rebuild/windows-release-closure-6.4.5.9, acv2/wp-a-identity-ledger-write-host, or an exact sealed open-source work-package branch');
});

test('authorized implementation branches preserve stage, rebuild, ACV2 and sealed OSS delegation', () => {
  assert.equal(isAuthorizedImplementationBranch(canonicalStageBranch(STAGE), STAGE), true);
  assert.equal(isAuthorizedImplementationBranch(canonicalRebuildBranch(STAGE), STAGE), true);
  assert.equal(isAuthorizedImplementationBranch(AUTHORIZED_BRANCH, STAGE), true);
  assert.equal(isAuthorizedImplementationBranch('stage/6.4.5.8-architecture-closure', STAGE), false);
  assert.equal(isAuthorizedImplementationBranch('rebuild/windows-release-closure-6.4.5.9-extra', STAGE), false);
  assert.equal(isAuthorizedImplementationBranch(' acv2/wp-a-identity-ledger-write-host', STAGE), false);
  assert.equal(isAuthorizedImplementationBranch('./acv2/wp-a-identity-ledger-write-host', STAGE), false);
});

test('checked-out scope authority preserves the exact authorization blob and path set', () => {
  const blob = execFileSync('git', ['rev-parse', `HEAD:${ACV2_AUTHORIZATION_REPOSITORY_PATH}`], {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();
  assert.equal(blob, ACV2_AUTHORIZATION_BLOB_SHA);
  assert.equal(AUTHORIZATION.parentGovernanceHead, ACV2_WP_A_PARENT_GOVERNANCE_HEAD);
  assert.equal(AUTHORIZATION.approvedChangedFileCount, AUTHORIZATION.exactPaths.length);
  assert.equal(AUTHORIZATION.approvedChangedFileSetSha256, changedFileSetSha256(AUTHORIZATION.exactPaths));
});

test('checked-out candidate scope remains exact when evaluated from the frozen ACV2 parent', () => {
  const changedFiles = changedFilesFrom(ACV2_WP_A_PARENT_GOVERNANCE_HEAD);
  const evaluation = evaluateAuthorizedWorkPackageScope({
    branch: AUTHORIZED_BRANCH,
    changedFiles,
    authorization: AUTHORIZATION,
    amendment: null
  });
  if (evaluation.pass) {
    assert.equal(evaluation.changedFileSetSha256, AUTHORIZATION.approvedChangedFileSetSha256);
    assert.equal(changedFiles.length, AUTHORIZATION.approvedChangedFileCount);
    assert.deepEqual(evaluation.unauthorizedPaths, []);
  } else {
    assert.ok([
      'ACV2_WORK_PACKAGE_CHANGED_FILE_SET_MISMATCH',
      'ACV2_WORK_PACKAGE_SCOPE_VIOLATION'
    ].includes(evaluation.reasonCode), JSON.stringify(evaluation));
  }
});

test('unrelated branches cannot inherit ACV2 scope authority', () => {
  const result = evaluateAuthorizedWorkPackageScope({
    branch: 'main',
    changedFiles: AUTHORIZATION.exactPaths,
    authorization: AUTHORIZATION,
    amendment: null
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'ACV2_WORK_PACKAGE_AUTHORIZATION_INVALID');
});

test('post-merge defect authority remains exact and closed', () => {
  const defect = loadWorkPackagePostMergeDefect();
  assert.ok(defect);
  assert.equal(defect.defectId, A8_POST_MERGE_DEFECT_ID);
  assert.equal(defect.scope.targetBranch, A8_POST_MERGE_DEFECT_TARGET_BRANCH);
  assert.equal(defect.status, 'CLOSED');
  assert.equal(isValidWorkPackagePostMergeDefect(defect), true);
  assert.equal(defect.scope.changedFileSetSha256, changedFileSetSha256(defect.scope.exactPaths));
  assert.equal(defect.scope.changedFileCount, defect.scope.exactPaths.length);
  assert.deepEqual([...defect.scope.exactPaths].sort(), defect.scope.exactPaths);
});

test('checked-out scope authority preserves A8 against the frozen defect commits and paths', () => {
  const defectPath = path.join(ROOT, ...A8_POST_MERGE_DEFECT_PATH.split('/'));
  assert.equal(fs.existsSync(defectPath), true);
  const defect = JSON.parse(fs.readFileSync(defectPath, 'utf8'));
  assert.equal(isValidWorkPackagePostMergeDefect(defect), true);
  assert.equal(defect.scope.changedFileSetSha256, changedFileSetSha256(defect.scope.exactPaths));
  assert.equal(defect.scope.changedFileCount, defect.scope.exactPaths.length);
  assert.deepEqual([...defect.scope.exactPaths].sort(), defect.scope.exactPaths);

  execFileSync('git', ['cat-file', '-e', `${defect.scope.baseHead}^{commit}`], { cwd: ROOT });
  execFileSync('git', ['cat-file', '-e', `${defect.scope.closedHead}^{commit}`], { cwd: ROOT });
  execFileSync('git', ['merge-base', '--is-ancestor', defect.scope.baseHead, defect.scope.closedHead], {
    cwd: ROOT
  });

  const evaluation = evaluateAuthorizedPostMergeDefectScope({
    branch: defect.scope.targetBranch,
    changedFiles: defect.scope.exactPaths,
    defect
  });
  assert.equal(evaluation.pass, true, JSON.stringify(evaluation));
  assert.equal(evaluation.changedFileSetSha256, defect.scope.changedFileSetSha256);
  assert.deepEqual(evaluation.unauthorizedPaths, []);
});

test('post-merge defect scope rejects current candidate changes not in its frozen set', () => {
  const defect = loadWorkPackagePostMergeDefect();
  const currentChangedFiles = changedFilesFrom(defect.scope.baseHead);
  const evaluation = evaluateAuthorizedPostMergeDefectScope({
    branch: defect.scope.targetBranch,
    changedFiles: currentChangedFiles,
    defect
  });
  if (currentChangedFiles.length === defect.scope.changedFileCount
    && changedFileSetSha256(currentChangedFiles) === defect.scope.changedFileSetSha256) {
    assert.equal(evaluation.pass, true, JSON.stringify(evaluation));
  } else {
    assert.equal(evaluation.pass, false);
    assert.ok([
      'ACV2_POST_MERGE_DEFECT_CHANGED_FILE_SET_MISMATCH',
      'ACV2_POST_MERGE_DEFECT_SCOPE_VIOLATION'
    ].includes(evaluation.reasonCode), JSON.stringify(evaluation));
  }
});
