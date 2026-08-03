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
const authorityModulePath = path.join(
  repoRoot,
  'shared',
  'release',
  'acv2ActiveWorkPackageAuthority.js'
);

const EXPECTED_PARENT_SEAL_HEAD = '1e3d600f0647af35e737ff92a200c67e69224c82';
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
const CLOSED_GOVERNANCE_FIELDS = Object.freeze([
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

function readReceipt() {
  requireArtifact(receiptPath, 'WP_B_M2_AUTHORIZATION_RECEIPT_REQUIRED');
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
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
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.operationKinds), true);
  assert.equal(Object.isFrozen(authority.allowedProductionPaths), true);
});
