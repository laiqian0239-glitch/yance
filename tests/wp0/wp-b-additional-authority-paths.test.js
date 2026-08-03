'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ADDITIONAL_WP_B_AUTHORITY_PATHS,
  evaluateAuthorizedWpBScope,
  resolveWpBImplementationAuthority
} = require('../../shared/release/implementationBranchPolicy');

const EXACT_PATHS = Object.freeze([
  'backend/lib/r32SqliteStoreEngineLegacy.js',
  'backend/migrations/architectureClosureV2WpBEngine.js',
  'release/architecture-closure-v2/wp-b-governance-package.json',
  'shared/release/acv2ActiveWorkPackageAuthorityEngine.js'
]);

test('WP-B authority includes only the exact internal engines and application evidence package', () => {
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  assert.deepEqual([...ADDITIONAL_WP_B_AUTHORITY_PATHS].sort(), EXACT_PATHS);

  const exact = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: EXACT_PATHS
  });
  assert.equal(exact.pass, true, JSON.stringify(exact));
  assert.deepEqual(exact.unauthorizedPaths, []);
});

test('WP-B authority rejects adjacent legacy engines and release evidence paths', () => {
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  const adjacent = [
    'backend/lib/r32SqliteStoreEngineLegacyCopy.js',
    'backend/migrations/architectureClosureV2WpCEngine.js',
    'release/architecture-closure-v2/wp-c-governance-package.json',
    'shared/release/anotherAuthorityEngine.js'
  ];

  const result = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: adjacent
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'ACV2_WP_B_SCOPE_VIOLATION');
  assert.deepEqual(result.unauthorizedPaths, adjacent.sort());
});
