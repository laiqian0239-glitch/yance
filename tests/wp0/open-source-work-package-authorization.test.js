'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  changedFileSetSha256,
  isValidOpenSourceWorkPackageAuthorization,
  isValidOpenSourceWorkPackageAuthorizationReceipt,
  isAuthorizedOpenSourceImplementationBranch,
  evaluateAuthorizedOpenSourceWorkPackageScope
} = require('../../shared/release/openSourceWorkPackagePolicy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function implementationChangedFiles(authorization) {
  const remoteBase = `refs/remotes/origin/${authorization.requiredBaseRef}`;
  git(['cat-file', '-e', `${remoteBase}^{commit}`]);
  const mergeBase = git(['merge-base', remoteBase, 'HEAD']);
  const output = git(['-c', 'core.quotePath=false', 'diff', '--name-only', mergeBase, 'HEAD', '--']);
  return output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).sort();
}

test('sealed OSS-0 authorization and receipt are internally consistent', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const receipt = loadOpenSourceWorkPackageAuthorizationReceipt();
  assert.equal(isValidOpenSourceWorkPackageAuthorization(authorization), true);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, authorization), true);
  assert.equal(authorization.approvedChangedFileCount, authorization.exactPaths.length);
  assert.equal(authorization.approvedChangedFileSetSha256, changedFileSetSha256(authorization.exactPaths));
  assert.equal(receipt.approvedChangedFileSetSha256, authorization.approvedChangedFileSetSha256);
  assert.equal(receipt.governance.readyForPromotion, false);
  assert.equal(receipt.governance.temporaryBypassAllowed, false);
  assert.equal(receipt.governance.warningOnlyClosureAllowed, false);
});

test('only the exact sealed OSS-0 branch is authorized', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  assert.equal(isAuthorizedOpenSourceImplementationBranch(authorization.authorizedBranch), true);
  for (const branch of [
    'oss/0-provenance-foundation-copy',
    'oss/1-baileys-lifecycle',
    'oss/arbitrary',
    'feature/open-source'
  ]) assert.equal(isAuthorizedOpenSourceImplementationBranch(branch), false, branch);
});

test('checked-out OSS-0 implementation matches the exact parent-authorized file set', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const changedFiles = implementationChangedFiles(authorization);
  const result = evaluateAuthorizedOpenSourceWorkPackageScope({
    branch: authorization.authorizedBranch,
    changedFiles,
    authorization,
    receipt: loadOpenSourceWorkPackageAuthorizationReceipt()
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.changedFileCount, authorization.approvedChangedFileCount);
  assert.equal(result.changedFileSetSha256, authorization.approvedChangedFileSetSha256);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
});

test('authorization rejects wildcard expansion, changed-file drift, and receipt tampering', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const receipt = loadOpenSourceWorkPackageAuthorizationReceipt();

  const wildcard = {
    ...authorization,
    exactPaths: [...authorization.exactPaths.slice(0, -1), 'tools/**']
  };
  assert.equal(isValidOpenSourceWorkPackageAuthorization(wildcard), false);

  const driftedFiles = [...authorization.exactPaths, 'backend/unreviewed.js'].sort();
  const drift = evaluateAuthorizedOpenSourceWorkPackageScope({
    branch: authorization.authorizedBranch,
    changedFiles: driftedFiles,
    authorization,
    receipt
  });
  assert.equal(drift.pass, false);
  assert.equal(drift.reasonCode, 'OSS_WORK_PACKAGE_CHANGED_FILE_SET_MISMATCH');
  assert.deepEqual(drift.unauthorizedPaths, ['backend/unreviewed.js']);

  const tamperedReceipt = {
    ...receipt,
    authorizationFileSha256: '0'.repeat(64)
  };
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceipt(tamperedReceipt, authorization), false);
  assert.equal(isAuthorizedOpenSourceImplementationBranch(authorization.authorizedBranch, {
    authorization,
    receipt: tamperedReceipt
  }), false);
});
