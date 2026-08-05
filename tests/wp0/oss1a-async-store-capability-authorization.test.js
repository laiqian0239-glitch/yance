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
const SUCCESSOR_BRANCH = 'governance/oss-1a-async-store-capability-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v7.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v7.json';
const V6_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v6.json';
const PLAN_PATH = 'docs/superpowers/plans/2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md';
const PLAN_HEAD = 'c4117bc80b824f0531366c37a0f20bfa9ee0b543';
const EXPECTED_PATH_COUNT = 58;
const EXPECTED_PATH_SET_SHA256 = 'f618d0985bce4d36291243c05dcb7e09f4772ad9417a4d1aa269f6b936361e4c';
const AUTHORIZATION_FILE_SHA256 = 'b1096f10819f266c30063e97c1cd8f690f192241183260dec86eea16d015028d';
const AUTHORIZATION_COMMIT = '12679f42768c49528cc6842fcc2dde2c4abb3f77';
const AUTHORIZATION_BLOB_SHA = '8ca9a985e28c30987f53d8297274c0056a65b4c7';
const ROOT_REPAIR_PATH = 'backend/repositories/storeProvider.js';

const V7_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V7_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V7_ENTRY]),
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
    registry: V7_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v7 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V7_REGISTRY), true);
  assert.equal(V7_ENTRY.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(V7_ENTRY.receiptPath, RECEIPT_PATH);
});

test('v7 adds only the Promise-preserving primary-store capability root repair', () => {
  const previous = readJson(V6_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V7_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 7);
  assert.equal(authorization.supersedesAuthorizationPath, V6_AUTHORIZATION_PATH);
  assert.equal(authorization.authorizedBranch, IMPLEMENTATION_BRANCH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '68f380dbeef3da4eb7731bf1405313347ec6d8d8');
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
  assert.equal(authorization.authorizedMilestone.rootRepairAmendment, 'PRESERVE_ASYNC_STORE_CAPABILITY_PROMISE');
  assert.equal(authorization.independentRedEvidence.rootCause, 'PRIMARY_STORE_CAPABILITY_COLLAPSES_ASYNC_PROMISE');
  assert.equal(authorization.independentRedEvidence.rootPath, ROOT_REPAIR_PATH);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('historical v7 receipt remains bound to its immutable authorization anchor', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V7_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 7);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.equal(receipt.implementationBaseCommit, '13d968920b787e43698f7485adf1914d5a0c7609');
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('historical v7 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
});
