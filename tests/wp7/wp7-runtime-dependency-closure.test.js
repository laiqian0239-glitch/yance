'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RUNTIME_ROOTS,
  RUNTIME_FILES,
  FORBIDDEN_TOP_LEVEL_ROOTS,
  validateProductionRuntimeSourceDependencies
} = require('../../tools/wp7/runtime-source-dependency-closure');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'windows-release-closure', 'runtime-dependency-closure-policy.json');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-runtime-dependency-'));
  fs.mkdirSync(path.join(root, 'electron'), { recursive: true });
  return root;
}

function write(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('wp7-runtime-dependency-closure.test', async t => {
  await t.test('current production runtime dependency graph is fully packaged', () => {
    const result = validateProductionRuntimeSourceDependencies({ repoRoot: REPO_ROOT });
    assert.equal(result.status, 'PASS');
    assert.ok(result.scannedFileCount > 200);
    assert.ok(result.dependencyCount > 500);
    assert.match(result.dependencyTreeSha256, /^[0-9a-f]{64}$/);
    const updateDependency = result.records.find(row => row.sourcePath === 'electron/updateManager.js' && row.specifier.includes('pe-resource-identity'));
    assert.deepEqual(updateDependency, {
      sourcePath: 'electron/updateManager.js',
      kind: 'require',
      specifier: '../shared/windows/pe-resource-identity',
      targetPath: 'shared/windows/pe-resource-identity.js'
    });
  });

  await t.test('production runtime no longer imports build tooling', () => {
    const updateSource = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'updateManager.js'), 'utf8');
    assert.match(updateSource, /require\('\.\.\/shared\/windows\/pe-resource-identity'\)/);
    assert.doesNotMatch(updateSource, /tools\/wp7\/pe-resource-editor/);
    const shared = require('../../shared/windows/pe-resource-identity');
    const tooling = require('../../tools/wp7/pe-resource-editor');
    assert.strictEqual(tooling.readPe, shared.readPe);
    assert.strictEqual(tooling.parseResourceDirectory, shared.parseResourceDirectory);
    assert.strictEqual(tooling.extractVersionInfo, shared.extractVersionInfo);
    assert.strictEqual(tooling.extractInstallerIdentity, shared.extractInstallerIdentity);
  });

  await t.test('an existing dependency in an excluded tools root is rejected', () => {
    const root = fixture();
    try {
      write(root, 'electron/main.js', "'use strict';\nmodule.exports = require('../tools/runtime-helper');\n");
      write(root, 'tools/runtime-helper.js', "module.exports = {};\n");
      assert.throws(
        () => validateProductionRuntimeSourceDependencies({ repoRoot: root }),
        error => error?.reasonCode === 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_CLOSURE_INVALID'
          && error?.details?.violations?.some(row => row.reasonCode === 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_OUTSIDE_PAYLOAD' && row.targetPath === 'tools/runtime-helper.js')
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  await t.test('a missing relative production dependency is rejected', () => {
    const root = fixture();
    try {
      write(root, 'electron/main.js', "'use strict';\nrequire('./missing-runtime-module');\n");
      assert.throws(
        () => validateProductionRuntimeSourceDependencies({ repoRoot: root }),
        error => error?.reasonCode === 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_CLOSURE_INVALID'
          && error?.details?.violations?.some(row => row.reasonCode === 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_MISSING')
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  await t.test('governance policy matches the executable gate', () => {
    const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    assert.equal(policy.status, 'ENFORCED');
    assert.deepEqual(policy.productionRuntimeRoots, [...RUNTIME_ROOTS, ...RUNTIME_FILES]);
    assert.deepEqual(policy.forbiddenRuntimeDependencyRoots, [...FORBIDDEN_TOP_LEVEL_ROOTS]);
    assert.equal(policy.originalFailure.source, 'electron/updateManager.js');
    assert.equal(policy.releasePolicy.formalInstallerAuthorizedBeforeUat, false);
    assert.equal(policy.releasePolicy.releaseApprovedBeforeUat, false);
  });
});
