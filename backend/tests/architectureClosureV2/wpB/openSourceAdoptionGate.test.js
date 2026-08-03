'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_STEP_IDS,
  verifyFiles,
  verifyRegistry
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const XSTATE_VERSION = '5.32.5';
const XSTATE_INTEGRITY = 'sha512-631+ENa9BCjf/Rn/aWthqY8CWnHT6LHAANtB9zTHb9Tz6SgoI8NA+IWjG3qfIcnEubyksdYGhWCOle4eA/pP4A==';

function fixture() {
  const report = verifyFiles(REPO_ROOT);
  return {
    gate: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json'),
    registry: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json'),
    baseline: require('../../../../governance/architecture-closure-v2/wp-b-baseline.json'),
    authorization: require('../../../../governance/architecture-closure-v2/wp-b-design-authorization.json'),
    report
  };
}

function exactPackageJson() {
  return {
    name: 'xstate-admission-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { xstate: XSTATE_VERSION }
  };
}

function exactPackageLock() {
  return {
    name: 'xstate-admission-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'xstate-admission-fixture',
        version: '1.0.0',
        dependencies: { xstate: XSTATE_VERSION }
      },
      'node_modules/xstate': {
        version: XSTATE_VERSION,
        resolved: `https://registry.npmjs.org/xstate/-/xstate-${XSTATE_VERSION}.tgz`,
        integrity: XSTATE_INTEGRITY,
        license: 'MIT'
      }
    }
  };
}

function withSyntheticRepository(options, work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-xstate-gate-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(options.packageJson || {}, null, 2));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(options.packageLock || {}, null, 2));
    if (typeof options.adapterSource === 'string') {
      const adapterPath = path.join(root, 'backend', 'services', 'xstateLifecycleAdapter.js');
      fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
      fs.writeFileSync(adapterPath, options.adapterSource);
    }
    return work(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function verifyChangedRegistry(changed, repositoryRoot) {
  const { gate, baseline, authorization } = fixture();
  return verifyRegistry({
    gate,
    registry: changed,
    baseline,
    authorization,
    repositoryRoot
  });
}

test('WP-B open-source admission is ordered and fail-closed', () => {
  const { report } = fixture();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.deepEqual(report.orderedStepIds, [...EXPECTED_STEP_IDS]);
  assert.equal(report.productionUseAuthorized, false);
});

test('XState candidate is exact-versioned but not production-authorized', () => {
  const { report } = fixture();
  assert.equal(report.candidates.xstate.exactVersion, XSTATE_VERSION);
  assert.equal(report.candidates.xstate.license, 'MIT');
  assert.equal(report.candidates.xstate.runtimeDependencyCount, 0);
  assert.equal(report.candidates.xstate.adoptionMode, 'DIRECT_DEPENDENCY');
  assert.equal(report.candidates.xstate.productionUseAuthorized, false);
  assert.equal(report.xstateProductionImportCount, 0);
  assert.deepEqual(report.xstateProductionImportPaths, []);
});

test('Temporal remains reference-only with zero imported assets', () => {
  const { report } = fixture();
  assert.equal(report.candidates.temporal.adoptionMode, 'REFERENCE_ONLY');
  assert.equal(report.candidates.temporal.importedPackageCount, 0);
  assert.equal(report.candidates.temporal.importedSourceFileCount, 0);
});

test('a candidate cannot complete step 6 while step 5 is incomplete', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.YANCE_RED_CONTRACT_FIRST = 'NOT_STARTED';
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'COMPLETE';
  withSyntheticRepository({ packageJson: exactPackageJson(), packageLock: exactPackageLock() }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_OPEN_SOURCE_STEP_COMPLETED_OUT_OF_ORDER'));
  });
});

test('XState production import before gate step 6 fails closed', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'NOT_STARTED';
  withSyntheticRepository({
    packageJson: exactPackageJson(),
    packageLock: exactPackageLock(),
    adapterSource: "'use strict'; const { createMachine } = require('xstate'); module.exports = { createMachine };\n"
  }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_IMPORTED_BEFORE_GATE_STEP_6'));
  });
});

test('step 6 admits the exact original package while keeping production imports at zero', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'COMPLETE';
  withSyntheticRepository({ packageJson: exactPackageJson(), packageLock: exactPackageLock() }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
    assert.equal(report.xstateOriginalModuleIntroduced, true);
    assert.equal(report.xstateProductionImportCount, 0);
    assert.deepEqual(report.xstateProductionImportPaths, []);
    assert.equal(report.productionUseAuthorized, false);
  });
});

test('step 6 fails closed when the package manifest or lock binding is absent', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'COMPLETE';
  withSyntheticRepository({ packageJson: { private: true }, packageLock: exactPackageLock() }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_PACKAGE_MANIFEST_INVALID'));
  });
  withSyntheticRepository({ packageJson: exactPackageJson(), packageLock: { lockfileVersion: 3, packages: {} } }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_LOCK_BINDING_INVALID'));
  });
});

test('production import remains forbidden until the Adapter boundary step is complete', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'COMPLETE';
  changed.candidates[0].gateSteps.UPSTREAM_TESTS_PASS = 'COMPLETE';
  changed.candidates[0].gateSteps.YANCE_ADAPTER_BOUNDARY = 'NOT_STARTED';
  withSyntheticRepository({
    packageJson: exactPackageJson(),
    packageLock: exactPackageLock(),
    adapterSource: "'use strict'; const { createMachine } = require('xstate'); module.exports = { createMachine };\n"
  }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_IMPORTED_BEFORE_ADAPTER_GATE'));
  });
});

test('repository admits the exact XState original module without enabling production use', () => {
  const { report, registry } = fixture();
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');

  assert.equal(xstate.gateSteps.INTRODUCE_ORIGINAL_MODULE, 'COMPLETE');
  assert.equal(xstate.gateSteps.UPSTREAM_TESTS_PASS, 'COMPLETE');
  assert.equal(xstate.gateSteps.YANCE_ADAPTER_BOUNDARY, 'NOT_STARTED');
  assert.equal(xstate.status, 'ORIGINAL_MODULE_INTRODUCED');
  assert.equal(xstate.productionUseAuthorized, false);
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.xstateOriginalModuleIntroduced, true);
  assert.deepEqual(report.xstatePackageBinding, {
    packageMentioned: true,
    manifestVersion: XSTATE_VERSION,
    rootLockVersion: XSTATE_VERSION,
    manifestExact: true,
    lockExact: true,
    runtimeDependencyCount: 0,
    exact: true
  });
  assert.equal(report.xstateProductionImportCount, 0);
  assert.deepEqual(report.xstateProductionImportPaths, []);
  assert.equal(report.productionUseAuthorized, false);
});
