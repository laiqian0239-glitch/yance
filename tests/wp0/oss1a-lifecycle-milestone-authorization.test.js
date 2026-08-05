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
const SUCCESSOR_BRANCH = 'governance/oss-1a-lifecycle-milestone-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v6.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v6.json';
const V5_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v5.json';
const PLAN_PATH = 'docs/superpowers/plans/2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md';
const PLAN_HEAD = 'c4117bc80b824f0531366c37a0f20bfa9ee0b543';
const EXPECTED_PATH_COUNT = 57;
const EXPECTED_PATH_SET_SHA256 = '6fdd47dbcec9f9e85738ae5dc5e9b6804dc6f7b1d031f5d8395ca7823f27c848';
const AUTHORIZATION_FILE_SHA256 = '813f6e356157422241e87c19ae0dd1d6c8da709c9f427cfb66528d8cefa35d86';
const AUTHORIZATION_COMMIT = '8c2ff8655dc9ee6c51681edd3fac1ad14a9b96b9';
const AUTHORIZATION_BLOB_SHA = 'fb0174aecccec924debe68bf881332bf7e44066c';

const EXPECTED_ADDITIONS = Object.freeze([
  '.github/workflows/oss1a-whatsapp-lifecycle.yml',
  'backend/repositories/messageRepository.js',
  'backend/repositories/whatsappMessageKeyIndexRepository.js',
  'backend/repositories/whatsappMessageRetryRepository.js',
  'backend/services/accountManager.js',
  'backend/services/platformDriverRegistry.js',
  'backend/services/whatsappDisconnectPolicy.js',
  'backend/services/whatsappMessageRetryStore.js',
  'backend/services/whatsappSocketFactory.js',
  'backend/tests/accountLifecycleRegression.test.js',
  'backend/tests/messageIdentityEvidenceOrdering.test.js',
  'backend/tests/oss1aWhatsappDisconnectPolicy.test.js',
  'backend/tests/oss1aWhatsappGetMessage.test.js',
  'backend/tests/oss1aWhatsappReconnectOwnership.test.js',
  'backend/tests/oss1aWhatsappRetryStore.test.js',
  'backend/tests/oss1aWhatsappSocketFactory.test.js',
  'backend/tests/platformProductionReadinessAuthority.test.js',
  'backend/tests/whatsappQrChallenge.test.js',
  'package.json',
  'tests/oss1a/whatsapp-auth-crash-matrix.test.js',
  'tests/oss1a/whatsapp-generation-concurrency-matrix.test.js',
  'tools/oss1a/whatsapp-auth-crash-matrix.js',
  'tools/oss1a/whatsapp-generation-concurrency-matrix.js'
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

test('OSS-1A registry selects the exact v6 milestone authority and receipt paths', () => {
  const registry = loadOpenSourceWorkPackageRegistry();
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.workPackage, 'OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v6 authorizes the remaining Task 7 through Task 10 milestone as one exact scope', () => {
  const previous = readJson(V5_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const registry = loadOpenSourceWorkPackageRegistry();
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 6);
  assert.equal(authorization.supersedesAuthorizationPath, V5_AUTHORIZATION_PATH);
  assert.equal(authorization.authorizedBranch, IMPLEMENTATION_BRANCH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '8c6bac6636afb4b7e7bae6b28f8380b4a099d201');
  assert.equal(authorization.approvedPlanPath, PLAN_PATH);
  assert.equal(authorization.approvedPlanHead, PLAN_HEAD);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);
  assert.equal(repositoryFileSha256(AUTHORIZATION_PATH), AUTHORIZATION_FILE_SHA256);

  const additions = authorization.exactPaths.filter(value => !previous.exactPaths.includes(value));
  const removals = previous.exactPaths.filter(value => !authorization.exactPaths.includes(value));
  assert.deepEqual(additions, [...EXPECTED_ADDITIONS]);
  assert.deepEqual(removals, []);
  assert.equal(authorization.exactPaths.length, previous.exactPaths.length + EXPECTED_ADDITIONS.length);
  assert.deepEqual(authorization.authorizedMilestone.tasks, [7, 8, 9, 10]);
  assert.equal(authorization.authorizedMilestone.authorizationMode, 'SINGLE_MILESTONE_SCOPE');
  assert.equal(authorization.authorizedMilestone.perTaskResealRequired, false);
});

test('v6 records only already-completed Task 6 evidence and no future GREEN claim', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(authorization.priorBatchEvidence.implementationHead, '67ccaf46eb08e5bb7d32db62705c24f9f9884319');
  assert.equal(authorization.priorBatchEvidence.oss1aWorkflowRunId, 30969487388);
  assert.equal(authorization.priorBatchEvidence.oss1aWorkflowStatus, 'SUCCESS');
  assert.equal(authorization.priorBatchEvidence.provenanceWorkflowRunId, 30969487415);
  assert.equal(authorization.priorBatchEvidence.provenanceStatus, 'SUCCESS');
  assert.equal(authorization.priorBatchEvidence.permanentWp0RunId, 30969487429);
  assert.equal(authorization.priorBatchEvidence.permanentWp0Status, 'EXPECTED_IMPLEMENTATION_ROLE_SEAL_RED');
  assert.equal(authorization.priorBatchEvidence.completedScope, 'TASKS_1_THROUGH_6');
  assert.equal(authorization.priorBatchEvidence.futureTaskGreenClaimed, false);
});

test('v6 receipt seals the immutable authorization anchor before milestone implementation', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true, 'v6 receipt must exist');
  const registry = loadOpenSourceWorkPackageRegistry();
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 6);
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v5.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.approvedPlanPath, PLAN_PATH);
  assert.equal(receipt.approvedPlanHead, PLAN_HEAD);
  assert.equal(receipt.authorizationCommit, AUTHORIZATION_COMMIT);
  assert.equal(receipt.authorizationBlobSha, AUTHORIZATION_BLOB_SHA);
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(receipt.governance.authorizationPredatesImplementation, true);
  assert.equal(receipt.governance.implementationBasePredatesReceiptSeal, true);
});

test('v6 governance is negative-proof only while the implementation branch remains executable', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');

  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
