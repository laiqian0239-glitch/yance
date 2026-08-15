'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const V21_PRODUCT_EXPERIENCE_SHELL_P0_BOOTSTRAP_PATHS = Object.freeze([
  'config/upstreams/v21-product-experience-shell-p0.json',
  'integration/element-module/src/product-experience/BilingualSearchPanel.tsx',
  'integration/element-module/src/product-experience/PeopleSurface.tsx',
  'integration/element-module/src/product-experience/ProductComposerAccessory.tsx',
  'integration/element-module/src/product-experience/ProductExperienceShell.css',
  'integration/element-module/src/product-experience/ProductExperienceShell.tsx',
  'integration/element-module/src/product-experience/RelationshipAssistant.tsx',
  'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx',
  'integration/element-module/src/product-experience/RelationshipWorld.tsx',
  'integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx',
  'integration/element-module/src/product-experience/assets/yance-relationship-orb.riv',
  'integration/element-module/src/product-experience/experiencePreferences.ts',
  'integration/element-module/src/product-experience/experienceProjection.ts',
  'integration/element-module/src/product-experience/experienceSession.ts',
  'integration/element-module/src/product-experience/experienceSound.ts',
  'integration/element-module/src/product-experience/experienceTypes.ts',
  'third_party/licenses/base-ui-MIT.txt',
  'third_party/licenses/howler-MIT.txt',
  'third_party/licenses/motion-MIT.txt',
  'third_party/licenses/rive-react-MIT.txt',
  'third_party/licenses/rive-wasm-MIT.txt',
  'third_party/licenses/types-howler-MIT.txt',
  'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch'
]);

test('V2.1 Product Experience Shell P0 bootstrap paths are exact PRODUCT_WP0 routes', () => {
  assert.equal(new Set(V21_PRODUCT_EXPERIENCE_SHELL_P0_BOOTSTRAP_PATHS).size, 23);
  for (const file of V21_PRODUCT_EXPERIENCE_SHELL_P0_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, V21_PRODUCT_EXPERIENCE_SHELL_P0_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
  assert.equal(aggregate.productChangesPresent, true);
});

test('V2.1 Product Experience route bootstrap does not authorize broad product prefixes', () => {
  for (const prefix of ['integration/', 'config/', 'third_party/', 'upstream-patches/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered Product Experience-like paths remain fail closed', () => {
  for (const file of [
    'config/upstreams/v21-product-experience-shell-p1.json',
    'integration/element-module/src/product-experience-unapproved/escape.ts',
    'third_party/licenses/yance-product-unapproved.txt',
    'upstream-patches/element-web/0099-yance-product-unapproved.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../config/upstreams/v21-product-experience-shell-p0.json']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('V2.1 Product Experience route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-10-yance-v21-product-experience-shell-p0.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});
