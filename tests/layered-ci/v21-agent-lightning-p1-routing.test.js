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
  path.join(ROOT, 'governance/layered-ci/v21-deep-training-p1-agent-lightning-route-bootstrap-v1-authorization.json'),
  'utf8'
));

const AGENT_LIGHTNING_BOOTSTRAP_PATHS = Object.freeze([
  'config/upstreams/v21-agent-lightning-p1.json',
  'runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py',
  'runtime/deep-training/agent-lightning/generate_runtime_sbom.py',
  'runtime/deep-training/agent-lightning/pyproject.toml',
  'runtime/deep-training/agent-lightning/uv.lock',
  'third_party/licenses/agent-lightning-MIT.txt'
]);
const AGENT_LIGHTNING_BOOTSTRAP_PATH_SET_SHA256 = 'b560e29a0410b9b86b83d65e955219459a344edf97ba04cf3d6bcde51fd1e5ca';

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
    .filter(file => !AGENT_LIGHTNING_BOOTSTRAP_PATHS.includes(file));
  return base;
}

function exactCandidate(basePolicy = preBootstrapPolicy()) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...AGENT_LIGHTNING_BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('Agent Lightning P1 frozen bootstrap paths are causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(new Set(AGENT_LIGHTNING_BOOTSTRAP_PATHS).size, 6);

  for (const file of AGENT_LIGHTNING_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, AGENT_LIGHTNING_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('Agent Lightning P1 authorization freezes the exact six-path bootstrap set', () => {
  assert.deepEqual(authorization.bootstrapPaths, AGENT_LIGHTNING_BOOTSTRAP_PATHS);
  assert.equal(authorization.bootstrapPathCount, 6);
  assert.equal(authorization.bootstrapPathSetSha256, AGENT_LIGHTNING_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(canonicalPathSetSha256(AGENT_LIGHTNING_BOOTSTRAP_PATHS), AGENT_LIGHTNING_BOOTSTRAP_PATH_SET_SHA256);
  assert.equal(authorization.implementation.branch, 'fix/v21-deep-training-p1-agent-lightning-route-bootstrap-v1');
  assert.deepEqual(authorization.implementation.firstCommitAllowedChangedPaths, [
    'tests/layered-ci/v21-agent-lightning-p1-routing.test.js'
  ]);
});

test('Agent Lightning route bootstrap never authorizes broad product prefixes or adjacent lookalikes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/upstreams/v21-agent-lightning-p2.json',
    'runtime/deep-training/agent-lightning/unapproved.py',
    'runtime/deep-training/agent-lightning/unapproved/pyproject.toml',
    'third_party/licenses/agent-lightning-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../config/upstreams/v21-agent-lightning-p1.json']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Agent Lightning route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-14-agent-lightning-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});

test('Agent Lightning route bootstrap reuses the trusted generic exact mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');

  const basePolicy = preBootstrapPolicy();
  const accepted = validate({ authorization, basePolicy, candidatePolicy: exactCandidate(basePolicy) });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate(basePolicy);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'runtime/'];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate(basePolicy);
  unrelatedExact.productExactPaths.push('runtime/deep-training/agent-lightning/unapproved.py');
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedRoute = exactCandidate(basePolicy);
  removedRoute.productExactPaths = removedRoute.productExactPaths.filter(file => file !== AGENT_LIGHTNING_BOOTSTRAP_PATHS[0]);
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
    'runtime/deep-training/agent-lightning/README.md'
  ];
  assert.equal(validate({ authorization, basePolicy, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
