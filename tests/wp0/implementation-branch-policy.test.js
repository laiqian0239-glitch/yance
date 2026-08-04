'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  loadWorkPackagePostMergeDefect,
  isValidWorkPackageScopeAmendment,
  validateWorkPackageTaskScopeChain,
  isValidWorkPackagePostMergeDefect,
  evaluateAuthorizedWorkPackageScope,
  evaluateAuthorizedWorkPackageTaskScope,
  evaluateAuthorizedPostMergeDefectScope,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');
const { CURRENT_STAGE, currentBranch, checkRuntimeTargetGate } = require('../../tools/wp0/lib');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AUTHORIZATION_PATH = path.join(REPO_ROOT, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const A6_CLOSURE_PATH = path.join(REPO_ROOT, 'governance', 'architecture-closure-v2', 'wp-a-a6-closure.json');
const PARENT_GOVERNANCE_HEAD = 'd81599d8a3f3de891da369b6f1ddbd01e264c78d';
const A6_FROZEN_DIGEST = 'd2cac11bd6864b02e09fa68015dbdba5c41bb2777bf79e821f00a846b651702a';

function authorization() {
  return JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8'));
}

function changedFilesFrom(baseHead, head = 'HEAD') {
  const output = execFileSync('git', [
    '-c',
    'core.quotePath=false',
    'diff',
    '--name-only',
    baseHead,
    head,
    '--'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  return output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).sort();
}

function actualWorkPackageChangedFiles() {
  return changedFilesFrom(PARENT_GOVERNANCE_HEAD);
}

function scopeAmendment(document, changedFiles) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WORK_PACKAGE_SCOPE_AMENDMENT',
    status: 'APPROVED_INDEPENDENT_REVIEW_SCOPE_AMENDMENT',
    repository: document.repository,
    workPackage: document.currentAuthorizedWorkPackage,
    task: 'A6_INDEPENDENT_ROOT_REPAIR_AND_GOVERNANCE_SCOPE_CLOSURE',
    authorizedBranch: document.authorizedBranch,
    pullRequest: 5,
    baseAuthorizationPath: 'governance/architecture-closure-v2/implementation-plan-authorization.json',
    baseAuthorizationBlobSha: '203697b36c06e0dc72c92113ef58f1a8f2394312',
    parentGovernanceHead: PARENT_GOVERNANCE_HEAD,
    approvedChangedFileCount: changedFiles.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(changedFiles),
    additionalAllowedPaths: [
      'backend/runtime/AppRuntime.js',
      'tools/wp0/lib.js'
    ],
    governance: {
      exactPathExpansionOnly: true,
      wildcardExpansionAllowed: false,
      prMustRemainDraft: true,
      automaticNextTaskAuthorization: false,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    }
  };
}

test('canonical Stage6 branch remains authorized without permitting rewrite aliases', () => {
  const branch = canonicalStageBranch(CURRENT_STAGE);
  assert.equal(branch, 'stage/6.4.5.9-architecture-closure');
  assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE), true);
  assert.equal(isAuthorizedImplementationBranch(`${branch}-copy`, CURRENT_STAGE), false);
});

test('dated Windows release-closure rebuild branches are authorized', () => {
  assert.equal(isReleaseClosureRebuildBranch('rebuild/windows-release-closure-20260712'), true);
  assert.equal(isReleaseClosureRebuildBranch('rebuild/windows-release-closure-20260712-gate-fix'), true);
  assert.equal(isAuthorizedImplementationBranch('rebuild/windows-release-closure-20260712', CURRENT_STAGE), true);
});

test('exact machine-authorized ACV2 work-package branch is accepted without a wildcard', () => {
  const document = authorization();
  const exact = document.authorizedBranch;
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: document }), true);
  assert.match(
    authorizedImplementationBranchDescription(CURRENT_STAGE, { authorization: document }),
    new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );

  for (const branch of [
    'acv2/wp-a-arbitrary',
    'acv2/wp-b-durable-execution-outbox',
    `${exact}-copy`,
    'acv2/wp-a/escape'
  ]) assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE, { authorization: document }), false, branch);

  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: { ...document, schemaVersion: 99 } }), false);
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: { ...document, status: 'REVOKED' } }), false);
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, {
    authorization: { ...document, governance: { ...document.governance, automaticNextWorkPackageAuthorization: true } }
  }), false);
});

test('historical A6 amendment remains immutable and independently valid', () => {
  const document = authorization();
  const amendment = loadWorkPackageScopeAmendment();
  assert.ok(amendment, 'historical A6 scope amendment must exist');
  assert.equal(isValidWorkPackageScopeAmendment(amendment, document), true);
  assert.equal(amendment.approvedChangedFileCount, 83);
  assert.equal(amendment.approvedChangedFileSetSha256, A6_FROZEN_DIGEST);
  assert.equal(amendment.governance.readyForPromotion, false);
});

