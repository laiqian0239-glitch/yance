'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ROUTES,
  classifyWp0Route,
  validateWp0RoutingPolicy
} = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const UI_PRODUCT_SHELL_AUTHORIZATION_DOCUMENTS = Object.freeze([
  'docs/ui-migration/UI_ASSET_BASELINE.json',
  'docs/ui-migration/UI_WP1_AUTHORIZATION.md',
  'docs/ui-migration/UPSTREAM_PINS.yaml'
]);

test('routing policy is exact, fail closed and contains no wildcard authorization', () => {
  const result = validateWp0RoutingPolicy(policy);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(policy.unknownPathFailsClosed, true);
  assert.equal(policy.readyForPromotion, false);
  assert.equal(JSON.stringify(policy).includes('*'), false);
});

test('layered governance-only changes select GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'governance/layered-ci/risk-policy.json',
    'tools/layered-ci/governance-policy.js',
    'tests/layered-ci/governance-policy.test.js',
    '.github/actions/resolve-diff-range/action.yml',
    '.github/workflows/reviewed-candidate-a6.yml',
    'tools/independent-review/review-contract.js',
    'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate-design.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
});

test('WP-A Promotion Authorization exact scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    '.github/workflows/wp-a-promotion-authorization.yml',
    'governance/architecture-closure-v2/wp-a-promotion-authorization.json',
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/wp0-routing.test.js',
    'tests/wp0/wp-a-promotion-authorization.test.js',
    'tools/architecture-closure-v2/verify-wp-a-promotion-authorization.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('WP-A permanent post-merge validation exact scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    '.github/workflows/wp-a-post-merge-validation.yml',
    'governance/architecture-closure-v2/wp-a-post-merge-validation-policy.json',
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/wp0-routing.test.js',
    'tests/wp0/wp-a-post-merge-validation.test.js',
    'tools/architecture-closure-v2/run-wp-a-post-merge-contracts.js',
    'tools/architecture-closure-v2/verify-wp-a-post-merge.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('product, release, architecture review docs and existing WP0 implementation changes select PRODUCT_WP0', () => {
  for (const file of [
    'backend/runtime/AppRuntime.js',
    'frontend/index.html',
    'package.json',
    'tools/wp0/verify-gate.js',
    'shared/release/implementationBranchPolicy.js',
    'release/release-source.json',
    'docs/architecture/YANCE_ACV2_WP_A_A5_SOURCE_REVIEW_ZH.md'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.route, ROUTES.PRODUCT, file);
  }
});

test('specific layered governance documents retain governance priority over the general docs product route', () => {
  const result = classifyWp0Route(policy, [
    'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate-design.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
});

test('exact UI Product Shell authorization documents select GOVERNANCE_WP0 together', () => {
  const result = classifyWp0Route(policy, UI_PRODUCT_SHELL_AUTHORIZATION_DOCUMENTS);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('each exact UI Product Shell authorization document independently selects GOVERNANCE_WP0', () => {
  for (const file of UI_PRODUCT_SHELL_AUTHORIZATION_DOCUMENTS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.route, ROUTES.GOVERNANCE, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productChangesPresent, false, file);
  }
});

test('mixing an exact UI authorization document with product source escalates to PRODUCT_WP0', () => {
  for (const file of UI_PRODUCT_SHELL_AUTHORIZATION_DOCUMENTS) {
    const result = classifyWp0Route(policy, [file, 'frontend/index.html']);
    assert.equal(result.pass, true, file);
    assert.equal(result.route, ROUTES.PRODUCT, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productChangesPresent, true, file);
  }
});

test('unlisted UI migration documentation remains on PRODUCT_WP0', () => {
  const result = classifyWp0Route(policy, [
    'docs/ui-migration/FUTURE_PRODUCT_IMPLEMENTATION.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, false);
  assert.equal(result.productChangesPresent, true);
});

test('UI exact-route authorization does not weaken general docs or fail-closed behavior', () => {
  const architecture = classifyWp0Route(policy, [
    'docs/architecture/YANCE_ACV2_WP_A_A5_SOURCE_REVIEW_ZH.md'
  ]);
  assert.equal(architecture.pass, true, JSON.stringify(architecture));
  assert.equal(architecture.route, ROUTES.PRODUCT);

  const unknown = classifyWp0Route(policy, ['unclassified/ui-product-shell.bin']);
  assert.equal(unknown.pass, false);
  assert.equal(unknown.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');

  const invalid = classifyWp0Route(policy, ['../ui-product-shell-escape.md']);
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('mixed governance and product changes escalate to PRODUCT_WP0', () => {
  const result = classifyWp0Route(policy, [
    'governance/layered-ci/risk-policy.json',
    'backend/runtime/AppRuntime.js'
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.route, ROUTES.PRODUCT);
});

test('unknown or invalid paths fail closed rather than selecting a cheaper route', () => {
  const unknown = classifyWp0Route(policy, ['unclassified/new-surface.bin']);
  assert.equal(unknown.pass, false);
  assert.equal(unknown.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');

  const invalid = classifyWp0Route(policy, ['../escape.js']);
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('Stage WP0 workflow routes governance separately and preserves one stable aggregate gate', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows/stage-6459-wp0-gates.yml'), 'utf8');
  assert.match(text, /wp0-route:/u);
  assert.match(text, /select-wp0-route\.js/u);
  assert.match(text, /\.\/\.github\/actions\/resolve-diff-range/u);
  assert.match(text, /wp0-product:/u);
  assert.match(text, /wp0-governance:/u);
  assert.match(text, /wp0-gates:\n\s+name: wp0-gates/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'PRODUCT_WP0'/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'GOVERNANCE_WP0'/u);
  assert.doesNotMatch(text, /governance\/layered-ci-reviewed-candidate\s*$/mu);
  assert.doesNotMatch(text, /continue-on-error:\s*true/u);
});
