'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route, validateWp0RoutingPolicy } = require('../../tools/layered-ci/wp0-routing');
const { classifyChangedFiles, validateRiskPolicy } = require('../../tools/layered-ci/governance-policy');
const implementationBranchPolicy = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const routePolicy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const riskPolicy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/risk-policy.json'), 'utf8'));
const authorization = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/v21-final-compose-promotion-route-p0-authorization.json'),
  'utf8'
));

const TARGET = 'upstream-patches/element-web/0019-yance-module-openid-token.patch';
const ADJACENT = 'upstream-patches/element-web/0020-yance-unregistered-adjacent.patch';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function preBootstrapPolicy() {
  const base = clone(routePolicy);
  base.productExactPaths = base.productExactPaths.filter(file => file !== TARGET);
  return base;
}

test('final Compose promotion path is exact PRODUCT_WP0 and exact L2', () => {
  assert.equal(validateWp0RoutingPolicy(routePolicy).pass, true);
  assert.equal(validateRiskPolicy(riskPolicy).pass, true);
  assert.equal(routePolicy.productExactPaths.includes(TARGET), true);
  assert.equal(riskPolicy.l2ExactPaths.includes(TARGET), true);

  const route = classifyWp0Route(routePolicy, [TARGET]);
  assert.equal(route.pass, true, JSON.stringify(route));
  assert.equal(route.route, ROUTES.PRODUCT);
  assert.equal(route.productChangesPresent, true);

  const risk = classifyChangedFiles(riskPolicy, [TARGET]);
  assert.equal(risk.pass, true, JSON.stringify(risk));
  assert.equal(risk.requiredLevel, 'L2');
  assert.equal(risk.reasons[0].type, 'EXACT');
  assert.equal(risk.reasons[0].rule, TARGET);
});

test('adjacent Element patch remains fail closed and no broad prefix is introduced', () => {
  for (const prefix of ['upstream-patches/', 'upstream-patches/element-web/']) {
    assert.equal(routePolicy.productPrefixes.includes(prefix), false, prefix);
    assert.equal(riskPolicy.l2Prefixes.includes(prefix), false, prefix);
  }

  const route = classifyWp0Route(routePolicy, [ADJACENT]);
  assert.equal(route.pass, false, JSON.stringify(route));
  assert.equal(route.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');
  assert.deepEqual(route.unknownPaths, [ADJACENT]);

  const risk = classifyChangedFiles(riskPolicy, [ADJACENT]);
  assert.equal(risk.pass, false, JSON.stringify(risk));
  assert.equal(risk.reasonCode, 'CI_UNKNOWN_PATH');
  assert.deepEqual(risk.unknownPaths, [ADJACENT]);

  assert.equal(routePolicy.unknownPathFailsClosed, true);
  assert.equal(routePolicy.mixedChangesEscalateToProduct, true);
  assert.equal(riskPolicy.unknownPathFailsClosed, true);
  assert.equal(riskPolicy.l3Automatic, false);
});

test('existing delegated route mutation guard admits only the authorized exact registration', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function');

  const basePolicy = preBootstrapPolicy();
  const accepted = validate({ authorization, basePolicy, candidatePolicy: routePolicy });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broad = clone(routePolicy);
  broad.productPrefixes = [...broad.productPrefixes, 'upstream-patches/element-web/'];
  const broadResult = validate({ authorization, basePolicy, candidatePolicy: broad });
  assert.equal(broadResult.pass, false, JSON.stringify(broadResult));
  assert.equal(broadResult.reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelated = clone(routePolicy);
  unrelated.productExactPaths.push(ADJACENT);
  const unrelatedResult = validate({ authorization, basePolicy, candidatePolicy: unrelated });
  assert.equal(unrelatedResult.pass, false, JSON.stringify(unrelatedResult));
  assert.equal(unrelatedResult.reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakened = clone(routePolicy);
  weakened.unknownPathFailsClosed = false;
  const weakenedResult = validate({ authorization, basePolicy, candidatePolicy: weakened });
  assert.equal(weakenedResult.pass, false, JSON.stringify(weakenedResult));
  assert.equal(weakenedResult.reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
