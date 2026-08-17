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
  'wp-b-m3-authorization.json'
);
const verifierPath = path.join(
  repoRoot,
  'tools',
  'architecture-closure-v2',
  'verify-wp-b-m3-authorization.js'
);
const authorityPath = path.join(
  repoRoot,
  'shared',
  'release',
  'acv2ActiveWorkPackageAuthority.js'
);
const CLOSED_FIELDS = Object.freeze([
  'readyForPromotion',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);

function loadAuthority() {
  delete require.cache[require.resolve(authorityPath)];
  return require(authorityPath);
}

function readReceiptWhenPresent() {
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

test('M3-AUTH-001 machine-readable Milestone 3 authorization receipt exists', () => {
  assert.equal(fs.existsSync(receiptPath), true, 'M3-AUTH-001');
});

test('M3-AUTH-002 strict Milestone 3 authorization verifier exists', () => {
  assert.equal(fs.existsSync(verifierPath), true, 'M3-AUTH-002');
});

test('M3-AUTH-003 active work-package authority exposes an M3 resolver', () => {
  const authority = loadAuthority();
  assert.equal(
    typeof authority.resolveWpBM3ImplementationAuthority,
    'function',
    'M3-AUTH-003'
  );
});

test('M3-AUTH-004 active authority resolves Milestone 3 instead of inherited M2 authority', () => {
  const authority = loadAuthority();
  const resolved = typeof authority.resolveWpBM3ImplementationAuthority === 'function'
    ? authority.resolveWpBM3ImplementationAuthority({ repositoryRoot: repoRoot })
    : null;
  assert.equal(resolved?.milestone, 3, 'M3-AUTH-004');
});

test('M3-AUTH-005 receipt opens only Milestone 3 while downstream authority stays closed', () => {
  const receipt = readReceiptWhenPresent();
  assert.equal(receipt?.governance?.milestone3Authorized, true, 'M3-AUTH-005');
  assert.equal(receipt?.governance?.prMustRemainDraft, true, 'M3-AUTH-005');
  for (const field of CLOSED_FIELDS) {
    assert.equal(receipt?.governance?.[field], false, `M3-AUTH-005:${field}`);
  }
});

test('M3-AUTH-006 verifier rejects wildcard scope and downstream-governance mutations', () => {
  assert.equal(fs.existsSync(verifierPath), true, 'M3-AUTH-006');
  const verifier = require(verifierPath);
  const receipt = readReceiptWhenPresent();
  assert.equal(typeof verifier.validateReceipt, 'function', 'M3-AUTH-006');
  assert.ok(receipt, 'M3-AUTH-006');

  const wildcard = structuredClone(receipt);
  wildcard.allowedPaths.push('backend/**');
  assert.throws(
    () => verifier.validateReceipt(wildcard),
    error => error?.code === 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID',
    'M3-AUTH-006'
  );

  const opened = structuredClone(receipt);
  opened.governance.mergeAuthorized = true;
  assert.throws(
    () => verifier.validateReceipt(opened),
    error => error?.code === 'WP_B_M3_AUTHORIZATION_GOVERNANCE_OPEN',
    'M3-AUTH-006'
  );
});

test('M3-AUTH-007 Scope-006 authorizes the exact outbound legacy authority root paths', () => {
  const verifier = require(verifierPath);
  const receipt = readReceiptWhenPresent();
  assert.ok(receipt, 'M3-AUTH-007');
  assert.equal(verifier.SCOPE_006?.amendmentId, 'WP-B-M3-SCOPE-006', 'M3-AUTH-007');
  assert.deepEqual(
    verifier.SCOPE_006?.addedPaths,
    [
      'backend/repositories/sendQueueRepository.js',
      'backend/services/sendQueueService.js'
    ],
    'M3-AUTH-007'
  );
  assert.equal(
    receipt.authorizationAmendments?.at(-1)?.amendmentId,
    'WP-B-M3-SCOPE-006',
    'M3-AUTH-007'
  );
  const authorized = verifier.resolveAuthorizedPaths(receipt, { repositoryRoot: repoRoot });
  assert.equal(authorized.includes('backend/repositories/sendQueueRepository.js'), true, 'M3-AUTH-007');
  assert.equal(authorized.includes('backend/services/sendQueueService.js'), true, 'M3-AUTH-007');
});
