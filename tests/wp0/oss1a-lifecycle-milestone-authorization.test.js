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
const SUCCESSOR_BRANCH = 'governance/oss-1a-lifecycle-milestone-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v6.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v6.json';
const V5_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v5.json';
const EXPECTED_PATH_COUNT = 57;
const EXPECTED_PATH_SET_SHA256 = '6fdd47dbcec9f9e85738ae5dc5e9b6804dc6f7b1d031f5d8395ca7823f27c848';
const AUTHORIZATION_FILE_SHA256 = '813f6e356157422241e87c19ae0dd1d6c8da709c9f427cfb66528d8cefa35d86';

const V6_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V6_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V6_ENTRY]),
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
    registry: V6_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v6 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V6_REGISTRY), true);
  assert.equal(V6_ENTRY.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(V6_ENTRY.receiptPath, RECEIPT_PATH);
});

test('v6 remains the exact 57-path Task 7 through Task 10 milestone authority', () => {
  const previous = readJson(V5_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V6_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 6);
  assert.equal(authorization.supersedesAuthorizationPath, V5_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
  assert.deepEqual(authorization.authorizedMilestone.tasks, [7, 8, 9, 10]);
  assert.equal(authorization.authorizedMilestone.perTaskResealRequired, false);
  assert.equal(authorization.priorBatchEvidence.futureTaskGreenClaimed, false);
});

test('historical v6 receipt remains bound to its frozen authorization snapshot', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V6_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 6);
  assert.equal(receipt.authorizationCommit, '8c2ff8655dc9ee6c51681edd3fac1ad14a9b96b9');
  assert.equal(receipt.authorizationBlobSha, 'fb0174aecccec924debe68bf881332bf7e44066c');
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.implementationBaseCommit, '95a071f941bc5d2fafaa07b266d9c66156f0e6c9');
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('historical v6 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
});
