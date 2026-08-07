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

const ACTIVE_HANDOFF_AUTHORITY_DOCUMENTS = Object.freeze([
  'PROJECT_CONTINUATION.md',
  'START_HERE.md',
  'YANCE_IMPLEMENTATION_MASTER_PLAN.md'
]);

test('active-handoff routing policy remains schema-v1 and fail closed', () => {
  const result = validateWp0RoutingPolicy(policy);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.unknownPathFailsClosed, true);
  assert.equal(policy.mixedChangesEscalateToProduct, true);
  assert.equal(policy.readyForPromotion, false);
});

test('each exact active-handoff authority document selects GOVERNANCE_WP0', () => {
  for (const file of ACTIVE_HANDOFF_AUTHORITY_DOCUMENTS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.GOVERNANCE, file);
    assert.equal(result.governanceChangesPresent, true, file);
    assert.equal(result.productChangesPresent, false, file);
  }
});

test('the exact PR #120 three-document set selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, ACTIVE_HANDOFF_AUTHORITY_DOCUMENTS);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('authority-document aliases and unrelated root files remain fail closed', () => {
  for (const file of [
    'PROJECT_CONTINUATION.md.bak',
    'start_here.md',
    'YANCE_IMPLEMENTATION_MASTER_PLAN.MD',
    'UNRELATED_ROOT_AUTHORITY.md'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, file);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
  }

  const malformed = classifyWp0Route(policy, ['../START_HERE.md']);
  assert.equal(malformed.pass, false);
  assert.equal(malformed.reasonCode, 'WP0_ROUTE_PATH_INVALID');
});

test('authority document mixed with product code escalates to PRODUCT_WP0', () => {
  const result = classifyWp0Route(policy, [
    'START_HERE.md',
    'backend/runtime/AppRuntime.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, true);
});

test('handoff bootstrap uses exact governance paths without root-prefix expansion', () => {
  for (const file of ACTIVE_HANDOFF_AUTHORITY_DOCUMENTS) {
    assert.equal(policy.governanceExactPaths.includes(file), true, file);
  }

  for (const prefix of policy.governancePrefixes) {
    assert.notEqual(prefix, '');
    assert.equal(ACTIVE_HANDOFF_AUTHORITY_DOCUMENTS.some(file => file.startsWith(prefix)), false, prefix);
  }
});
