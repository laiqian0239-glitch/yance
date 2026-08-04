'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');

function digest(paths) {
  return crypto.createHash('sha256').update(`${[...paths].sort().join('\n')}\n`, 'utf8').digest('hex');
}

function closedGovernance(extra = {}) {
  return {
    exactPathScopeOnly: true,
    wildcardExpansionAllowed: false,
    prMustRemainDraft: true,
    mergeIntoMainAuthorized: false,
    productionUseAuthorized: false,
    formalRelease: false,
    publish: false,
    automaticNextWorkPackageAuthorization: false,
    temporaryBypassAllowed: false,
    warningOnlyClosureAllowed: false,
    readyForPromotion: false,
    ...extra
  };
}

const entry = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: 'oss/1a-baileys-lifecycle',
  authorizationPath: 'governance/open-source-acceleration/oss-1a-implementation-authorization.json',
  receiptPath: 'governance/open-source-acceleration/oss-1a-authorization-receipt.json'
});

const registry = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: [entry],
  governance: {
    explicitEntriesOnly: true,
    directoryAutoDiscoveryAllowed: false,
    exactBranchSelectionOnly: true,
    multipleMatchesFailClosed: true,
    automaticNextWorkPackageAuthorization: false,
    readyForPromotion: false
  }
});

const exactPaths = Object.freeze([
  'backend/services/whatsappAdapter.js',
  'backend/services/whatsappAuthStateStore.js'
]);
const authorizationCommit = 'a'.repeat(40);
const implementationBaseCommit = 'b'.repeat(40);
const authorizationBlobSha = 'c'.repeat(40);
const authorizationFileSha256 = 'd'.repeat(64);

const authorization = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  workPackage: entry.workPackage,
  status: 'IMPLEMENTATION_AUTHORIZED',
  authorizedBranch: entry.authorizedBranch,
  requiredBaseRef: 'governance/oss-1a-implementation-authorization',
  approvedParentHead: 'e'.repeat(40),
  approvedPlanPath: 'docs/superpowers/plans/2026-08-04-yance-oss-1a-review-closure-amendment.md',
  approvedPlanHead: 'f'.repeat(40),
  approvedChangedFileCount: exactPaths.length,
  approvedChangedFileSetSha256: digest(exactPaths),
  exactPaths,
  governance: closedGovernance()
});

const receipt = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT',
  program: authorization.program,
  repository: authorization.repository,
  workPackage: authorization.workPackage,
  status: 'SEALED_FOR_IMPLEMENTATION',
  requiredBaseRef: authorization.requiredBaseRef,
  approvedParentHead: authorization.approvedParentHead,
  approvedPlanPath: authorization.approvedPlanPath,
  approvedPlanHead: authorization.approvedPlanHead,
  authorizedBranch: authorization.authorizedBranch,
  authorizationPath: entry.authorizationPath,
  authorizationCommit,
  authorizationBlobSha,
  authorizationFileSha256,
  implementationBaseCommit,
  approvedChangedFileCount: authorization.approvedChangedFileCount,
  approvedChangedFileSetSha256: authorization.approvedChangedFileSetSha256,
  governance: closedGovernance({ authorizationPredatesImplementation: true })
});

function gitRecorder() {
  const calls = [];
  const git = args => {
    calls.push(args);
    if (args[0] === 'status') return '';
    if (args[0] === 'cat-file') return '';
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'rev-parse' && args[1] === `${authorizationCommit}:${entry.authorizationPath}`) return authorizationBlobSha;
    if (args[0] === '-c' && args.includes('diff')) return `${exactPaths.join('\n')}\n`;
    throw new Error(`unexpected git call ${JSON.stringify(args)}`);
  };
  return { git, calls };
}

test('scope gate resolves the exact OSS-1A registry entry without defaulting to OSS-0', () => {
  const { git, calls } = gitRecorder();
  const result = evaluateWorkPackageScopeForGate({
    branch: entry.authorizedBranch,
    git,
    openSourceRegistry: registry,
    openSourceAuthorizationByPath: { [entry.authorizationPath]: authorization },
    openSourceReceiptByPath: { [entry.receiptPath]: receipt },
    openSourceAuthorizationFileSha256ByPath: { [entry.authorizationPath]: authorizationFileSha256 }
  });

  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.workPackage, 'OSS-1A');
  assert.equal(result.effectiveBranch, entry.authorizedBranch);
  assert.equal(result.parentGovernanceHead, implementationBaseCommit);
  assert.equal(result.changedFileSetSha256, authorization.approvedChangedFileSetSha256);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
  assert.equal(calls.some(args => args[0] === '-c' && args.includes(implementationBaseCommit)), true);
  assert.equal(calls.some(args => args[0] === '-c' && args.includes(authorizationCommit)), false);
});

test('scope gate fails closed when implementationBaseCommit is missing or not an ancestor', () => {
  const missing = evaluateWorkPackageScopeForGate({
    branch: entry.authorizedBranch,
    git: gitRecorder().git,
    openSourceRegistry: registry,
    openSourceAuthorizationByPath: { [entry.authorizationPath]: authorization },
    openSourceReceiptByPath: { [entry.receiptPath]: { ...receipt, implementationBaseCommit: undefined } },
    openSourceAuthorizationFileSha256ByPath: { [entry.authorizationPath]: authorizationFileSha256 }
  });
  assert.equal(missing.pass, false);
  assert.equal(missing.reasonCode, 'OSS_WORK_PACKAGE_AUTHORIZATION_INVALID');

  const { git } = gitRecorder();
  const notAncestor = evaluateWorkPackageScopeForGate({
    branch: entry.authorizedBranch,
    git(args) {
      if (args[0] === 'merge-base' && args.includes(implementationBaseCommit)) throw new Error('not ancestor');
      return git(args);
    },
    openSourceRegistry: registry,
    openSourceAuthorizationByPath: { [entry.authorizationPath]: authorization },
    openSourceReceiptByPath: { [entry.receiptPath]: receipt },
    openSourceAuthorizationFileSha256ByPath: { [entry.authorizationPath]: authorizationFileSha256 }
  });
  assert.equal(notAncestor.pass, false);
  assert.equal(notAncestor.reasonCode, 'OSS_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE');
});

test('unregistered governance branch never inherits executable OSS implementation authority', () => {
  const result = evaluateWorkPackageScopeForGate({
    branch: 'governance/oss-1a-implementation-authorization',
    git: gitRecorder().git,
    openSourceRegistry: registry,
    openSourceAuthorizationByPath: { [entry.authorizationPath]: authorization },
    openSourceReceiptByPath: { [entry.receiptPath]: receipt },
    openSourceAuthorizationFileSha256ByPath: { [entry.authorizationPath]: authorizationFileSha256 }
  });
  assert.equal(result.applicable, false, JSON.stringify(result));
  assert.equal(result.pass, true);
  assert.equal(result.openSourceWorkPackageScopeApplied, false);
  assert.equal(result.readyForPromotion, false);
});
