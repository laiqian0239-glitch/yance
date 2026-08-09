'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');
const implementationBranchPolicy = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

const MEDIA_BOOTSTRAP_PATHS = Object.freeze([
  'config/comfyui-workflows/v21-media-edit.json',
  'config/comfyui-workflows/v21-media-generate.json',
  'config/upstreams/v21-media-brain-p0.json',
  'integration/element-module/src/MediaWorkspace.css',
  'integration/element-module/src/MediaWorkspace.tsx',
  'runtime/media-brain/README.md',
  'runtime/media-brain/comfyui/UPSTREAM.json',
  'runtime/media-brain/immich/UPSTREAM.json',
  'third_party/licenses/comfyui-GPL-3.0.txt',
  'third_party/licenses/immich-AGPL-3.0.txt'
]);
const MEDIA_BOOTSTRAP_PATH_SET_SHA256 = 'b2bd300fb921d64d9b5fd5770a7a66047131fb61f2f928992cb17c4d878392c0';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function routeAuthorization() {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'V21-MEDIA-BRAIN-P0-ROUTE-BOOTSTRAP',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    bootstrapPaths: [...MEDIA_BOOTSTRAP_PATHS],
    bootstrapPathCount: MEDIA_BOOTSTRAP_PATHS.length,
    bootstrapPathSetSha256: MEDIA_BOOTSTRAP_PATH_SET_SHA256,
    implementation: {
      branch: 'fix/v21-media-brain-p0-route-bootstrap',
      allowedChangedPaths: [
        'governance/layered-ci/wp0-routing-policy.json',
        'shared/release/implementationBranchPolicy.js',
        'tests/layered-ci/v21-media-brain-p0-routing.test.js',
        'tests/wp0/implementation-branch-policy.test.js'
      ],
      genericRouteMutationGuardRequired: true
    }
  };
}

function exactCandidate() {
  const candidate = clone(policy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...MEDIA_BOOTSTRAP_PATHS
  ])].sort();
  return candidate;
}

test('Media Brain future bootstrap paths are causal RED until exact PRODUCT_WP0 registration lands', () => {
  assert.equal(new Set(MEDIA_BOOTSTRAP_PATHS).size, 10);
  for (const file of MEDIA_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }

  const aggregate = classifyWp0Route(policy, MEDIA_BOOTSTRAP_PATHS);
  assert.equal(aggregate.pass, true, JSON.stringify(aggregate));
  assert.equal(aggregate.route, ROUTES.PRODUCT);
});

test('Media route bootstrap never authorizes broad product prefixes or adjacent lookalikes', () => {
  for (const prefix of ['config/', 'integration/', 'runtime/', 'third_party/']) {
    assert.equal(policy.productPrefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'config/comfyui-workflows/unapproved.json',
    'config/upstreams/v21-media-brain-p1.json',
    'integration/element-module/src/MediaWorkspaceUnapproved.tsx',
    'runtime/media-brain/unapproved/UPSTREAM.json',
    'third_party/licenses/immich-unapproved.txt'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH', file);
    assert.equal(result.route, null, file);
  }
});

test('Media route bootstrap preserves governance and product-documentation precedence', () => {
  const governance = classifyWp0Route(policy, ['governance/layered-ci/risk-policy.json']);
  assert.equal(governance.pass, true, JSON.stringify(governance));
  assert.equal(governance.route, ROUTES.GOVERNANCE);

  const documentation = classifyWp0Route(policy, ['docs/superpowers/plans/2026-08-09-media-route-bootstrap.md']);
  assert.equal(documentation.pass, true, JSON.stringify(documentation));
  assert.equal(documentation.route, ROUTES.PRODUCT_DOCUMENTATION);
});

test('delegated route bootstrap requires a permanent semantic mutation guard', () => {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');

  const authorization = routeAuthorization();
  const accepted = validate({ authorization, basePolicy: policy, candidatePolicy: exactCandidate() });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));

  const broadPrefix = exactCandidate();
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'runtime/'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: broadPrefix }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const unrelatedExact = exactCandidate();
  unrelatedExact.productExactPaths.push('runtime/media-brain/unapproved/UPSTREAM.json');
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: unrelatedExact }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const removedRoute = exactCandidate();
  removedRoute.productExactPaths = removedRoute.productExactPaths.slice(1);
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: removedRoute }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const weakenedFailClosed = exactCandidate();
  weakenedFailClosed.unknownPathFailsClosed = false;
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: weakenedFailClosed }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const governanceDrift = exactCandidate();
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'runtime/'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: governanceDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');

  const documentationDrift = exactCandidate();
  documentationDrift.productDocumentationExactPaths = [...(documentationDrift.productDocumentationExactPaths || []), 'runtime/media-brain/README.md'];
  assert.equal(validate({ authorization, basePolicy: policy, candidatePolicy: documentationDrift }).reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED');
});
