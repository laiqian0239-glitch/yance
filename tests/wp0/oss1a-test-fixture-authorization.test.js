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
const SUCCESSOR_BRANCH = 'governance/oss-1a-test-fixture-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v9.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v9.json';
const V8_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v8.json';
const EXPECTED_PATH_COUNT = 61;
const EXPECTED_PATH_SET_SHA256 = '899ffe71f12fd721d50e4b65da3e2a147198b6097a23c59ce65e4e575b9e4c96';
const AUTHORIZATION_FILE_SHA256 = '9fa393a97562bbf1280ac6d0778696688c2a9b74f7d5fa64701f4b5c82e66e70';
const AUTHORIZATION_COMMIT = '79efcb4cc2f9fccdbe4a6402ec15f5d5f3c0d51d';
const AUTHORIZATION_BLOB_SHA = 'f2139afb8ee906763f81fbbc8f53e6c126d6f49f';
const ADDED_TEST_PATHS = Object.freeze([
  'backend/tests/oss1aWhatsappRegistrationIdZero.test.js',
  'backend/tests/whatsappCanonicalGuardRegression.test.js'
]);

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

test('OSS-1A registry selects the exact v9 test-fixture authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.workPackage, 'OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v9 adds exactly the two independently restored Task 11 test paths', () => {
  const previous = readJson(V8_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 9);
  assert.equal(authorization.supersedesAuthorizationPath, V8_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '87a855ce63ac1c00c1414fc234234b070a66376c');
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);

  const additions = authorization.exactPaths.filter(value => !previous.exactPaths.includes(value));
  const removals = previous.exactPaths.filter(value => !authorization.exactPaths.includes(value));
  assert.deepEqual(additions, ADDED_TEST_PATHS);
  assert.deepEqual(removals, []);
  assert.deepEqual(authorization.scopeCorrectionEvidence.unauthorizedPaths, ADDED_TEST_PATHS);
  assert.equal(authorization.scopeCorrectionEvidence.temporaryBypassUsed, false);
  assert.equal(authorization.scopeCorrectionEvidence.futureGreenClaimed, false);
});

test('v9 receipt seals the immutable authorization anchor before test reintroduction', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v9 receipt must exist');
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 9);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v9 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');
});

test('v9 implementation branch is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
