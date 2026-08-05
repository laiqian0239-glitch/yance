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
const V10_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V10_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V10_ENTRY]),
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
    registry: V10_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v10 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V10_REGISTRY), true);
});

test('v10 remains the exact four-path runtime delivery root authority', () => {
  const previous = readJson(V9_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V10_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 10);
  assert.equal(authorization.supersedesAuthorizationPath, V9_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(authorization.exactPaths.filter(value => !previous.exactPaths.includes(value)), ADDED_ROOT_PATHS);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
});

test('historical v10 receipt remains bound to its immutable authorization anchor', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V10_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.implementationBaseCommit, '9059cbf1ac94da9f810d6701cb14fd9bceaf3bb5');
});

test('historical v10 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  assert.equal(classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options).role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options).role, 'IMPLEMENTATION_EXECUTABLE');
});
