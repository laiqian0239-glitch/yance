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
  path.join(ROOT, 'governance/layered-ci/v21-learning-policy-p1-route-bootstrap-v1-authorization.json'),
  'utf8'
));

const VW_LICENSE_PATH = 'third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt';
const VW_BOOTSTRAP_PATHS = Object.freeze([VW_LICENSE_PATH]);
const VW_BOOTSTRAP_PATH_SET_SHA256 = '6fc31360bc6d4454f8ee1adbbbfaa4356ce06f55017a44342cafc3a00b16e31d';

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
    .filter(file => !VW_BOOTSTRAP_PATHS.includes(file));
  return base;
}

function exactCandidate(basePolicy = preBootstrapPolicy()) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...VW_BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('Learned Policy P1 VW license path is causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(new Set(VW_BOOTSTRAP_PATHS).size, 1);

  const result = classifyWp0Route(policy, [VW_LICENSE_PATH]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT);
  assert.equal(result.productChangesPresent, true);
  assert.equal(policy.productExactPaths.includes(VW_LICENSE_PATH), true);
});

test('Learned Policy P1 authorization freezes the exact one-path bootstrap set', () => {
  assert.deepEqual(authorization.bootstrapPaths, VW_BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 1);
  assert.equal(authorization.bootstrapPathSetSha256, VW_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(VW_BOOTSTRAP_PATHS), VW_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(authorization.implementation.branch, 'fix/v21-learning-policy-p1-route-bootstrap-v1');
  assert.deepEqual(authorization.implementation.firstCommitAllowedChangedPaths, [
    'tests/layered-ci/v21-learning-policy-p1-routing.test.js'
  ]);
});

test('Learned Policy route bootstrap never authorizes broad product prefixes or adjacent lookalikes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/', 'third_party/licenses/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/upstreams/v21-vowpal-wabbit-p1.json',
    'runtime/learning-growth/vowpal-wabbit/learner.py',
    'third_party/licenses/vowpal-wabbit-MIT.txt',
    'third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt.bak'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Learned Policy route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-14-yance-v21-learned-policy-p1-decision-outcome.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});

test('Learned Policy route bootstrap reuses the trusted generic exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');

  const basePolicy = preBootstrapPolicy();
  const accepted = validate({ authorization, basePolicy, candidatePolicy: exactCandidate(basePolicy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate(basePolicy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'third_party/'];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate(basePolicy);
  unrelatedExact.productExactPaths.push('third_party/licenses/vowpal-wabbit-unapproved.txt');
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedRoute = exactCandidate(basePolicy);
  removedRoute.productExactPaths = removedRoute.productExactPaths.filter(file => file !== VW_LICENSE_PATH);
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: removedRoute }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakenedFailClosed = exactCandidate(basePolicy);
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: weakenedFailClosed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = exactCandidate(basePolicy);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'third_party/'];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = exactCandidate(basePolicy);
  documentationDrift.productDocumentationExactPaths = [
    ...(documentationDrift.productDocumentationExactPaths || []),
    VW_LICENSE_PATH
  ];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
