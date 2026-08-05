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

test('OSS-1A registry selects the exact v7 async capability authority and receipt paths', () => {
  const entry = currentEntry();
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.workPackage, 'OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v7 adds only the Promise-preserving primary-store capability root repair', () => {
  const previous = readJson(V6_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
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

  assert.equal(authorization.independentRedEvidence.implementationHead, '4a42395b56d730c82cd82774398d46ea0d5f3617');
  assert.equal(authorization.independentRedEvidence.toolingHead, '475eaf106c88d2a51cf85a725ae2b07251f41d1c');
  assert.equal(authorization.independentRedEvidence.workflowRunId, 30971415939);
  assert.equal(authorization.independentRedEvidence.jobId, 92196361537);
  assert.deepEqual({
    tests: authorization.independentRedEvidence.tests,
    passed: authorization.independentRedEvidence.passed,
    failed: authorization.independentRedEvidence.failed
  }, { tests: 24, passed: 21, failed: 3 });
  assert.equal(authorization.independentRedEvidence.rootCause, 'PRIMARY_STORE_CAPABILITY_COLLAPSES_ASYNC_PROMISE');
  assert.equal(authorization.independentRedEvidence.rootPath, ROOT_REPAIR_PATH);
  assert.equal(authorization.independentRedEvidence.futureGreenClaimed, false);
});

test('v7 receipt seals the immutable authorization anchor before the root repair', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v7 receipt must exist');
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);
  const entry = currentEntry();

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 7);
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v6.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
});

test('v7 governance successor remains negative-proof only', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');
});

test('v7 implementation branch is executable only after the receipt exists', () => {
  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