test('work-package scope requires an exact independently reviewed amendment', () => {
  assert.equal(typeof evaluateAuthorizedWorkPackageScope, 'function');
  assert.equal(typeof workPackageChangedFilesSha256, 'function');
  const document = authorization();
  const changedFiles = [
    'backend/runtime/AppRuntimeFactory.js',
    'backend/runtime/AppRuntime.js',
    'tools/wp0/lib.js'
  ];

  const withoutAmendment = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: null
  });
  assert.equal(withoutAmendment.pass, false);
  assert.deepEqual(withoutAmendment.unauthorizedPaths, [
    'backend/runtime/AppRuntime.js',
    'tools/wp0/lib.js'
  ]);

  const approved = scopeAmendment(document, changedFiles);
  const accepted = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: approved
  });
  assert.equal(accepted.pass, true);
  assert.deepEqual(accepted.unauthorizedPaths, []);

  const unknownPath = 'backend/runtime/UnreviewedWriter.js';
  const expanded = [...changedFiles, unknownPath];
  const unknownResult = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles: expanded,
    authorization: document,
    amendment: {
      ...approved,
      approvedChangedFileCount: expanded.length,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(expanded)
    }
  });
  assert.equal(unknownResult.pass, false);
  assert.deepEqual(unknownResult.unauthorizedPaths, [unknownPath]);

  const wildcardExpansion = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, additionalAllowedPaths: ['backend/**'] }
  });
  assert.equal(wildcardExpansion.reasonCode, 'ACV2_SCOPE_AMENDMENT_INVALID');

  const wrongParent = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, parentGovernanceHead: 'f'.repeat(40) }
  });
  assert.equal(wrongParent.reasonCode, 'ACV2_SCOPE_AMENDMENT_INVALID');

  const wrongCount = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, approvedChangedFileCount: changedFiles.length + 1 }
  });
  assert.equal(wrongCount.reasonCode, 'ACV2_CHANGED_FILE_SET_MISMATCH');
});

test('checked-out scope preserves immutable A8 closure and validates its sealed post-close defect head', () => {
  const document = authorization();
  const chain = loadWorkPackageTaskScopeChain();
  assert.ok(chain, 'task scope chain must exist and parse as JSON');
  assert.equal(validateWorkPackageTaskScopeChain(chain, document), true);
  assert.equal(chain.activeTask, 'A8');
  assert.equal(chain.status, 'A8_CLOSED');

  const closure = JSON.parse(fs.readFileSync(A6_CLOSURE_PATH, 'utf8'));
  assert.equal(closure.task, 'A6');
  assert.equal(closure.status, 'CLOSED');
  assert.equal(closure.frozenEvidenceBranchTip, chain.tasks[0].evidenceBranchTip);
  assert.equal(closure.governance.readyForPromotion, false);

  const defect = loadWorkPackagePostMergeDefect();
  if (defect && isValidWorkPackagePostMergeDefect(defect)) {
    const reviewedHead = String(defect.closureReceipt?.reviewedCodeHead || '');
    assert.match(reviewedHead, /^[a-f0-9]{40}$/u);
    execFileSync('git', ['cat-file', '-e', `${reviewedHead}^{commit}`], { cwd: REPO_ROOT });
    execFileSync('git', ['merge-base', '--is-ancestor', defect.scope.baseHead, reviewedHead], {
      cwd: REPO_ROOT
    });
    const changedFiles = changedFilesFrom(defect.scope.baseHead, reviewedHead);
    const result = evaluateAuthorizedPostMergeDefectScope({
      branch: defect.scope.targetBranch,
      changedFiles,
      defect
    });
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.defectId, 'WP-A-POST-MERGE-DEFECT-001');
    assert.equal(result.changedFileSetSha256, defect.scope.approvedChangedFileSetSha256);
    assert.equal(changedFiles.length, defect.scope.approvedChangedFileCount);
    assert.deepEqual(result.unauthorizedPaths, []);
    assert.equal(result.readyForPromotion, true);
    return;
  }

  const changedFiles = actualWorkPackageChangedFiles();
  const result = evaluateAuthorizedWorkPackageTaskScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    taskScopeChain: chain
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.activeTask, 'A8');
  assert.equal(result.changedFileSetSha256, chain.approvedChangedFileSetSha256);
  assert.equal(changedFiles.length, chain.approvedChangedFileCount);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
});

test('malformed, impossible-date and arbitrary branches remain denied', () => {
  for (const branch of [
    'rebuild/windows-release-closure-latest',
    'rebuild/windows-release-closure-20260230',
    'rebuild/windows-release-closure-20260712/escape',
    'feature/windows-release-closure-20260712',
    'main'
  ]) assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE), false, branch);
});

test('current repository branch is authorized and an arbitrary branch fails the WP0 gate', () => {
  assert.equal(checkRuntimeTargetGate({ branch: currentBranch(), changedFiles: [] }).pass, true);
  const denied = checkRuntimeTargetGate({ branch: 'feature/unreviewed-release', changedFiles: [] });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
});