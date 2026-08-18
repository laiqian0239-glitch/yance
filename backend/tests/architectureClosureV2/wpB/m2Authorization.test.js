'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const receiptPath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-m2-authorization.json'
);
const verifierPath = path.join(
  repoRoot,
  'tools',
  'architecture-closure-v2',
  'verify-wp-b-m2-authorization.js'
);
const redEvidenceReceiptPath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-m2-red-evidence.json'
);
const redEvidenceVerifierPath = path.join(
  repoRoot,
  'tools',
  'architecture-closure-v2',
  'capture-wp-b-m2-red-evidence.js'
);
const authorityModulePath = path.join(
  repoRoot,
  'shared',
  'release',
  'acv2ActiveWorkPackageAuthority.js'
);

const EXPECTED_PARENT_SEAL_HEAD = '1e3d600f0647af35e737ff92a200c67e69224c82';
const EXPECTED_RED_EVIDENCE_HEAD = '636d6feebaad4a49171750f4ec5f64bde12872fc';
const EXPECTED_RED_WORKFLOW_RUN_ID = 30837837145;
const EXPECTED_RED_FILE_SET_SHA256 = '46e2eb53e00e777dc3a6ce3a61fb22b4d5d6e4feb87ae78e12ed6c4870209e7d';
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
const EXPECTED_RED_FAILURE_IDS = Object.freeze([
  'M2-FAULT-001',
  'M2-FAULT-002',
  'M2-FAULT-003',
  'M2-FAULT-004',
  'M2-FAULT-005',
  'M2-LEAK-001',
  'M2-LEAK-002',
  'M2-LEAK-003',
  'M2-LEAK-004',
  'M2-OPS-001',
  'M2-OPS-002',
  'M2-OPS-003',
  'M2-OPS-004',
  'M2-OPS-005',
  'M2-OPS-006',
  'M2-OPS-007',
  'M2-OPS-008',
  'M2-OPS-009',
  'M2-OPS-010',
  'M2-OPS-011',
  'M2-REC-001',
  'M2-REC-002',
  'M2-REC-003',
  'M2-REC-004',
  'M2-REC-005',
  'M2-REC-006'
]);
const CLOSED_GOVERNANCE_FIELDS = Object.freeze([
  'readyForPromotion',
  'milestone3Authorized',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);

function requireArtifact(filePath, code) {
  assert.equal(
    fs.existsSync(filePath),
    true,
    `${code}: ${path.relative(repoRoot, filePath)}`
  );
}

function loadVerifier() {
  requireArtifact(verifierPath, 'WP_B_M2_AUTHORIZATION_VERIFIER_REQUIRED');
  delete require.cache[require.resolve(verifierPath)];
  return require(verifierPath);
}

function loadRedEvidenceVerifier() {
  requireArtifact(redEvidenceVerifierPath, 'WP_B_M2_RED_EVIDENCE_VERIFIER_REQUIRED');
  delete require.cache[require.resolve(redEvidenceVerifierPath)];
  return require(redEvidenceVerifierPath);
}

function readReceipt() {
  requireArtifact(receiptPath, 'WP_B_M2_AUTHORIZATION_RECEIPT_REQUIRED');
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

function readRedEvidenceReceipt() {
  requireArtifact(redEvidenceReceiptPath, 'WP_B_M2_RED_EVIDENCE_RECEIPT_REQUIRED');
  return JSON.parse(fs.readFileSync(redEvidenceReceiptPath, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

test('Milestone 2 authorization artifacts and resolver exist before production implementation', () => {
  requireArtifact(receiptPath, 'WP_B_M2_AUTHORIZATION_RECEIPT_REQUIRED');
  requireArtifact(verifierPath, 'WP_B_M2_AUTHORIZATION_VERIFIER_REQUIRED');
  const authorityModule = require(authorityModulePath);
  assert.equal(
    typeof authorityModule.resolveWpBM2ImplementationAuthority,
    'function',
    'WP_B_M2_AUTHORITY_RESOLVER_REQUIRED'
  );
});

test('Milestone 2 authorization binds the exact M1 seal and six-operation order', () => {
  const receipt = readReceipt();
  const { validateReceipt } = loadVerifier();
  const result = validateReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(receipt.parentMilestone1SealHead, EXPECTED_PARENT_SEAL_HEAD);
  assert.deepEqual(receipt.operationKinds, EXPECTED_OPERATION_KINDS);
  assert.equal(receipt.pullRequest, 17);
  assert.equal(receipt.branch, 'acv2/wp-b-durable-execution-outbox');
  assert.equal(receipt.status, 'AUTHORIZED_FOR_RED_AND_IMPLEMENTATION');
});

test('Milestone 2 authorization keeps every downstream governance boundary closed', () => {
  const receipt = readReceipt();
  const { validateReceipt } = loadVerifier();
  validateReceipt(receipt);
  assert.equal(receipt.governance.prMustRemainDraft, true);
  for (const field of CLOSED_GOVERNANCE_FIELDS) {
    assert.equal(receipt.governance[field], false, field);
  }
});

test('Milestone 2 verifier rejects parent-head, order, operation-count and downstream mutations', () => {
  const receipt = readReceipt();
  const { validateReceipt } = loadVerifier();

  const wrongParent = clone(receipt);
  wrongParent.parentMilestone1SealHead = '0'.repeat(40);
  assert.throws(
    () => validateReceipt(wrongParent),
    error => error?.code === 'WP_B_M2_AUTHORIZATION_PARENT_SEAL_INVALID'
  );

  const reordered = clone(receipt);
  [reordered.operationKinds[0], reordered.operationKinds[1]] = [
    reordered.operationKinds[1],
    reordered.operationKinds[0]
  ];
  assert.throws(
    () => validateReceipt(reordered),
    error => error?.code === 'WP_B_M2_AUTHORIZATION_OPERATION_ORDER_INVALID'
  );

  const seventh = clone(receipt);
  seventh.operationKinds.push('UNAUTHORIZED_OPERATION');
  assert.throws(
    () => validateReceipt(seventh),
    error => error?.code === 'WP_B_M2_AUTHORIZATION_OPERATION_ORDER_INVALID'
  );

  for (const field of CLOSED_GOVERNANCE_FIELDS) {
    const opened = clone(receipt);
    opened.governance[field] = true;
    assert.throws(
      () => validateReceipt(opened),
      error => error?.code === 'WP_B_M2_AUTHORIZATION_GOVERNANCE_OPEN' && error?.field === field
    );
  }
});

test('Milestone 2 verifier rejects global wildcards and adjacent unauthorized paths', () => {
  const receipt = readReceipt();
  const { validateReceipt, isAuthorizedPath } = loadVerifier();

  for (const wildcard of ['.github/workflows/**', 'backend/**', 'electron/**', '**']) {
    const widened = clone(receipt);
    widened.allowedPaths.push(wildcard);
    assert.throws(
      () => validateReceipt(widened),
      error => error?.code === 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID'
    );
  }

  validateReceipt(receipt);
  assert.equal(isAuthorizedPath(receipt, 'governance/architecture-closure-v2/wp-b-m2-authorization.json'), true);
  assert.equal(isAuthorizedPath(receipt, 'backend/tests/architectureClosureV2/wpB/m2Authorization.test.js'), true);
  assert.equal(isAuthorizedPath(receipt, 'governance/architecture-closure-v2/wp-b-m2-authorization.json.bak'), false);
  assert.equal(isAuthorizedPath(receipt, '.github/workflows/wp-b-m2-red.yaml'), false);
  assert.equal(isAuthorizedPath(receipt, 'backend/services/durableOperations/unregisteredOperation.js'), false);
});

test('active authority resolves Milestone 2 only from a valid exact authorization', () => {
  const authorityModule = require(authorityModulePath);
  assert.equal(typeof authorityModule.resolveWpBM2ImplementationAuthority, 'function');
  const authority = authorityModule.resolveWpBM2ImplementationAuthority({ repositoryRoot: repoRoot });
  assert.ok(authority);
  assert.equal(authority.parentMilestone1SealHead, EXPECTED_PARENT_SEAL_HEAD);
  assert.deepEqual(authority.operationKinds, EXPECTED_OPERATION_KINDS);
  assert.equal(authority.authorizedBranch, 'acv2/wp-b-durable-execution-outbox');
  assert.equal(authority.governance.readyForPromotion, false);
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.operationKinds), true);
  assert.equal(Object.isFrozen(authority.allowedProductionPaths), true);
  assert.equal(Object.isFrozen(authority.governance), true);
});

test('active WP-B authority accepts only a trusted delegated successor chain rooted at the original successor', () => {
  const authorityModule = require(authorityModulePath);
  const originalAuthorizationPath = authorityModule.WP_B_M3_SUCCESSOR_AUTHORIZATION_PATH;
  const amendment1AuthorizationPath = 'governance/layered-ci/acv2-wp-b-m3-source-closure-successor-scope-amendment-1-authorization.json';
  const amendment2AuthorizationPath = 'governance/layered-ci/acv2-wp-b-m3-source-closure-successor-scope-amendment-2-authorization.json';
  const authority = { authorizedBranch: 'acv2/wp-b-durable-execution-outbox' };
  const branch = 'product/acv2-wp-b-m3-source-closure-successor-amendment-2';
  const calls = [];
  const accepted = authorityModule.isAuthorizedWpBImplementationBranch(branch, authority, {
    repositoryRoot: repoRoot,
    evaluateTrustedDelegatedGovernanceBranch: input => {
      calls.push(input.branch);
      if (input.branch === branch) {
        return {
          pass: true,
          authorizationPath: amendment2AuthorizationPath,
          supersededAuthorizationPaths: [
            amendment1AuthorizationPath,
            originalAuthorizationPath
          ]
        };
      }
      return { pass: false, reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID' };
    }
  });
  assert.equal(accepted, true);
  assert.deepEqual(calls, [branch]);

  assert.equal(authorityModule.isAuthorizedWpBImplementationBranch(branch, authority, {
    repositoryRoot: repoRoot,
    evaluateTrustedDelegatedGovernanceBranch: () => ({
      pass: true,
      authorizationPath: amendment2AuthorizationPath,
      supersededAuthorizationPaths: [
        amendment1AuthorizationPath,
        'governance/layered-ci/unrelated-authorization.json'
      ]
    })
  }), false);

  assert.equal(authorityModule.isAuthorizedWpBImplementationBranch(branch, authority, {
    repositoryRoot: repoRoot,
    evaluateTrustedDelegatedGovernanceBranch: () => ({
      pass: true,
      authorizationPath: amendment2AuthorizationPath,
      supersededAuthorizationPaths: []
    })
  }), false);
});

test('credible Milestone 2 RED evidence is bound to one exact Head, workflow and two platform reports', () => {
  const receipt = readRedEvidenceReceipt();
  const { validateReceipt: validateRedEvidenceReceipt } = loadRedEvidenceVerifier();
  const result = validateRedEvidenceReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(receipt.redHead, EXPECTED_RED_EVIDENCE_HEAD);
  assert.equal(receipt.workflowRunId, EXPECTED_RED_WORKFLOW_RUN_ID);
  assert.equal(receipt.changedFileSet.sha256, EXPECTED_RED_FILE_SET_SHA256);
  assert.deepEqual(receipt.expectedFailureContractIds, EXPECTED_RED_FAILURE_IDS);
  assert.equal(receipt.platforms.ubuntu.status, 'RED');
  assert.equal(receipt.platforms.windows.status, 'RED');
  assert.equal(receipt.platforms.ubuntu.testCount, 26);
  assert.equal(receipt.platforms.windows.testCount, 26);
  assert.equal(receipt.platforms.ubuntu.passCount, 0);
  assert.equal(receipt.platforms.windows.passCount, 0);
  assert.equal(receipt.platforms.ubuntu.failCount, 26);
  assert.equal(receipt.platforms.windows.failCount, 26);
});

test('Milestone 2 RED verifier rejects transfer to another Head, run, platform hash or failure set', () => {
  const receipt = readRedEvidenceReceipt();
  const { validateReceipt: validateRedEvidenceReceipt } = loadRedEvidenceVerifier();

  const wrongHead = clone(receipt);
  wrongHead.redHead = '0'.repeat(40);
  assert.throws(
    () => validateRedEvidenceReceipt(wrongHead),
    error => error?.code === 'WP_B_M2_RED_EVIDENCE_HEAD_INVALID'
  );

  const wrongRun = clone(receipt);
  wrongRun.workflowRunId += 1;
  assert.throws(
    () => validateRedEvidenceReceipt(wrongRun),
    error => error?.code === 'WP_B_M2_RED_EVIDENCE_RUN_INVALID'
  );

  const wrongHash = clone(receipt);
  wrongHash.platforms.windows.normalizedOutputSha256 = '0'.repeat(64);
  assert.throws(
    () => validateRedEvidenceReceipt(wrongHash),
    error => error?.code === 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID'
  );

  const missingFailure = clone(receipt);
  missingFailure.expectedFailureContractIds.pop();
  assert.throws(
    () => validateRedEvidenceReceipt(missingFailure),
    error => error?.code === 'WP_B_M2_RED_EVIDENCE_FAILURE_SET_INVALID'
  );

  const opened = clone(receipt);
  opened.governance.mergeAuthorized = true;
  assert.throws(
    () => validateRedEvidenceReceipt(opened),
    error => error?.code === 'WP_B_M2_RED_EVIDENCE_GOVERNANCE_OPEN' && error?.field === 'mergeAuthorized'
  );
});
