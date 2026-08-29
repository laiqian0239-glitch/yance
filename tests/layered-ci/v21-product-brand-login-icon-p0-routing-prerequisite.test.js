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
  path.join(ROOT, 'governance/layered-ci/v21-product-brand-login-icon-p0-routing-prerequisite-successor-v3-authorization.json'),
  'utf8'
));

const BOOTSTRAP_PATHS = Object.freeze([
  'assets/branding/yance/Yance.ico',
  'assets/branding/yance/brand-assets-manifest.json',
  'assets/branding/yance/branding-tokens.json',
  'assets/branding/yance/generated/Yance.ico',
  'assets/branding/yance/generated/yance-app-icon-1024.png',
  'assets/branding/yance/generated/yance-app-icon-128.png',
  'assets/branding/yance/generated/yance-app-icon-16.png',
  'assets/branding/yance/generated/yance-app-icon-20.png',
  'assets/branding/yance/generated/yance-app-icon-24.png',
  'assets/branding/yance/generated/yance-app-icon-256.png',
  'assets/branding/yance/generated/yance-app-icon-32.png',
  'assets/branding/yance/generated/yance-app-icon-48.png',
  'assets/branding/yance/generated/yance-app-icon-512.png',
  'assets/branding/yance/generated/yance-app-icon-64.png',
  'assets/branding/yance/presentation/yance-mark-display.svg',
  'assets/branding/yance/product/yance-mark-flat.svg',
  'assets/branding/yance/product/yance-mark-micro.svg',
  'assets/branding/yance/product/yance-mark-mono-dark.svg',
  'assets/branding/yance/product/yance-mark-mono-light.svg',
  'assets/branding/yance/source/yance-mark-master.svg',
  'assets/branding/yance/yance-app-icon-1024.png',
  'assets/branding/yance/yance-app-icon-128.png',
  'assets/branding/yance/yance-app-icon-16.png',
  'assets/branding/yance/yance-app-icon-20.png',
  'assets/branding/yance/yance-app-icon-24.png',
  'assets/branding/yance/yance-app-icon-256.png',
  'assets/branding/yance/yance-app-icon-32.png',
  'assets/branding/yance/yance-app-icon-48.png',
  'assets/branding/yance/yance-app-icon-512.png',
  'assets/branding/yance/yance-app-icon-64.png',
  'assets/branding/yance/yance-mark-flat.svg',
  'assets/branding/yance/yance-mark-mono-dark.svg',
  'assets/branding/yance/yance-mark-mono-light.svg',
  'assets/branding/yance/yance-mark.svg',
  'integration/element-module/src/BrandPreviewSurface.css',
  'integration/element-module/src/BrandPreviewSurface.tsx',
  'integration/element-module/src/YanceLogin.css',
  'integration/element-module/src/YanceLogin.tsx'
]);
const BOOTSTRAP_PATH_SET_SHA256 = 'c1801c87cf4a95a5fb6d6f65b569121a3dec3dd38496b7bb65b3379402208464';
const RED_TEST_PATHS = Object.freeze([
  'tests/layered-ci/governance-policy.test.js',
  'tests/layered-ci/v21-product-brand-login-icon-p0-routing-prerequisite.test.js'
]);
const RED_TEST_PATH_SET_SHA256 = '34f8be0d2fca9d55b6196dc4ff28839f4bb4bcbbf88ac851f779f021cd3f0415';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalPathSetSha256(paths) {
  return crypto.createHash('sha256').update(`${[...new Set(paths)].sort().join('\n')}\n`, 'utf8').digest('hex');
}

function exactCandidate(basePolicy = policy) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([...(candidate.productExactPaths || []), ...BOOTSTRAP_PATHS])].sort();
  return candidate;
}

test('brand/login/icon batch is causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(BOOTSTRAP_PATHS.length, 38);
  assert.equal(new Set(BOOTSTRAP_PATHS).size, 38);
  for (const file of BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }
});

test('brand routing authorization freezes exact bootstrap and tests-only first head', () => {
  assert.deepEqual(authorization.bootstrapPaths, BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 38);
  assert.equal(authorization.bootstrapPathSetSha256, BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(BOOTSTRAP_PATHS), BOOTSTRAP_PATH_SET_SHA256);
  assert.deepEqual(authorization.riskPolicyExactL2Paths, BOOTSTRAP_PATHS);
  assert.equal(authorization.riskPolicyExactL2PathCount, 38);
  assert.equal(authorization.riskPolicyExactL2PathSetSha256, BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(authorization.implementation.branch, 'fix/v21-product-brand-login-icon-p0-routing-prerequisite-successor-v3');
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, RED_TEST_PATHS);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileCount, 2);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileSetSha256, RED_TEST_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(RED_TEST_PATHS), RED_TEST_PATH_SET_SHA256);
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.required, true);
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.trustedMainMustEqualAuthorizationMerge, true);
  assert.equal(authorization.implementation.genericRouteMutationGuardRequired, true);
});

test('brand routing bootstrap forbids broad prefixes and adjacent unregistered lookalikes', () => {
  for (const prefix of ['assets/branding/', 'assets/branding/yance/', 'integration/', 'integration/element-module/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
  for (const file of [
    'assets/branding/yance/unregistered-brand-asset.svg',
    'integration/element-module/src/YanceLogin.unapproved.tsx'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }
  const malformed = classifyWp0Route(policy, ['../assets/branding/yance/Yance.ico']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('brand routing bootstrap reuses trusted generic exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function');
  const accepted = validate({ authorization, basePolicy: policy, candidatePolicy: exactCandidate(policy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate(policy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'assets/branding/'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate(policy);
  unrelatedExact.productExactPaths.push('assets/branding/yance/unregistered-brand-asset.svg');
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedExistingRoute = exactCandidate(policy);
  removedExistingRoute.productExactPaths = removedExistingRoute.productExactPaths.filter(file => file !== 'integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: removedExistingRoute }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakenedFailClosed = exactCandidate(policy);
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: weakenedFailClosed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
