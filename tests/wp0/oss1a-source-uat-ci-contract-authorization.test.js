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
const SUCCESSOR_BRANCH = 'governance/oss-1a-source-uat-ci-contract-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v9.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v9.json';
const V8_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v8.json';
const EXPECTED_PATH_COUNT = 61;
const EXPECTED_PATH_SET_SHA256 = '1c9392e6a48066700ee59d89488acbd0e568ec01ef67df9a6317053aa33dc98f';
const AUTHORIZATION_FILE_SHA256 = '718f87c75f11e9e8d23d611ea1f240715554a692cac8ce41f96555a4f0c5eaee';
const AUTHORIZATION_COMMIT = '1c3bbdfa522f5099a7caf838c4ade5127063a79e';
const AUTHORIZATION_BLOB_SHA = '1860bd8583371bd0e3094cb1beec75ce2174ad3b';
const ROOT_PATHS = Object.freeze([
  'tests/uat/sourceUatP0Preflight.test.js',
  'tools/uat/sourceUatP0Preflight.js'
]);

function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}
function repositoryFileSha256(repositoryPath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')))).digest('hex');
}
function currentEntry() {
  const registry = loadOpenSourceWorkPackageRegistry();
  return selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);
}

test('OSS-1A registry selects the exact v9 Source UAT CI contract authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v9 adds only the deterministic Source UAT CI contract root paths', () => {
  const previous = readJson(V8_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();
  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 9);
  assert.equal(authorization.supersedesAuthorizationPath, V8_AUTHORIZATION_PATH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '87a855ce63ac1c00c1414fc234234b070a66376c');
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);
  assert.deepEqual(authorization.exactPaths.filter(value => !previous.exactPaths.includes(value)), ROOT_PATHS);
  assert.deepEqual(previous.exactPaths.filter(value => !authorization.exactPaths.includes(value)), []);
  assert.equal(authorization.independentRedEvidence.workflowRunId, 31015418752);
  assert.equal(authorization.independentRedEvidence.jobId, 92338094084);
  assert.equal(authorization.independentRedEvidence.rootCause, 'LIVE_EXISTING_DATA_PREFLIGHT_EXECUTED_IN_CLEAN_CI_RUNNER');
  assert.deepEqual(authorization.independentRedEvidence.rootPaths, ROOT_PATHS);
  assert.equal(authorization.independentRedEvidence.workerContractsPassed, true);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('v9 receipt seals the immutable authorization anchor before implementation', () => {
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
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v8.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v9 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');
});

test('v9 implementation role is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
