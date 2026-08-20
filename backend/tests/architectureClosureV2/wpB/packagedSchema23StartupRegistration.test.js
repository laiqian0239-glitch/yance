'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  requireSchema23StartupRegistration
} = require('../../../../shared/release/wpBM1RedEvidenceAuthority');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const RELEASE_PACKAGE_RELATIVE_PATH = 'release/architecture-closure-v2/wp-b-governance-package.json';
const M1_RED_RELATIVE_PATH = 'governance/architecture-closure-v2/wp-b-m1-red-evidence.json';
const M1_RED_GIT_BLOB_SHA = '49ad68fdc48f7023428fe23746f5f41d2b32235e';

function withPackagedReleaseRoot(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-packaged-schema23-'));
  try {
    const source = path.join(REPO_ROOT, RELEASE_PACKAGE_RELATIVE_PATH);
    const destination = path.join(root, RELEASE_PACKAGE_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return work(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('packaged WP-B release package binds immutable M1 RED evidence', () => {
  const document = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, RELEASE_PACKAGE_RELATIVE_PATH), 'utf8'));
  const binding = document.sourceBindings.find(item => item.path === M1_RED_RELATIVE_PATH);
  assert.ok(binding, 'packaged release governance must bind the immutable M1 RED evidence');
  assert.equal(binding.documentType, 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE');
  assert.equal(binding.gitBlobSha, M1_RED_GIT_BLOB_SHA);
});

test('Schema 23 startup authorization survives the real packaged source-root boundary', () => {
  withPackagedReleaseRoot(root => {
    assert.equal(fs.existsSync(path.join(root, M1_RED_RELATIVE_PATH)), false, 'packaged application intentionally omits source governance root');
    const report = requireSchema23StartupRegistration(root);
    assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
    assert.equal(report.schema23StartupRegistrationAuthorized, true);
    assert.equal(report.authoritySource, 'PACKAGED_RELEASE_BINDING');
  });
});
