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
  path.join(ROOT, 'governance/layered-ci/v21-conversation-product-authority-route-bootstrap-authorization.json'),
  'utf8'
));

const BOOTSTRAP_PATHS = Object.freeze([
  'integration/element-module/src/product-experience/AIWorkspace.tsx',
  'integration/element-module/src/product-experience/PersonaManagement.tsx',
  'integration/element-module/src/product-experience/assets/conversation-terrace-dusk-v5.webp',
  'integration/element-module/src/product-experience/assets/conversation-terrace-dusk.png',
  'upstream-patches/element-web/0020-yance-product-live-room-public-seams.patch',
  'upstream-patches/element-web/0021-yance-space-hierarchy-summary.patch',
  'upstream-patches/element-web/0022-yance-bridge-dm-avatar-authority.patch',
  'upstream-patches/element-web/0023-yance-room-message-summary-projection.patch',
  'upstream-patches/element-web/0024-yance-room-invite-sender-public-seam.patch',
  'upstream-patches/element-web/0025-yance-product-conversation-presentation-successor.patch'
]);
const BOOTSTRAP_SHA256 = 'd8fac1144d8a00ef36fc081e84ab55f59eaaac47cb6f82c71f5c64d0cec03fc5';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalPathSetSha256(paths) {
  return crypto
    .createHash('sha256')
    .update(`${[...new Set(paths)].sort().join('\n')}\n`, 'utf8')
    .digest('hex');
}

function preBootstrapPolicy() {
  const base = clone(policy);
  base.productExactPaths = (base.productExactPaths || []).filter(file => !BOOTSTRAP_PATHS.includes(file));
  return base;
}

function exactCandidate(basePolicy = preBootstrapPolicy()) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('Conversation successor exact bootstrap paths route only through PRODUCT_WP0', () => {
  assert.equal(new Set(BOOTSTRAP_PATHS).size, 10);
  for (const file of BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('Conversation route authorization freezes exactly the ten observed unknown paths', () => {
  assert.deepEqual(authorization.bootstrapPaths, BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 10);
  assert.equal(authorization.bootstrapPathSetSha256, BOOTSTRAP_SHA256);
  assert.equal(canonicalPathSetSha256(BOOTSTRAP_PATHS), BOOTSTRAP_SHA256);
  assert.equal(authorization.implementation.branch, 'fix/v21-conversation-product-authority-route-bootstrap');
  assert.deepEqual(authorization.implementation.allowedChangedPaths, [
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/v21-conversation-product-authority-route-bootstrap.test.js'
  ]);
});

test('Conversation route bootstrap keeps broad Product prefixes forbidden', () => {
  for (const prefix of [
    'integration/',
    'integration/element-module/src/product-experience/',
    'upstream-patches/',
    'upstream-patches/element-web/'
  ]) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'integration/element-module/src/product-experience/AIWorkspace.local.tsx',
    'integration/element-module/src/product-experience/assets/conversation-local.webp',
    'upstream-patches/element-web/0026-yance-unregistered-product.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }
});

test('Conversation route bootstrap reuses the trusted exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function');

  const basePolicy = preBootstrapPolicy();
  const accepted = validate({ authorization, basePolicy, candidatePolicy: exactCandidate(basePolicy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
  assert.deepEqual(accepted.declaredPaths, BOOTSTRAP_PATHS);

  const broadPrefix = exactCandidate(basePolicy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'integration/'];
  assert.equal(
    validate({ authorization, basePolicy, candidatePolicy: broadPrefix }).reasonCode,
    'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED'
  );

  const unrelatedExact = exactCandidate(basePolicy);
  unrelatedExact.productExactPaths.push('upstream-patches/element-web/0099-unapproved.patch');
  assert.equal(
    validate({ authorization, basePolicy, candidatePolicy: unrelatedExact }).reasonCode,
    'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED'
  );

  const removedExact = exactCandidate(basePolicy);
  removedExact.productExactPaths = removedExact.productExactPaths.filter(file => file !== BOOTSTRAP_PATHS[0]);
  assert.equal(
    validate({ authorization, basePolicy, candidatePolicy: removedExact }).reasonCode,
    'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED'
  );

  const weakenedFailClosed = exactCandidate(basePolicy);
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(
    validate({ authorization, basePolicy, candidatePolicy: weakenedFailClosed }).reasonCode,
    'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED'
  );
});
