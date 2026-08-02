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
    '.github/workflows/reviewed-candidate-a6.yml',
    'tools/independent-review/review-contract.js',
    'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate-design.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
});

test('product, release and existing WP0 implementation changes select PRODUCT_WP0', () => {
  for (const file of [
    'backend/runtime/AppRuntime.js',
    'frontend/index.html',
    'package.json',
    'tools/wp0/verify-gate.js',
    'shared/release/implementationBranchPolicy.js',
    'release/release-source.json'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.route, ROUTES.PRODUCT, file);
  }
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
  assert.match(text, /wp0-product:/u);
  assert.match(text, /wp0-governance:/u);
  assert.match(text, /wp0-gates:\n\s+name: wp0-gates/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'PRODUCT_WP0'/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'GOVERNANCE_WP0'/u);
  assert.doesNotMatch(text, /governance\/layered-ci-reviewed-candidate\s*$/mu);
  assert.doesNotMatch(text, /continue-on-error:\s*true/u);
});
