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
  path.join(ROOT, 'governance/layered-ci/v21-adaptive-local-llm-runtime-p0-route-bootstrap-authorization.json'),
  'utf8'
));

const ADAPTIVE_LOCAL_BOOTSTRAP_PATHS = Object.freeze([
  'config/local-ai/adaptive-local-model-catalog-v1.json',
  'config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json',
  'runtime/local-ai/airllm/yance_airllm_worker.py',
  'third_party/licenses/airllm-Apache-2.0.txt',
  'third_party/licenses/ktransformers-Apache-2.0.txt',
  'third_party/licenses/llama.cpp-MIT.txt'
]);
const ADAPTIVE_LOCAL_BOOTSTRAP_PATH_SET_SHA256 = '746af0042f9ff9927d129fb3580da348ed12eca7afc7d22b0ab425bdcaca3a17';
const RED_TEST_PATH = 'tests/layered-ci/v21-adaptive-local-llm-runtime-p0-routing.test.js';

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
  base.productExactPaths = (base.productExactPaths || [])
    .filter(file => !ADAPTIVE_LOCAL_BOOTSTRAP_PATHS.includes(file));
  return base;
}

function exactCandidate(basePolicy = preBootstrapPolicy()) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...ADAPTIVE_LOCAL_BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('adaptive local LLM frozen bootstrap paths are causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(new Set(ADAPTIVE_LOCAL_BOOTSTRAP_PATHS).size, 6);

  for (const file of ADAPTIVE_LOCAL_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, ADAPTIVE_LOCAL_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('adaptive local LLM authorization freezes the exact six-path route bootstrap and first-head contract', () => {
  assert.deepEqual(authorization.bootstrapPaths, ADAPTIVE_LOCAL_BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 6);
  assert.equal(authorization.bootstrapPathSetSha256, ADAPTIVE_LOCAL_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(ADAPTIVE_LOCAL_BOOTSTRAP_PATHS), ADAPTIVE_LOCAL_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(authorization.implementation.branch, 'fix/v21-adaptive-local-llm-runtime-p0-route-bootstrap');
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, [RED_TEST_PATH]);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileCount, 1);
  assert.equal(authorization.implementation.failureFirstCommit.approvedChangedFileSetSha256, '87f344c645f83563330b1833eeb801115c989f7392ee0522ea78bdc39513de9d');
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.required, true);
  assert.equal(authorization.implementation.failureFirstCommit.firstHeadTrustedMainGuard.trustedMainMustEqualAuthorizationMerge, true);
  assert.equal(authorization.implementation.genericRouteMutationGuardRequired, true);
});

test('adaptive local route bootstrap forbids broad product prefixes and adjacent lookalikes', () => {
  for (const prefix of [
    'config/',
    'config/local-ai/',
    'config/upstreams/',
    'runtime/',
    'runtime/local-ai/',
    'third_party/',
    'third_party/licenses/'
  ]) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/local-ai/unapproved-local-model-catalog.json',
    'config/upstreams/v21-adaptive-local-llm-runtime-p0-v2.json',
    'runtime/local-ai/airllm/unapproved_worker.py',
    'third_party/licenses/adaptive-local-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../config/local-ai/adaptive-local-model-catalog-v1.json']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('adaptive local route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-22-adaptive-local-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});

test('adaptive local route bootstrap reuses the trusted generic exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');

  const basePolicy = preBootstrapPolicy();
  const accepted = validate({ authorization, basePolicy, candidatePolicy: exactCandidate(basePolicy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate(basePolicy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'runtime/'];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate(basePolicy);
  unrelatedExact.productExactPaths.push('runtime/local-ai/unapproved_worker.py');
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedRoute = exactCandidate(basePolicy);
  removedRoute.productExactPaths = removedRoute.productExactPaths.filter(file => file !== ADAPTIVE_LOCAL_BOOTSTRAP_PATHS[0]);
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: removedRoute }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakenedFailClosed = exactCandidate(basePolicy);
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: weakenedFailClosed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = exactCandidate(basePolicy);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'runtime/'];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = exactCandidate(basePolicy);
  documentationDrift.productDocumentationExactPaths = [
    ...(documentationDrift.productDocumentationExactPaths || []),
    'runtime/local-ai/README.md'
  ];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
