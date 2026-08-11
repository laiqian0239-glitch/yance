'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const NX_CRLF_PATCH = 'upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch';

test('V2.1 Element Nx CRLF patch is an exact PRODUCT_WP0 route', () => {
  const result = classifyWp0Route(policy, [NX_CRLF_PATCH]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT);
  assert.equal(result.productChangesPresent, true);
  assert.equal(policy.productExactPaths.includes(NX_CRLF_PATCH), true);
});

test('Element Nx CRLF route bootstrap does not authorize broad upstream patch prefixes', () => {
  for (const prefix of ['upstream-patches/', 'upstream-patches/element-web/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }
});

test('adjacent unregistered Element Nx CRLF patch paths remain fail closed', () => {
  for (const file of [
    'upstream-patches/element-web/0004-yance-nx-crlf-lockfile.patch',
    'upstream-patches/element-web/0003-yance-nx-crlf-lockfile-extra.patch',
    'upstream-patches/other/0003-yance-nx-crlf-lockfile.patch'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }

  const malformed = classifyWp0Route(policy, ['../upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch']);
  assert.equal(malformed.pass, false, JSON.stringify(malformed));
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Element Nx CRLF route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-10-yance-v21-product-experience-shell-p0.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});
