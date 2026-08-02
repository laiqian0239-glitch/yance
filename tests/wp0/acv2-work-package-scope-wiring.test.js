'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const verifyGatePath = path.join(repoRoot, 'tools', 'wp0', 'verify-gate.js');
const protectedCommandPath = path.join(repoRoot, 'tools', 'wp0', 'run-protected-command.js');
const sharedScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate.js');
const authorizationPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');

test('every executable WP0 entrypoint consumes one shared ACV2 work-package scope gate', () => {
  const verifySource = fs.readFileSync(verifyGatePath, 'utf8');
  const protectedSource = fs.readFileSync(protectedCommandPath, 'utf8');
  assert.match(verifySource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(protectedSource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(verifySource, /evaluateWorkPackageScopeForGate/);
  assert.match(protectedSource, /evaluateWorkPackageScopeForGate/);
  assert.match(verifySource, /workPackageScope/);
  assert.match(protectedSource, /workPackageScope/);
  assert.match(protectedSource, /evidenceMode:\s*Boolean\(evidenceSourceCommit\)/);
  assert.match(protectedSource, /evidenceSourceCommit/);
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

test('detached evidence mode still evaluates the authorized ACV2 changed-file scope', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const sourceCommit = 'a'.repeat(40);
  const calls = [];
  const git = args => {
    calls.push([...args]);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sourceCommit;
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file') return '';
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'diff') return '';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  const result = evaluateWorkPackageScopeForGate({
    branch: null,
    evidenceMode: true,
    evidenceSourceCommit: sourceCommit,
    authorization,
    amendment: null,
    git
  });

  assert.equal(result.applicable, true);
  assert.equal(result.pass, true);
  assert.equal(result.effectiveBranch, authorization.authorizedBranch);
  assert.ok(calls.some(args => args[0] === 'diff' && args.includes('--name-only')));
});
