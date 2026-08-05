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
const SUCCESSOR_BRANCH = 'governance/oss-1a-runtime-delivery-contract-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v10.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v10.json';
const V9_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v9.json';
const EXPECTED_PATH_COUNT = 65;
const EXPECTED_PATH_SET_SHA256 = 'fc827fcf2329b91072065b2276164c76283e65c959e65699dabbe28988e6599e';
const AUTHORIZATION_FILE_SHA256 = '4ba008c5ba823025ca1935e22e8c56880ec6139f9bcd971ad42a853cbd71f6d4';
const AUTHORIZATION_COMMIT = '04eaa4f03fec1ee5e1ac53c59afc2aa2a5d44985';
const AUTHORIZATION_BLOB_SHA = '23a25d565cc0e5fa3df576de5e87379bb97739dd';
const ADDED_ROOT_PATHS = Object.freeze([
  '.gitattributes',
  'tests/runtime-delivery/fix6d-v5-source-checkpoint-identity.test.js',
  'tests/runtime-delivery/source-uat-delivery.test.js',
  'tools/runtime-delivery/source-uat-delivery.js'
]);
function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}
function repositoryFileSha256(repositoryPath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')))).digest('hex');
}
function currentEntry() {
  return selectOpenSourceWorkPackageRegistryEntry(loadOpenSourceWorkPackageRegistry(), IMPLEMENTATION_BRANCH);
}

test('OSS-1A registry selects the exact v10 runtime delivery authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v10 adds exactly the four independently proven runtime delivery root paths', () => {
  const previous = readJson(V9_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 10);
  assert.equal(authorization.supersedesAuthorizationPath, V9_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '136ae6b356b9cfa0fa2cb4b11aced2eba17996b1');
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(authorization.exactPaths.filter(value => !previous.exactPaths.includes(value)), ADDED_ROOT_PATHS);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
  assert.deepEqual(authorization.independentRedEvidence.rootPaths, ADDED_ROOT_PATHS);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('v10 receipt seals the immutable authorization anchor before root implementation', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v10 receipt must exist');
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  const entry = currentEntry();
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 10);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v10 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
});

test('v10 implementation branch is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
});
