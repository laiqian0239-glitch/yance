'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const verifyGatePath = path.join(repoRoot, 'tools', 'wp0', 'verify-gate.js');
const protectedCommandPath = path.join(repoRoot, 'tools', 'wp0', 'run-protected-command.js');
const sharedScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate.js');

test('every executable WP0 entrypoint consumes one shared ACV2 work-package scope gate', () => {
  const verifySource = fs.readFileSync(verifyGatePath, 'utf8');
  const protectedSource = fs.readFileSync(protectedCommandPath, 'utf8');
  assert.match(verifySource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(protectedSource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(verifySource, /evaluateWorkPackageScopeForGate/);
  assert.match(protectedSource, /evaluateWorkPackageScopeForGate/);
  assert.match(verifySource, /workPackageScope/);
  assert.match(protectedSource, /workPackageScope/);
});

test('shared scope gate verifies clean worktree, authorization blob, parent and exact diff', () => {
  const exists = fs.existsSync(sharedScopeGatePath);
  assert.equal(exists, true, 'shared work-package scope gate must exist');
  if (!exists) return;
  const source = fs.readFileSync(sharedScopeGatePath, 'utf8');
  assert.match(source, /evaluateAuthorizedWorkPackageScope/);
  assert.match(source, /loadWorkPackageAuthorization/);
  assert.match(source, /loadWorkPackageScopeAmendment/);
  assert.match(source, /ACV2_AUTHORIZATION_BLOB_SHA/);
  assert.match(source, /ACV2_WP_A_PARENT_GOVERNANCE_HEAD/);
  assert.match(source, /status[^\n]*--porcelain/);
  assert.match(source, /diff[^\n]*--name-only/);
  assert.match(source, /merge-base[^\n]*--is-ancestor/);
  assert.match(source, /ACV2_WORK_PACKAGE_SCOPE_/);
});
