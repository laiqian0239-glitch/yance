'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROUTES, classifyWp0Route } = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'),
  'utf8'
));

const AUTHORITY_PATHS = Object.freeze([
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

test('exact OSS-A authority bootstrap paths select governance WP0', () => {
  const result = classifyWp0Route(policy, [...AUTHORITY_PATHS]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('OSS-A authority bootstrap does not cheap-route product implementation paths', () => {
  const result = classifyWp0Route(policy, [
    ...AUTHORITY_PATHS,
    'tools/third-party/sbom.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT, JSON.stringify(result));
  assert.equal(result.productChangesPresent, true);
});
