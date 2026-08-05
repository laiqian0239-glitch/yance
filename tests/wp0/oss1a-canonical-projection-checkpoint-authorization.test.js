'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  changedFileSetSha256,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  loadOpenSourceWorkPackageRegistry,
  selectOpenSourceWorkPackageRegistryEntry
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

function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}
function repositoryFileSha256(repositoryPath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/'))))
    .digest('hex');
}
function currentEntry() {
  const registry = loadOpenSourceWorkPackageRegistry();
  return selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);
}

test('OSS-1A registry selects the exact v8 canonical checkpoint authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.workPackage, 'OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v8 adds only the canonical projection checkpoint hash root path', () => {
  const previous = readJson(V7_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
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
  assert.equal(authorization.independentRedEvidence.implementationHead, '3be359911440e38b4e587b19e0918aebe1c3c41a');
  assert.equal(authorization.independentRedEvidence.toolingHead, '0f080bc51247a0380df15eeb7b387ee193b5f00f');
  assert.equal(authorization.independentRedEvidence.workflowRunId, 31012776739);
  assert.equal(authorization.independentRedEvidence.jobId, 92328975873);
  assert.equal(authorization.independentRedEvidence.rootCause, 'CANONICAL_FAILED_PROJECTION_CHECKPOINT_OUTPUT_HASH_EMPTY');
  assert.equal(authorization.independentRedEvidence.rootPath, ROOT_REPAIR_PATH);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('v8 receipt seals the immutable authorization anchor before the root repair', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v8 receipt must exist');
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 8);
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v7.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v8 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');
});

test('v8 implementation branch is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
