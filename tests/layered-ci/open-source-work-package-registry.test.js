'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const policy = require('../../shared/release/openSourceWorkPackagePolicy');

const OSS0_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-0-implementation-authorization.json';
const OSS0_RECEIPT_PATH = 'governance/open-source-acceleration/oss-0-authorization-receipt.json';
const OSS1A_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization.json';
const OSS1A_RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt.json';

function fileSetSha256(paths) {
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

function registry(entries) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
    program: 'Open Source Acceleration',
    repository: 'laiqian0239-glitch/yance',
    entries,
    governance: {
      explicitEntriesOnly: true,
      directoryAutoDiscoveryAllowed: false,
      exactBranchSelectionOnly: true,
      multipleMatchesFailClosed: true,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    }
  };
}

const OSS0_ENTRY = Object.freeze({
  workPackage: 'OSS-0',
  authorizedBranch: 'oss/0-provenance-foundation',
  authorizationPath: OSS0_AUTHORIZATION_PATH,
  receiptPath: OSS0_RECEIPT_PATH
});

const OSS1A_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: 'oss/1a-baileys-lifecycle',
  authorizationPath: OSS1A_AUTHORIZATION_PATH,
  receiptPath: OSS1A_RECEIPT_PATH
});

function oss1aAuthorization() {
  const exactPaths = [
    'backend/migrations/oss1aWhatsappAuthState.js',
    'backend/services/whatsappAdapter.js',
    'backend/services/whatsappAuthStateStore.js'
  ].sort();
  return {
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION',
    program: 'Open Source Acceleration',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'OSS-1A',
    status: 'IMPLEMENTATION_AUTHORIZED',
    authorizedBranch: OSS1A_ENTRY.authorizedBranch,
    requiredBaseRef: 'governance/oss-1a-implementation-authorization',
    approvedParentHead: 'a'.repeat(40),
    approvedPlanPath: 'docs/superpowers/plans/2026-08-04-yance-oss-1a-review-closure-amendment.md',
    approvedPlanHead: 'b'.repeat(40),
    approvedChangedFileCount: exactPaths.length,
    approvedChangedFileSetSha256: fileSetSha256(exactPaths),
    exactPaths,
    governance: closedGovernance()
  };
}

function oss1aReceipt(authorization) {
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
    authorizationPath: OSS1A_ENTRY.authorizationPath,
    approvedPlanPath: authorization.approvedPlanPath,
    approvedPlanHead: authorization.approvedPlanHead,
    authorizationCommit: 'c'.repeat(40),
    authorizationBlobSha: 'd'.repeat(40),
    authorizationFileSha256: 'e'.repeat(64),
    implementationBaseCommit: 'f'.repeat(40),
    approvedChangedFileCount: authorization.approvedChangedFileCount,
    approvedChangedFileSetSha256: authorization.approvedChangedFileSetSha256,
    governance: closedGovernance({ authorizationPredatesImplementation: true })
  };
}

test('policy exposes an explicit multi-work-package registry contract', () => {
  for (const name of [
    'OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH',
    'validateOpenSourceWorkPackageRegistry',
    'selectOpenSourceWorkPackageRegistryEntry',
    'isValidOpenSourceWorkPackageAuthorizationForEntry',
    'isValidOpenSourceWorkPackageAuthorizationReceiptForEntry',
    'resolveOpenSourceAuthorizationForBranch'
  ]) {
    assert.notEqual(policy[name], undefined, `${name} must be exported`);
  }
});

test('registry selects exactly one explicitly registered branch and preserves OSS-0', () => {
  const value = registry([OSS0_ENTRY, OSS1A_ENTRY]);
  assert.equal(policy.validateOpenSourceWorkPackageRegistry(value), true);
  assert.deepEqual(policy.selectOpenSourceWorkPackageRegistryEntry(value, OSS0_ENTRY.authorizedBranch), OSS0_ENTRY);
  assert.deepEqual(policy.selectOpenSourceWorkPackageRegistryEntry(value, OSS1A_ENTRY.authorizedBranch), OSS1A_ENTRY);
  assert.equal(policy.selectOpenSourceWorkPackageRegistryEntry(value, 'oss/unregistered'), null);

  const oss0 = policy.loadOpenSourceWorkPackageAuthorization();
  const receipt = policy.loadOpenSourceWorkPackageAuthorizationReceipt();
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorization(oss0), true);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, oss0), true);
});

test('registry rejects wildcard, duplicate, ambiguous, automatic-discovery and promotion openings', () => {
  const base = registry([OSS0_ENTRY, OSS1A_ENTRY]);
  const invalid = [
    registry([{ ...OSS0_ENTRY, authorizedBranch: 'oss/*' }, OSS1A_ENTRY]),
    registry([OSS0_ENTRY, { ...OSS1A_ENTRY, authorizedBranch: OSS0_ENTRY.authorizedBranch }]),
    registry([OSS0_ENTRY, { ...OSS1A_ENTRY, workPackage: OSS0_ENTRY.workPackage }]),
    registry([OSS0_ENTRY, { ...OSS1A_ENTRY, authorizationPath: 'governance/open-source-acceleration/*.json' }]),
    { ...base, governance: { ...base.governance, explicitEntriesOnly: false } },
    { ...base, governance: { ...base.governance, directoryAutoDiscoveryAllowed: true } },
    { ...base, governance: { ...base.governance, multipleMatchesFailClosed: false } },
    { ...base, governance: { ...base.governance, automaticNextWorkPackageAuthorization: true } },
    { ...base, governance: { ...base.governance, readyForPromotion: true } }
  ];
  for (const candidate of invalid) {
    assert.equal(policy.validateOpenSourceWorkPackageRegistry(candidate), false, JSON.stringify(candidate));
  }
});

test('OSS-1A authorization and receipt validation are entry-bound rather than hard-coded to OSS-0', () => {
  const authorization = oss1aAuthorization();
  const receipt = oss1aReceipt(authorization);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, OSS1A_ENTRY), true);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(receipt, authorization, OSS1A_ENTRY, {
    authorizationFileSha256: receipt.authorizationFileSha256
  }), true);

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry({
    ...authorization,
    authorizedBranch: 'oss/1a-baileys-lifecycle-copy'
  }, OSS1A_ENTRY), false);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry({
    ...authorization,
    workPackage: 'OSS-1B'
  }, OSS1A_ENTRY), false);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry({
    ...receipt,
    authorizationPath: OSS0_AUTHORIZATION_PATH
  }, authorization, OSS1A_ENTRY, {
    authorizationFileSha256: receipt.authorizationFileSha256
  }), false);
});
