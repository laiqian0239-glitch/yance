'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PACKAGE_RELATIVE_PATH,
  verifyGovernanceReleasePackage
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-governance-release-package');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

test('WP-B governance authority is bound into the real WP7 application source roots', () => {
  const report = verifyGovernanceReleasePackage({ repositoryRoot: REPO_ROOT });
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.wp7ReleaseRootIncluded, true);
  assert.equal(report.sourceBindingCount >= 6, true);
  assert.equal(report.productionUseAuthorized, false);
  assert.equal(report.formalRelease, false);
  assert.equal(report.publish, false);
});

test('packaged governance bytes must equal the reviewed release evidence package', () => {
  const payloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-governance-package-'));
  try {
    const source = path.join(REPO_ROOT, PACKAGE_RELATIVE_PATH);
    const destination = path.join(payloadRoot, 'resources', 'app', PACKAGE_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);

    const green = verifyGovernanceReleasePackage({ repositoryRoot: REPO_ROOT, payloadRoot });
    assert.equal(green.ok, true, JSON.stringify(green.violations, null, 2));
    assert.equal(green.packagedBytesMatch, true);

    fs.appendFileSync(destination, '\n');
    const tampered = verifyGovernanceReleasePackage({ repositoryRoot: REPO_ROOT, payloadRoot });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.violations.some(item => item.code === 'WP_B_PACKAGED_GOVERNANCE_BYTES_MISMATCH'));
  } finally {
    fs.rmSync(payloadRoot, { recursive: true, force: true });
  }
});

test('governance source mutation cannot retain a stale packaged binding', () => {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PACKAGE_RELATIVE_PATH), 'utf8'));
  packageDocument.sourceBindings[0].gitBlobSha = '0'.repeat(40);
  const report = verifyGovernanceReleasePackage({
    repositoryRoot: REPO_ROOT,
    packageDocument
  });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_GOVERNANCE_SOURCE_BINDING_MISMATCH'));
});

test('WP-B validation permanently watches internal SQLite authority and packaged governance evidence', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'wp-b-validation.yml'), 'utf8');
  for (const watchedPath of [
    'backend/lib/r32SqliteStoreEngineLegacy.js',
    'release/architecture-closure-v2/wp-b-governance-package.json'
  ]) {
    const line = `      - ${watchedPath}`;
    assert.equal(workflow.split(line).length - 1, 2, `${watchedPath} must trigger both pull_request and push validation`);
  }
});
