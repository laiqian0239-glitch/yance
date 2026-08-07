'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const V21_COMMS_P0_BOOTSTRAP_PATHS = Object.freeze([
  'config/matrix/element-config.json',
  'config/matrix/mautrix-whatsapp/config.yaml',
  'config/matrix/synapse/homeserver.yaml',
  'config/upstreams/v21-comms-p0.json',
  'integration/element-module/package.json',
  'integration/element-module/project.json',
  'integration/element-module/src/YanceWorkspace.tsx',
  'integration/element-module/src/index.tsx',
  'integration/element-module/tsconfig.json',
  'integration/element-module/vite.config.ts',
  'third_party/licenses/element-web-AGPL-3.0.txt',
  'third_party/licenses/mautrix-whatsapp-AGPL-3.0.txt',
  'third_party/licenses/mautrix-whatsapp-LICENSE.exceptions.txt',
  'third_party/licenses/synapse-AGPL-3.0.txt',
  'upstream-patches/element-web/0001-yance-global-right-workspace.patch'
]);

test('V2.1 communication P0 bootstrap paths are exact PRODUCT_WP0 routes', () => {
  assert.equal(new Set(V21_COMMS_P0_BOOTSTRAP_PATHS).size, 15);
  for (const file of V21_COMMS_P0_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, V21_COMMS_P0_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('V2.1 route bootstrap does not authorize broad product prefixes', () => {
  for (const prefix of ['config/', 'integration/', 'third_party/', 'upstream-patches/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered V2.1-like paths remain fail closed', () => {
  for (const file of [
    'config/matrix/unapproved.yaml',
    'integration/unapproved/module.ts',
    'third_party/licenses/unapproved.txt',
    'upstream-patches/element-web/unapproved.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }
});

test('V2.1 route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-07-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});
