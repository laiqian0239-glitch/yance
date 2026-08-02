'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = require('../../governance/architecture-closure-v2/wp-a-post-merge-validation-policy.json');
const closure = require('../../governance/architecture-closure-v2/wp-a-a8-closure.json');
const authorization = require('../../governance/architecture-closure-v2/wp-a-promotion-authorization.json');
const {
  validateDocuments,
  validatePolicy
} = require('../../tools/architecture-closure-v2/verify-wp-a-post-merge');
const {
  collectContractFiles
} = require('../../tools/architecture-closure-v2/run-wp-a-post-merge-contracts');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('post-merge policy binds exact integration identities and keeps release closed', () => {
  assert.equal(validatePolicy(policy), true);
  assert.equal(validateDocuments(policy, closure, authorization), true);
  assert.equal(policy.integration.candidateHead, 'c57ec612ca07cd1cfa939e075f4dbcce2287eaca');
  assert.equal(policy.integration.promotionAuthorizationCommit, '286e412ce979badc0b5a217646ed6c488a6dcb78');
  assert.equal(policy.integration.mergeCommit, 'e24c5d11dc1d0fb9fbd82479bb3949aba05aec50');
  assert.equal(policy.governance.readyForPromotion, true);
  assert.equal(policy.governance.formalRelease, false);
  assert.equal(policy.governance.publish, false);
  assert.equal(policy.governance.wpBAuthorized, false);
});

test('post-merge policy rejects release or bypass escalation', () => {
  for (const [field, value] of [
    ['formalRelease', true],
    ['publish', true],
    ['wpBAuthorized', true],
    ['temporaryBypassAllowed', true],
    ['continueOnErrorAllowed', true],
    ['wildcardAuthorizationAllowed', true]
  ]) {
    const changed = clone(policy);
    changed.governance[field] = value;
    assert.throws(() => validatePolicy(changed), field);
  }
});

test('portable post-merge matrix enumerates all WP-A contracts and critical regressions', () => {
  const files = collectContractFiles();
  assert.ok(files.length >= 30, `expected broad WP-A contract matrix, got ${files.length}`);
  for (const required of [
    'backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js',
    'backend/tests/architectureClosureV2/wpA/canonicalEventLedgerAuthority.test.js',
    'backend/tests/architectureClosureV2/wpA/identityAuthority.test.js',
    'backend/tests/architectureClosureV2/wpA/ledgerReplay.test.js',
    'backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js',
    'backend/tests/round12PlatformCoreAuthorities.test.js',
    'tests/runtime-delivery/repository-source-identity-authority.test.js',
    'tests/wp3/stale-fencing-token-outbox-denied.test.js',
    'tests/wp4/application-matrix-temp-path.test.js',
    'tests/wp5/m5-sqlite-ownership.test.js'
  ]) assert.ok(files.includes(required), `missing required post-merge contract: ${required}`);
});

test('post-merge workflow is permanent, exact-main and fail closed', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'wp-a-post-merge-validation.yml'),
    'utf8'
  );
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /verify-wp-a-post-merge\.js --require-origin-main/u);
  assert.match(workflow, /run-wp-a-post-merge-contracts\.js/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /wp-a-post-merge-gate/u);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/u);
  assert.doesNotMatch(workflow, /npm run test:wp0/u, 'branch-bound product WP0 must not be misused after merge');
});
