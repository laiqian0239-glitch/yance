'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  normalizeRepositoryPath,
  filterOpenSourceImplementationChangedFiles,
  changedFileSetSha256,
  isValidOpenSourceWorkPackageAuthorization,
  isValidOpenSourceWorkPackageAuthorizationReceipt,
  isAuthorizedOpenSourceImplementationBranch,
  evaluateAuthorizedOpenSourceWorkPackageScope
} = require('../../shared/release/openSourceWorkPackagePolicy');
const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OSS0_SEALED_IMPLEMENTATION_HEAD = '3b03df415cdb75770d4942648deca8bed202f1ef';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function implementationChangedFiles(receipt, implementationHead = OSS0_SEALED_IMPLEMENTATION_HEAD) {
  git(['cat-file', '-e', `${implementationHead}^{commit}`]);
  git(['merge-base', '--is-ancestor', receipt.authorizationCommit, implementationHead]);
  const output = git([
    '-c',
    'core.quotePath=false',
    'diff',
    '--name-only',
    receipt.authorizationCommit,
    implementationHead,
    '--'
  ]);
  const changedFiles = output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).sort();
  return filterOpenSourceImplementationChangedFiles(changedFiles);
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

  const falseFlags = [
    'wildcardExpansionAllowed',
    'mergeIntoMainAuthorized',
    'productionUseAuthorized',
    'formalRelease',
    'publish',
    'automaticNextWorkPackageAuthorization',
    'temporaryBypassAllowed',
    'warningOnlyClosureAllowed',
    'readyForPromotion'
  ];
  const trueFlags = ['exactPathScopeOnly', 'prMustRemainDraft'];

  for (const flag of falseFlags) {
    const openedAuthorization = {
      ...authorization,
      governance: { ...authorization.governance, [flag]: true }
    };
    assert.equal(isValidOpenSourceWorkPackageAuthorization(openedAuthorization), false, `authorization.${flag}`);

    const openedReceipt = {
      ...receipt,
      governance: { ...receipt.governance, [flag]: true }
    };
    assert.equal(
      isValidOpenSourceWorkPackageAuthorizationReceipt(openedReceipt, authorization),
      false,
      `receipt.${flag}`
    );
  }

  for (const flag of trueFlags) {
    const openedAuthorization = {
      ...authorization,
      governance: { ...authorization.governance, [flag]: false }
    };
    assert.equal(isValidOpenSourceWorkPackageAuthorization(openedAuthorization), false, `authorization.${flag}`);

    const openedReceipt = {
      ...receipt,
      governance: { ...receipt.governance, [flag]: false }
    };
    assert.equal(
      isValidOpenSourceWorkPackageAuthorizationReceipt(openedReceipt, authorization),
      false,
      `receipt.${flag}`
    );
  }

  const reorderedReceipt = {
    ...receipt,
    governance: { ...receipt.governance, authorizationPredatesImplementation: false }
  };
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceipt(reorderedReceipt, authorization), false);
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

test('immutable OSS-0 implementation head matches the exact parent-authorized file set', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const receipt = loadOpenSourceWorkPackageAuthorizationReceipt();
  const changedFiles = implementationChangedFiles(receipt);
  const result = evaluateAuthorizedOpenSourceWorkPackageScope({
    branch: authorization.authorizedBranch,
    changedFiles,
    authorization,
    receipt
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.changedFileCount, authorization.approvedChangedFileCount);
  assert.equal(result.changedFileSetSha256, authorization.approvedChangedFileSetSha256);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
});

test('authorization rejects wildcard expansion, invalid changed paths, changed-file drift, and receipt tampering', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const receipt = loadOpenSourceWorkPackageAuthorizationReceipt();

  const wildcard = {
    ...authorization,
    exactPaths: [...authorization.exactPaths.slice(0, -1), 'tools/**']
  };
  assert.equal(isValidOpenSourceWorkPackageAuthorization(wildcard), false);

  for (const invalidChangedFiles of [
    ['../outside.js'],
    ['backend/duplicate.js', 'backend/duplicate.js'],
    ['tools/*.js'],
    ['C:/Windows/system32/example.js'],
    ['backend/line\nbreak.js']
  ]) {
    const invalid = evaluateAuthorizedOpenSourceWorkPackageScope({
      branch: authorization.authorizedBranch,
      changedFiles: invalidChangedFiles,
      authorization,
      receipt
    });
    assert.equal(invalid.pass, false, JSON.stringify(invalidChangedFiles));
    assert.equal(invalid.reasonCode, 'OSS_WORK_PACKAGE_CHANGED_PATH_INVALID', JSON.stringify(invalidChangedFiles));
  }

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

test('repository path normalization rejects newline-delimited changed-file hash ambiguity', () => {
  assert.equal(normalizeRepositoryPath('backend/line\nbreak.js'), '');
  assert.equal(normalizeRepositoryPath('backend/line\rbreak.js'), '');
});

test('detached OSS evidence HEAD failures retain OSS attribution and work-package details', () => {
  const authorization = loadOpenSourceWorkPackageAuthorization();
  const receipt = loadOpenSourceWorkPackageAuthorizationReceipt();
  const evidenceSourceCommit = 'f'.repeat(40);

  const result = evaluateWorkPackageScopeForGate({
    branch: '',
    evidenceMode: true,
    evidenceSourceCommit,
    openSourceAuthorization: authorization,
    openSourceReceipt: receipt,
    git(args) {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        throw new Error('detached HEAD unavailable');
      }
      throw new Error(`unexpected git command: ${JSON.stringify(args)}`);
    }
  });

  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'OSS_WORK_PACKAGE_SCOPE_EVIDENCE_HEAD_UNAVAILABLE');
  assert.equal(result.effectiveBranch, authorization.authorizedBranch);
  assert.equal(result.openSourceWorkPackageScopeApplied, true);
  assert.equal(result.workPackage, authorization.workPackage);
});
