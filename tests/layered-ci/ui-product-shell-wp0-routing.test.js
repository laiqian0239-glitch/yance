'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route, validateWp0RoutingPolicy } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'),
  'utf8'
));

const UI_GOVERNANCE_PATHS = Object.freeze([
  'docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml',
  'docs/ui-migration/UI_ASSET_BASELINE.json',
  'docs/ui-migration/UI_WP1_AUTHORIZATION.md',
  'docs/ui-migration/UPSTREAM_PINS.yaml'
]);

const OSS_A_AUTHORITY_PATHS = Object.freeze([
  '.github/workflows/stage-6459-wp0-gates.yml',
  'governance/open-source-acceleration/open-source-work-package-registry.json',
  'governance/open-source-acceleration/oss-a-supply-chain-authorization.json',
  'shared/release/implementationBranchPolicy.js',
  'shared/release/openSourceWorkPackagePolicy.js',
  'tests/wp0/implementation-branch-policy.test.js',
  'tests/wp0/open-source-work-package-authorization.test.js',
  'tools/wp0/lib.js',
  'tools/wp0/work-package-scope-gate.js'
]);

test('all exact UI Product Shell governance documents select GOVERNANCE_WP0 together', () => {
  const result = classifyWp0Route(policy, [...UI_GOVERNANCE_PATHS]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productDocumentationChangesPresent, false);
  assert.equal(result.productChangesPresent, false);
});

test('each exact UI Product Shell governance document selects GOVERNANCE_WP0 independently', () => {
  for (const file of UI_GOVERNANCE_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.GOVERNANCE, file);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productDocumentationChangesPresent, false, file);
    assert.equal(result.productChangesPresent, false, file);
  }
});

test('exact UI governance documents mixed with product source escalate and preserve both classes', () => {
  for (const file of UI_GOVERNANCE_PATHS) {
    const result = classifyWp0Route(policy, [file, 'backend/runtime/AppRuntime.js']);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productDocumentationChangesPresent, false, file);
    assert.equal(result.productChangesPresent, true, file);
  }
});

test('exact UI governance documents mixed with product documentation escalate and preserve all classes', () => {
  for (const file of UI_GOVERNANCE_PATHS) {
    const result = classifyWp0Route(policy, [
      file,
      'docs/superpowers/plans/2026-08-06-ui-product-shell-plan.md'
    ]);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productDocumentationChangesPresent, true, file);
    assert.equal(result.productChangesPresent, true, file);
  }
});

test('unlisted UI migration documents remain PRODUCT_WP0 without prefix or wildcard authorization', () => {
  assert.equal(policy.governanceExactPaths.includes('docs/ui-migration/'), false);
  assert.equal(policy.governancePrefixes.includes('docs/ui-migration/'), false);

  for (const file of [
    'docs/ui-migration/UNLISTED.md',
    'docs/ui-migration/nested/UNLISTED.yaml'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.governanceChangesPresent, false, file);
    assert.equal(result.productDocumentationChangesPresent, false, file);
    assert.equal(result.productChangesPresent, true, file);
  }
});

test('existing OSS-A exact authority paths remain GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [...OSS_A_AUTHORITY_PATHS]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('pure Superpowers plan and spec Markdown remains non-executable PRODUCT_DOCUMENTATION_WP0', () => {
  for (const file of [
    'docs/superpowers/plans/2026-08-06-ui-product-shell-plan.md',
    'docs/superpowers/specs/2026-08-06-ui-product-shell-spec.md'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT_DOCUMENTATION, file);
    assert.equal(result.governanceChangesPresent, false, file);
    assert.equal(result.productDocumentationChangesPresent, true, file);
    assert.equal(result.productChangesPresent, false, file);
    assert.equal(result.executionAuthorized, false, file);
    assert.equal(result.buildAuthorized, false, file);
    assert.equal(result.releaseAuthorized, false, file);
  }
});

test('policy remains schema v2, exact, fail closed and not promotion-ready', () => {
  const result = validateWp0RoutingPolicy(policy);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(policy.schemaVersion, 2);
  assert.equal(policy.unknownPathFailsClosed, true);
  assert.equal(policy.readyForPromotion, false);
  assert.equal(JSON.stringify(policy).includes('*'), false);
});

test('unknown and invalid paths fail closed', () => {
  const unknown = classifyWp0Route(policy, ['unclassified/ui-surface.bin']);
  assert.equal(unknown.pass, false);
  assert.equal(unknown.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');

  for (const invalidPath of [
    '../docs/ui-migration/escape.yaml',
    ' docs/ui-migration/leading-space.yaml',
    'docs/ui-migration/trailing-space.yaml ',
    './docs/ui-migration/dot-prefix.yaml',
    'docs\\ui-migration\\backslash.yaml'
  ]) {
    const invalid = classifyWp0Route(policy, [invalidPath]);
    assert.equal(invalid.pass, false, JSON.stringify(invalidPath));
    assert.equal(invalid.reasonCode, 'WP0_ROUTE_PATH_INVALID', JSON.stringify(invalidPath));
  }
});
