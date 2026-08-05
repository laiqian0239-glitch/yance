'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'shared', 'release', 'openSourceWorkPackagePolicy.js');
const REGISTRY_PATH = path.join(
  ROOT,
  'governance',
  'open-source-acceleration',
  'open-source-work-package-registry.json'
);
const AUTHORIZATION_PATH = path.join(
  ROOT,
  'governance',
  'open-source-acceleration',
  'oss-a-supply-chain-authorization.json'
);

const EXPECTED_SEAL = Object.freeze({
  status: 'SEALED_AFTER_TRUSTED_MERGE',
  pullRequest: 62,
  authorizationCommit: '2f777096738571643d7e15bb9b331699c3ec948c',
  mergeFirstParent: 'bdcc04017fd79a494ba66fad83f762a1c714ff1a',
  mergeSecondParent: '6d8eaae13f902e2186323774778d4d76ee1e9d2f',
  reviewedHead: '6d8eaae13f902e2186323774778d4d76ee1e9d2f',
  authorizationBlobSha: '9901cb3002a0e1d196cb84c7d928764c49220745',
  independentReviewId: 4869624356,
  independentReviewDecision: 'ALLOW_MERGE',
  p0Count: 0,
  p1Count: 0
});

function loadPolicy() {
  delete require.cache[require.resolve(POLICY_PATH)];
  return require(POLICY_PATH);
}

function loadRepositoryAuthority() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const authorization = JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8'));
  return { registry, authorization };
}

function receiptFor(authorization, entry) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT',
    program: authorization.program,
    repository: authorization.repository,
    workPackage: authorization.workPackage,
    status: 'SEALED_FOR_IMPLEMENTATION',
    requiredBaseRef: authorization.requiredBaseRef,
    approvedParentHead: authorization.approvedParentHead,
    authorizedBranch: authorization.authorizedBranch,
    authorizationPath: entry.authorizationPath,
    approvedPlanPath: authorization.approvedPlanPath,
    approvedPlanHead: authorization.approvedPlanHead,
    authorizationCommit: authorization.seal.authorizationCommit,
    authorizationBlobSha: authorization.seal.authorizationBlobSha,
    authorizationFileSha256: 'c'.repeat(64),
    implementationBaseCommit: authorization.seal.authorizationCommit,
    approvedChangedFileCount: authorization.approvedChangedFileCount,
    approvedChangedFileSetSha256: authorization.approvedChangedFileSetSha256,
    governance: {
      authorizationPredatesImplementation: true,
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
      readyForPromotion: false
    }
  };
}

function validOptions(authorization, receipt) {
  const trustedPolicyHead = 'f'.repeat(40);
  return {
    authorizationFileSha256: receipt.authorizationFileSha256,
    trustedPolicyHead,
    resolveCommitBlobSha: commit => commit === authorization.seal.authorizationCommit
      ? authorization.seal.authorizationBlobSha
      : null,
    resolveCommitParents: commit => commit === authorization.seal.authorizationCommit
      ? [authorization.seal.mergeFirstParent, authorization.seal.mergeSecondParent]
      : [],
    isTrustedAncestor: (base, head) => (
      base === authorization.approvedParentHead
        && head === authorization.seal.authorizationCommit
    ) || (
      base === authorization.seal.authorizationCommit
        && head === trustedPolicyHead
    ),
    isAncestor: (base, head) => base === authorization.seal.authorizationCommit
      && head === receipt.implementationBaseCommit
  };
}

test('repository OSS-A authorization records the exact post-merge seal', () => {
  const policy = loadPolicy();
  const { registry, authorization } = loadRepositoryAuthority();
  const entry = policy.selectOpenSourceWorkPackageRegistryEntry(
    registry,
    'oss/a-supply-chain-foundation'
  );

  assert.ok(entry);
  assert.deepEqual(authorization.seal, EXPECTED_SEAL);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(
    authorization,
    entry
  ), true);
});

test('receipt authority is derived from the sealed merge rather than guessed from the pre-merge base', () => {
  const policy = loadPolicy();
  const { registry, authorization } = loadRepositoryAuthority();
  const entry = policy.selectOpenSourceWorkPackageRegistryEntry(
    registry,
    authorization.authorizedBranch
  );
  const receipt = receiptFor(authorization, entry);
  const options = validOptions(authorization, receipt);

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    options
  ), true);

  for (const mutation of [
    { authorizationCommit: '0'.repeat(40), implementationBaseCommit: '0'.repeat(40) },
    { authorizationBlobSha: '1'.repeat(40) },
    { implementationBaseCommit: '2'.repeat(40) }
  ]) {
    assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
      { ...receipt, ...mutation },
      authorization,
      entry,
      options
    ), false, JSON.stringify(mutation));
  }

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { ...options, resolveCommitParents: () => ['3'.repeat(40), authorization.seal.mergeSecondParent] }
  ), false, 'first parent drift must fail closed');

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { ...options, resolveCommitParents: () => [authorization.seal.mergeFirstParent, '4'.repeat(40)] }
  ), false, 'reviewed-head parent drift must fail closed');

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { ...options, isTrustedAncestor: () => false }
  ), false, 'pre-authorization ancestry or trusted-history ancestry drift must fail closed');
});
