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
const SUCCESSOR_BRANCH = 'governance/oss-1a-uat-diagnostics-runtime-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v11.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v11.json';
const V10_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v10.json';
const EXPECTED_PATH_COUNT = 71;
const EXPECTED_PATH_SET_SHA256 = '1066e8c30e1dc29f62f5ddac59bc33a6df0780b576cf82dc4b4c5961185f6506';
const AUTHORIZATION_FILE_SHA256 = 'e2c9b7ee2f20057901a43b713199287528144b46e4d1920c7f9088ede73d1450';
const AUTHORIZATION_COMMIT = '530671bbd4d1db8718cfbd9fa584b1db9bfde5df';
const AUTHORIZATION_BLOB_SHA = 'fdff206ac24ccc6dba4c188fcc219501060e7882';
const ADDED_ROOT_PATHS = Object.freeze([
  'requirements/uat-playwright.txt',
  'tests/uat/f25WindowsUatRepairBatch20AiUxReadability.test.js',
  'tests/uat/fix6dRuntimeAuthorityIndependentAudit.test.js',
  'tests/uat/fix6dRuntimeAuthorityRepair.test.js',
  'tests/uat/helpers/authoritySqliteTestHost.js',
  'tests/uat/modelRegistryFactSeparation.test.js'
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

test('OSS-1A registry selects the exact v11 UAT diagnostics authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v11 adds exactly the six independently proven UAT diagnostics runtime paths', () => {
  const previous = readJson(V10_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 11);
  assert.equal(authorization.supersedesAuthorizationPath, V10_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '82bc44d648c16eb7c454063a1bd36636bfa53d75');
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(authorization.exactPaths.filter(value => !previous.exactPaths.includes(value)), ADDED_ROOT_PATHS);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
  assert.deepEqual(authorization.independentRedEvidence.rootPaths, ADDED_ROOT_PATHS);
  assert.equal(authorization.independentRedEvidence.failureGroups.pythonPlaywrightRuntimeMissing.failed, 20);
  assert.equal(authorization.independentRedEvidence.failureGroups.sqliteAuthorityHostMissing.failed, 6);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('v11 receipt seals the immutable authorization anchor before runtime repair', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v11 receipt must exist');
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  const entry = currentEntry();
  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 11);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v11 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
});

test('v11 implementation branch is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
});
