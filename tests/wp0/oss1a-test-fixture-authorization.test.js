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
const V9_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V9_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V9_ENTRY]),
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
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')))).digest('hex');
}
function historicalRoleOptions() {
  return {
    registry: V9_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v9 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V9_REGISTRY), true);
});

test('v9 adds exactly the two independently restored Task 11 test paths', () => {
  const previous = readJson(V8_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V9_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 9);
  assert.equal(authorization.supersedesAuthorizationPath, V8_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(authorization.exactPaths.filter(value => !previous.exactPaths.includes(value)), ADDED_TEST_PATHS);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
});

test('historical v9 receipt remains bound to its immutable authorization anchor', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V9_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.implementationBaseCommit, '60076b86ba411b8298ce5cff327aed5b19fa1b29');
});

test('historical v9 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  assert.equal(classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options).role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options).role, 'IMPLEMENTATION_EXECUTABLE');
});
