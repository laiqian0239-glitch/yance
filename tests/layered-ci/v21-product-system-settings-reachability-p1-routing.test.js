'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');
const implementationBranchPolicy = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const authorization = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/v21-product-system-settings-reachability-p1-routing-prerequisite-authorization.json'),
  'utf8'
));

const PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS = Object.freeze([
  'integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx'
]);
const PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATH_SET_SHA256 = '36c080a62e589824801bf7ed47407f2b60148d5a059c39edc1a7e9d64f9b9e19';
const RED_TEST_PATHS = Object.freeze([
  'tests/layered-ci/governance-policy.test.js',
  'tests/layered-ci/v21-product-system-settings-reachability-p1-routing.test.js'
]);
const RED_TEST_PATH_SET_SHA256 = '80ffc053006db11192ef864582a92a34b28b70a49ee970b5c65a9b13829ba34f';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalPathSetSha256(paths) {
  return crypto
    .createHash('sha256')
    .update(`${[...new Set(paths)].sort().join('\n')}\n`, 'utf8')
    .digest('hex');
}

function exactCandidate(basePolicy = policy) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('Product system settings surface is causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(new Set(PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS).size, 1);
  const file = PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS[0];
  const result = classifyWp0Route(policy, [file]);
  assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
  assert.equal(result.route, ROUTES.PRODUCT, file);
  assert.equal(result.productChangesPresent, true, file);
  assert.equal(policy.productExactPaths.includes(file), true, file);
});

test('Product system settings routing authorization freezes the exact bootstrap and tests-only first head', () => {
  assert.deepEqual(authorization.bootstrapPaths, PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 1);
  assert.equal(authorization.bootstrapPathSetSha256, PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATHS), PRODUCT_SYSTEM_SETTINGS_BOOTSTRAP_PATH_SET_SHA256);

  assert.equal(authorization.implementation.branch, 'fix/v21-product-system-settings-reachability-p1-routing-prerequisite');
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, RED_TEST_PATHS);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileCount, 2);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileSetSha256, RED_TEST_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(RED_TEST_PATHS), RED_TEST_PATH_SET_SHA256);
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.required, true);
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.trustedMainMustEqualAuthorizationMerge, true);
  assert.equal(authorization.implementation.genericRouteMutationGuardRequired, true);
});

test('Product system settings bootstrap forbids broad prefixes and adjacent unregistered lookalikes', () => {
  for (const prefix of ['integration/', 'integration/element-module/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'integration/element-module/src/product-experience/ProductSystemSettingsSurface.unapproved.tsx',
    'integration/element-module/src/product-experience/UnregisteredSurface.tsx'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Product system settings route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-22-product-system-settings-routing-prerequisite.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});

test('Product system settings route bootstrap reuses the trusted generic exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');

  const accepted = validate({ authorization, basePolicy: policy, candidatePolicy: exactCandidate(policy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate(policy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'integration/'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate(policy);
  unrelatedExact.productExactPaths.push('integration/element-module/src/product-experience/UnregisteredSurface.tsx');
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedExistingRoute = exactCandidate(policy);
  removedExistingRoute.productExactPaths = removedExistingRoute.productExactPaths.filter(file => file !== 'integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: removedExistingRoute }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakenedFailClosed = exactCandidate(policy);
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: weakenedFailClosed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = exactCandidate(policy);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'integration/'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
