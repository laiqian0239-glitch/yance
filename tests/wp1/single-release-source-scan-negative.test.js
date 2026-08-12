'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scanSingleHumanMaintainedReleaseSource } = require('../../tools/wp1/lib');

const RELEASE_SOURCE = Object.freeze({
  productName: '言策',
  productVersion: '29.2.5',
  stageVersion: '6.4.5.9',
  phase: 'core-runtime-p1',
  distributionMode: 'LOCAL_PRIVATE_UNSIGNED',
  apiContractVersion: 2,
  credentialProtocolVersion: 2,
  runtimeLockProtocolVersion: 1
});

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, 'utf8');
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-release-source-scan-'));
  write(root, 'package.json', `${JSON.stringify({ name: 'fixture', version: '0.0.0-development', private: true, description: 'fixture repository' }, null, 2)}\n`);
  write(root, 'release/release-source.json', `${JSON.stringify(RELEASE_SOURCE, null, 2)}\n`);
  write(root, 'frontend/index.js', "module.exports = 'frontend';\n");
  write(root, 'backend/index.js', "module.exports = 'backend';\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@local.invalid']);
  git(root, ['add', '.']);
  return root;
}
function scan(root) {
  return scanSingleHumanMaintainedReleaseSource(root, RELEASE_SOURCE);
}

test('frontend-hardcoded-product-version-rejected.test', () => {
  const root = fixture();
  write(root, 'frontend/releaseIdentity.js', "const productVersion = '29.2.5';\nmodule.exports = productVersion;\n");
  git(root, ['add', 'frontend/releaseIdentity.js']);
  const result = scan(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.violations.some(item => item.path === 'frontend/releaseIdentity.js' && item.field === 'productVersion'));
});

test('frontend-hardcoded-stage-version-rejected.test', () => {
  const root = fixture();
  write(root, 'frontend/releaseIdentity.js', "const stageVersion = '6.4.5.9';\nmodule.exports = stageVersion;\n");
  git(root, ['add', 'frontend/releaseIdentity.js']);
  const result = scan(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.violations.some(item => item.path === 'frontend/releaseIdentity.js' && item.field === 'stageVersion'));
});

test('package-metadata-release-identity-rejected.test', () => {
  const root = fixture();
  write(root, 'package.json', `${JSON.stringify({ name: 'fixture', version: '29.2.5', private: true, description: 'Stage 6.4.5.9 package' }, null, 2)}\n`);
  git(root, ['add', 'package.json']);
  const result = scan(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.violations.some(item => item.path === 'package.json' && item.reasonCode === 'WP1_PACKAGE_METADATA_RELEASE_IDENTITY_FORBIDDEN'));
});

test('runtime-hardcoded-build-id-rejected.test', () => {
  const root = fixture();
  write(root, 'backend/releaseIdentity.js', "const buildId = 'YANCE-29.2.5-S6.4.5.9-P1-aaaaaaaaaaaa-20260703T000000Z';\nmodule.exports = buildId;\n");
  git(root, ['add', 'backend/releaseIdentity.js']);
  const result = scan(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.violations.some(item => item.path === 'backend/releaseIdentity.js' && item.reasonCode === 'WP1_RUNTIME_HARDCODED_BUILD_ID'));
});

test('nested-backend-tests-are-not-runtime-release-identity-sources.test', () => {
  const root = fixture();
  write(root, 'backend/tests/release-identity.fixture.test.js', "const productVersion = '29.2.5';\nconst buildId = 'YANCE-29.2.5-S6.4.5.9-P1-bbbbbbbbbbbb-20260703T000000Z';\nmodule.exports = { productVersion, buildId };\n");
  git(root, ['add', 'backend/tests/release-identity.fixture.test.js']);
  const fixtureOnly = scan(root);
  assert.equal(fixtureOnly.status, 'PASS', JSON.stringify(fixtureOnly.violations));
  assert.equal(fixtureOnly.violations.some(item => item.path.startsWith('backend/tests/')), false);

  write(root, 'backend/runtime-hardcoded.js', "const buildId = 'YANCE-29.2.5-S6.4.5.9-P1-cccccccccccc-20260703T000000Z';\nmodule.exports = buildId;\n");
  git(root, ['add', 'backend/runtime-hardcoded.js']);
  const withRuntimeViolation = scan(root);
  assert.equal(withRuntimeViolation.status, 'FAIL');
  assert.ok(withRuntimeViolation.violations.some(item => item.path === 'backend/runtime-hardcoded.js' && item.reasonCode === 'WP1_RUNTIME_HARDCODED_BUILD_ID'));
});

test('nested-backend-build-remains-runtime-release-identity-source.test', () => {
  const root = fixture();
  write(root, 'backend/plugins/build/release-identity.js', "const buildId = 'YANCE-29.2.5-S6.4.5.9-P1-dddddddddddd-20260703T000000Z';\nmodule.exports = buildId;\n");
  git(root, ['add', 'backend/plugins/build/release-identity.js']);

  const result = scan(root);
  assert.equal(result.status, 'FAIL', JSON.stringify(result.violations));
  assert.ok(result.violations.some(item =>
    item.path === 'backend/plugins/build/release-identity.js' &&
    item.reasonCode === 'WP1_RUNTIME_HARDCODED_BUILD_ID'
  ));
});