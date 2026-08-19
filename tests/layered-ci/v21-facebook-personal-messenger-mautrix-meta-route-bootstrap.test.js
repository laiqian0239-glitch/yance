'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const BOOTSTRAP_PATHS = Object.freeze([
  'config/matrix/mautrix-meta/config.yaml',
  'third_party/licenses/matrix-js-sdk-Apache-2.0.txt',
  'third_party/licenses/mautrix-meta-AGPL-3.0.txt',
  'third_party/licenses/mautrix-meta-LICENSE.exceptions.txt'
]);

test('Facebook Personal mautrix/meta bootstrap paths are exact PRODUCT_WP0 routes', () => {
  assert.equal(new Set(BOOTSTRAP_PATHS).size, 4);
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

test('Facebook Personal route bootstrap does not authorize broad product prefixes', () => {
  for (const prefix of ['config/', 'config/matrix/', 'third_party/', 'third_party/licenses/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered Facebook Personal paths remain fail closed', () => {
  for (const file of [
    'config/matrix/mautrix-meta-unapproved/config.yaml',
    'third_party/licenses/matrix-js-sdk-unapproved.txt',
    'third_party/licenses/mautrix-meta-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }
});

test('Facebook Personal route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-19-facebook-personal-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});
