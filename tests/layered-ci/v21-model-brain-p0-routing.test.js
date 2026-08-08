'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const V21_MODEL_BRAIN_P0_BOOTSTRAP_PATHS = Object.freeze([
  'config/upstreams/v21-model-brain-p0.json',
  'runtime/model-brain/generate_runtime_sbom.py',
  'runtime/model-brain/yance_litellm_worker.py',
  'third_party/licenses/litellm-MIT.txt'
]);

test('V2.1 Model Brain P0 bootstrap paths are exact PRODUCT_WP0 routes', () => {
  assert.equal(new Set(V21_MODEL_BRAIN_P0_BOOTSTRAP_PATHS).size, 4);
  for (const file of V21_MODEL_BRAIN_P0_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, V21_MODEL_BRAIN_P0_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('V2.1 Model Brain route bootstrap does not authorize broad product prefixes', () => {
  for (const prefix of ['config/', 'runtime/', 'third_party/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered Model Brain and LiteLLM-like paths remain fail closed', () => {
  for (const file of [
    'config/upstreams/v21-model-brain-unapproved.json',
    'runtime/model-brain/unapproved_worker.py',
    'runtime/litellm/unapproved_proxy.py',
    'third_party/licenses/litellm-enterprise-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../runtime/model-brain/yance_litellm_worker.py']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('V2.1 Model Brain route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-08-model-brain-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});
