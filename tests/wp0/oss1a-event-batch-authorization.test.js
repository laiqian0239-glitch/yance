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
const SUCCESSOR_BRANCH = 'governance/oss-1a-event-batch-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v5.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v5.json';
const PLAN_PATH = 'docs/superpowers/plans/2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md';
const PLAN_HEAD = 'c4117bc80b824f0531366c37a0f20bfa9ee0b543';
const V4_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v4.json';
const EXPECTED_ADDITIONS = Object.freeze([
  'backend/services/whatsappBaileysEventProcessor.js',
  'backend/tests/oss1aWhatsappEventBatch.test.js',
  'backend/tests/whatsappReceiptRecoveryRegression.test.js'
]);
const EXPECTED_PATH_COUNT = 34;
const EXPECTED_PATH_SET_SHA256 = '91bb32095cfbbb4d4bbf149314a4079326467be2dc55354a054d3dffe94e1f5f';
const AUTHORIZATION_FILE_SHA256 = '07b6f86ee76c91b9187f217e67eec62bc46c7370c71a7228a371fe3ffaccc311';

const V5_ENTRY = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: IMPLEMENTATION_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: RECEIPT_PATH
});
const V5_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: Object.freeze([V5_ENTRY]),
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
    registry: V5_REGISTRY,
    authorizationByPath: { [AUTHORIZATION_PATH]: readJson(AUTHORIZATION_PATH) },
    receiptByPath: { [RECEIPT_PATH]: readJson(RECEIPT_PATH) },
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: candidate => candidate === IMPLEMENTATION_BRANCH
  };
}

test('historical v5 registry snapshot remains valid after successor selection changes', () => {
  assert.equal(validateOpenSourceWorkPackageRegistry(V5_REGISTRY), true);
  assert.equal(V5_ENTRY.workPackage, 'OSS-1A');
  assert.equal(V5_ENTRY.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(V5_ENTRY.receiptPath, RECEIPT_PATH);
});

test('v5 authorization adds only the three independently bounded Task 6 paths', () => {
  const previous = readJson(V4_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, V5_ENTRY), true);
  assert.equal(authorization.authorizationVersion, 5);
  assert.equal(authorization.supersedesAuthorizationPath, V4_AUTHORIZATION_PATH);
  assert.equal(authorization.authorizedBranch, IMPLEMENTATION_BRANCH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '6f0d48e25941236a3f07327a18387b979bb5e776');
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
  assert.equal(authorization.exactPaths.length, previous.exactPaths.length + 3);

  assert.equal(authorization.independentRedEvidence.implementationHead, '244af093cc04a70e12f4a902cb06bd8764982615');
  assert.equal(authorization.independentRedEvidence.oss1aWorkflowRunId, 30966660649);
  assert.equal(authorization.independentRedEvidence.runtimeJobId, 92181976250);
  assert.deepEqual(
    {
      total: authorization.independentRedEvidence.tests,
      passed: authorization.independentRedEvidence.passed,
      failed: authorization.independentRedEvidence.failed
    },
    { total: 60, passed: 50, failed: 10 }
  );
  assert.deepEqual(authorization.independentRedEvidence.failureClassification, {
    missingProductionProcessor: 6,
    missingAdapterBatchRegistration: 1,
    testHarnessDefectsToCorrectBeforeGreen: 3
  });
});

test('v5 receipt remains bound to its frozen authorization snapshot', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...RECEIPT_PATH.split('/'))), true);
  const authorization = readJson(AUTHORIZATION_PATH);
  const receipt = readJson(RECEIPT_PATH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    V5_ENTRY,
    { authorizationFileSha256: repositoryFileSha256(AUTHORIZATION_PATH) }
  ), true);
  assert.equal(receipt.authorizationVersion, 5);
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v4.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.approvedPlanPath, PLAN_PATH);
  assert.equal(receipt.approvedPlanHead, PLAN_HEAD);
  assert.equal(receipt.authorizationCommit, '15c2ed3de7b772fb0e383d2282b666863785671b');
  assert.equal(receipt.authorizationBlobSha, '21cc1d0fb116d9a19af5134a19e0561f92a647e1');
  assert.equal(receipt.authorizationFileSha256, AUTHORIZATION_FILE_SHA256);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit);
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(receipt.governance.authorizationPredatesImplementation, true);
  assert.equal(receipt.governance.implementationBasePredatesReceiptSeal, true);
});

test('historical v5 governance and implementation roles remain self-contained', () => {
  const options = historicalRoleOptions();
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH, options);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');

  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH, options);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
