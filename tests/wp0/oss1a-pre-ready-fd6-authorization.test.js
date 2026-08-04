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
const {
  classifyProductRouteBranchRole
} = require('../../tools/wp0/product-route-executable-policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUCCESSOR_BRANCH = 'governance/oss-1a-pre-ready-fd6-authorization';
const IMPLEMENTATION_BRANCH = 'oss/1a-baileys-lifecycle';
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v4.json';
const RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v4.json';
const PLAN_PATH = 'docs/superpowers/plans/2026-08-05-yance-oss-1a-pre-ready-fd6-handshake-amendment.md';
const PLAN_HEAD = 'c4117bc80b824f0531366c37a0f20bfa9ee0b543';
const V3_AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v3.json';
const EXPECTED_ADDITIONS = Object.freeze([
  'electron/desktopHost/BackendProcessHost.js',
  'electron/desktopHost/CredentialVaultHost.js'
]);
const EXPECTED_PATH_COUNT = 31;
const EXPECTED_PATH_SET_SHA256 = '7005808b4f0a2bdb883685cf8691f643d2df8322e5863d5878cdf0a3be810577';

function readJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}

function repositoryFileSha256(repositoryPath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/'))))
    .digest('hex');
}

test('OSS-1A successor registry selects exact v4 authority and receipt paths', () => {
  const registry = loadOpenSourceWorkPackageRegistry();
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);
  assert.ok(entry, 'registry must select OSS-1A');
  assert.equal(entry.workPackage, 'OSS-1A');
  assert.equal(entry.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(entry.receiptPath, RECEIPT_PATH);
});

test('v4 authorization adds only the two independently proven handshake core paths', () => {
  const previous = readJson(V3_AUTHORIZATION_PATH);
  const authorization = readJson(AUTHORIZATION_PATH);
  const registry = loadOpenSourceWorkPackageRegistry();
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, IMPLEMENTATION_BRANCH);

  assert.equal(isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.authorizationVersion, 4);
  assert.equal(authorization.supersedesAuthorizationPath, V3_AUTHORIZATION_PATH);
  assert.equal(authorization.authorizedBranch, IMPLEMENTATION_BRANCH);
  assert.equal(authorization.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(authorization.approvedParentHead, '83413610abefa7a54bf3213951c522acef4888ca');
  assert.equal(authorization.approvedPlanPath, PLAN_PATH);
  assert.equal(authorization.approvedPlanHead, PLAN_HEAD);
  assert.equal(authorization.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(changedFileSetSha256(authorization.exactPaths), EXPECTED_PATH_SET_SHA256);

  const additions = authorization.exactPaths.filter(value => !previous.exactPaths.includes(value));
  const removals = previous.exactPaths.filter(value => !authorization.exactPaths.includes(value));
  assert.deepEqual(additions, [...EXPECTED_ADDITIONS]);
  assert.deepEqual(removals, []);
  assert.equal(authorization.exactPaths.length, previous.exactPaths.length + 2);

  for (const forbidden of [
    'electron/credentialVault.js',
    'electron/desktopHost/DesktopHost.js',
    'backend/bootstrap/credentialHydrationPipe.js',
    'backend/bootstrap/applyCredentialSnapshot.js',
    'backend/runtime/BootCoordinator.js',
    'backend/core/securityGuard.js',
    'backend/core/securityGuardSingleton.js',
    'backend/services/secureBridge.js',
    'shared/credentialProtocol.js',
    'shared/credentialCustodyProtocol.js'
  ]) assert.equal(authorization.exactPaths.includes(forbidden), false, forbidden);
});

test('v4 receipt seals the authorization anchor before implementation continuation', () => {
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
  assert.equal(receipt.authorizationVersion, 4);
  assert.equal(receipt.supersedesReceiptPath, 'governance/open-source-acceleration/oss-1a-authorization-receipt-v3.json');
  assert.equal(receipt.requiredBaseRef, SUCCESSOR_BRANCH);
  assert.equal(receipt.approvedPlanPath, PLAN_PATH);
  assert.equal(receipt.approvedPlanHead, PLAN_HEAD);
  assert.match(receipt.authorizationCommit, /^[a-f0-9]{40}$/u);
  assert.match(receipt.implementationBaseCommit, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.authorizationCommit, receipt.implementationBaseCommit, 'implementation base must include validated governance composition after the immutable authorization anchor');
  assert.equal(receipt.approvedChangedFileCount, EXPECTED_PATH_COUNT);
  assert.equal(receipt.approvedChangedFileSetSha256, EXPECTED_PATH_SET_SHA256);
  assert.equal(receipt.governance.authorizationPredatesImplementation, true);
  assert.equal(receipt.governance.implementationBasePredatesReceiptSeal, true);
});

test('successor governance is negative-proof only while implementation branch remains executable', () => {
  const governance = classifyProductRouteBranchRole(SUCCESSOR_BRANCH);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');

  const implementation = classifyProductRouteBranchRole(IMPLEMENTATION_BRANCH);
  assert.equal(implementation.pass, true, JSON.stringify(implementation));
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');
});
