'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  changedFileSetSha256,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  validateOpenSourceWorkPackageRegistry
} = require('../../shared/release/openSourceWorkPackagePolicy');
const { classifyProductRouteBranchRole } = require('../../tools/wp0/product-route-executable-policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUCCESSOR_BRANCH = 'governance/oss-1a-canonical-projection-checkpoint-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v8.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v8.json';
const V7_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v7.json';
const PLAN_PATH = 'docs/superpowers/plans/2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md';
const PLAN_HEAD = 'c4117bc80b824f0531366c37a0f20bfa9ee0b543';
const EXPECTED_PATH_COUNT = 59;
const EXPECTED_PATH_SET_SHA256 = '884491c04f381d0d8b6d81635ab12bf4fad3d6fa62b68fd0ec47c9f6b9c57b05';
const AUTHORIZATION_FILE_SHA256 = '96597ced5e72fbc454b91b1a6fbe2a3e051dde18614045ed0c7a34a9afc46a19';
const AUTHORIZATION_COMMIT = '726eef867d79222e6a8e96600352792304917661';
const AUTHORIZATION_BLOB_SHA = '2d15556c84d25867bf7b07d4c8ae4abacfebbf23';
const ROOT_REPAIR_PATH = 'backend/repositories/platformCoreRepository.js';

const V8_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V8_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V8_ENTRY]),
  governance: Object.freeze({
    explicitEntriesOnly: true,
    directoryAutoDiscoveryAllowed: false,
    exactBranchSelectionOnly: true,
    multipleMatchesFailClosed: true,
    automaticNextWorkPackageAuthorization: false,
    readyForPromotion: false
  })
});

function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}
function repositoryFileSha256(repositoryPath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/'))))
    .digest('hex');
}
function historicalRoleOptions() {
  return {
    registry: V8_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v8 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V8_REGISTRY), true);
  assert.equal(V8_ENTRY.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(V8_ENTRY.receiptPath, RECEIPT_PATH);
});

test('v8 adds only the canonical projection checkpoint hash root path', () => {
  const previous = readJson(V7_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V8_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 8);
  assert.equal(authorization.supersedesAuthorizationPath, V7_AUTHORIZATION_PATH);
  assert.equal(authorization.authorizedBranch, IMPLEMENTATION_BRANCH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, 'daf41b660dc2c7186b7a920911b0c791fe475e4c');
  assert.equal(authorization.approvedPlanPath, PLAN_PATH);
  assert.equal(authorization.approvedPlanHead, PLAN_HEAD);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);

  const additions = authorization.exactPaths.filter(value => !previous.exactPaths.includes(value));
  const removals = previous.exactPaths.filter(value => !authorization.exactPaths.includes(value));
  assert.deepEqual(additions, [ROOT_REPAIR_PATH]);
  assert.deepEqual(removals, []);
  assert.equal(authorization.exactPaths.length, previous.exactPaths.length + 1);
  assert.equal(authorization.authorizedMilestone.rootRepairAmendment, 'DERIVE_CANONICAL_CHECKPOINT_OUTPUT_HASH_FOR_NON_APPLIED_RECEIPTS');
  assert.equal(authorization.independentRedEvidence.rootCause, 'CANONICAL_FAILED_PROJECTION_CHECKPOINT_OUTPUT_HASH_EMPTY');
  assert.equal(authorization.independentRedEvidence.rootPath, ROOT_REPAIR_PATH);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('historical v8 receipt remains bound to its immutable authorization anchor', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V8_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 8);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.implementationBaseCommit, '4a9b277cb2d0301c69a056070b3c6808622ef069');
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('historical v8 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
});
