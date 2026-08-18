'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EXPECTED = Object.freeze({
  packageName: 'xstate',
  version: '5.32.5',
  resolved: 'https://registry.npmjs.org/xstate/-/xstate-5.32.5.tgz',
  integrity: 'sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==',
  shasum: '0594075f9fb7d5a12791296c5c798c394b66e823',
  license: 'MIT',
  upstreamCommit: 'c25dba07a2b68565edbe83d83c5d679dd85e00b2',
  licenseTextSha256: '542d926d7bbb099785e322d1d5574c539d51942e52ec8adce2be4629ba81fc7f',
  packageFileCount: 132,
  runtimeDependencyCount: 0
});

function json(relativePath) {
  return require(path.join(REPO_ROOT, relativePath));
}

test('XState physical npm artifact is bound exactly across lock, registry and evidence', () => {
  const packageJson = json('package.json');
  const packageLock = json('package-lock.json');
  const registry = json('governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json');
  const evidence = json('governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json');
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');
  const lockEntry = packageLock.packages['node_modules/xstate'];

  assert.equal(packageJson.dependencies.xstate, EXPECTED.version);
  assert.equal(packageLock.packages[''].dependencies.xstate, EXPECTED.version);
  assert.deepEqual(lockEntry, {
    version: EXPECTED.version,
    resolved: EXPECTED.resolved,
    integrity: EXPECTED.integrity,
    license: EXPECTED.license
  });

  assert.equal(xstate.exactVersion, EXPECTED.version);
  assert.equal(xstate.license, EXPECTED.license);
  assert.equal(xstate.runtimeDependencyCount, EXPECTED.runtimeDependencyCount);
  assert.equal(xstate.verifiedPackageEvidence.distIntegrity, EXPECTED.integrity);
  assert.equal(xstate.verifiedPackageEvidence.distShasum, EXPECTED.shasum);
  assert.equal(xstate.verifiedPackageEvidence.upstreamCommit, EXPECTED.upstreamCommit);
  assert.equal(xstate.verifiedPackageEvidence.licenseTextSha256, EXPECTED.licenseTextSha256);

  assert.equal(evidence.exactVersionAndLicenseReview.exactVersion, EXPECTED.version);
  assert.equal(evidence.exactVersionAndLicenseReview.license, EXPECTED.license);
  assert.equal(evidence.exactVersionAndLicenseReview.upstreamCommit, EXPECTED.upstreamCommit);
  assert.equal(evidence.exactVersionAndLicenseReview.licenseTextSha256, EXPECTED.licenseTextSha256);
  assert.equal(evidence.dependencyAndSecurityScan.runtimeDependencyCount, EXPECTED.runtimeDependencyCount);
  assert.equal(evidence.dependencyAndSecurityScan.packageFileCount, EXPECTED.packageFileCount);
  assert.equal(evidence.dependencyAndSecurityScan.distIntegrity, EXPECTED.integrity);
  assert.equal(evidence.dependencyAndSecurityScan.distShasum, EXPECTED.shasum);
  assert.equal(evidence.dependencyAndSecurityScan.npmAudit.total, 0);
});
