'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_STEP_IDS,
  findXStateImports,
  verifyRegistry
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const XSTATE_VERSION = '5.32.5';
const XSTATE_INTEGRITY = 'sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==';
const ADAPTER_PATH = 'backend/services/xstateLifecycleAdapter.js';

function fixture() {
  return {
    gate: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json'),
    registry: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json'),
    baseline: require('../../../../governance/architecture-closure-v2/wp-b-baseline.json'),
    authorization: require('../../../../governance/architecture-closure-v2/wp-b-design-authorization.json')
  };
}

function resetStepsAfter(candidate, lastCompletedStepId) {
  const lastCompletedIndex = EXPECTED_STEP_IDS.indexOf(lastCompletedStepId);
  assert.notEqual(lastCompletedIndex, -1, `unknown gate step: ${lastCompletedStepId}`);
  for (let index = lastCompletedIndex + 1; index < EXPECTED_STEP_IDS.length; index += 1) {
    candidate.gateSteps[EXPECTED_STEP_IDS[index]] = 'NOT_STARTED';
  }
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
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(options.packageJson || {}, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify(options.packageLock || {}, null, 2)}\n`);
    if (typeof options.adapterSource === 'string') {
      const adapterPath = path.join(root, ADAPTER_PATH);
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
  return verifyRegistry({ gate, registry: changed, baseline, authorization, repositoryRoot });
}

test('WP-B open-source sequence and fail-closed policy remain frozen', () => {
  const { gate } = fixture();
  assert.deepEqual(gate.requiredSequence.map(step => step.id), [...EXPECTED_STEP_IDS]);
  assert.equal(gate.enforcement.ordered, true);
  assert.equal(gate.enforcement.failClosed, true);
  assert.equal(gate.enforcement.temporaryBypassAllowed, false);
  assert.equal(gate.enforcement.warningOnlyAllowed, false);
});

test('XState cross-platform fault validation is complete while provenance and production use remain closed', () => {
  const { registry } = fixture();
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');
  const temporal = registry.candidates.find(candidate => candidate.project === 'Temporal');
  assert.equal(xstate.exactVersion, XSTATE_VERSION);
  assert.equal(xstate.license, 'MIT');
  assert.equal(xstate.runtimeDependencyCount, 0);
  assert.equal(xstate.adoptionMode, 'DIRECT_DEPENDENCY');
  assert.equal(xstate.productionUseAuthorized, false);
  assert.equal(xstate.gateSteps.INTRODUCE_ORIGINAL_MODULE, 'COMPLETE');
  assert.equal(xstate.gateSteps.UPSTREAM_TESTS_PASS, 'COMPLETE');
  assert.equal(xstate.gateSteps.YANCE_ADAPTER_BOUNDARY, 'COMPLETE');
  assert.equal(xstate.gateSteps.CROSS_PLATFORM_AND_FAULT_VALIDATION, 'COMPLETE');
  assert.equal(xstate.gateSteps.COPYRIGHT_NOTICE_SBOM_PROVENANCE, 'NOT_STARTED');
  assert.equal(xstate.gateSteps.INDEPENDENT_REVIEW, 'NOT_STARTED');
  assert.deepEqual(findXStateImports(REPO_ROOT), [ADAPTER_PATH]);
  assert.equal(temporal.adoptionMode, 'REFERENCE_ONLY');
  assert.equal(temporal.importedPackageCount, 0);
  assert.equal(temporal.importedSourceFileCount, 0);
});

test('a candidate cannot complete step 6 while step 5 is incomplete', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  resetStepsAfter(changed.candidates[0], 'INTRODUCE_ORIGINAL_MODULE');
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
  resetStepsAfter(changed.candidates[0], 'YANCE_RED_CONTRACT_FIRST');
  withSyntheticRepository({
    packageJson: exactPackageJson(),
    packageLock: exactPackageLock(),
    adapterSource: "'use strict'; const { createMachine } = require('xstate'); module.exports = { createMachine };\n"
  }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_IMPORTED_BEFORE_GATE_STEP_6'));
    assert.equal(report.violations.some(item => item.code === 'WP_B_OPEN_SOURCE_STEP_COMPLETED_OUT_OF_ORDER'), false);
  });
});

test('step 6 admits the exact physical package while keeping production imports at zero', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  resetStepsAfter(changed.candidates[0], 'INTRODUCE_ORIGINAL_MODULE');
  withSyntheticRepository({ packageJson: exactPackageJson(), packageLock: exactPackageLock() }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
    assert.equal(report.xstateOriginalModuleIntroduced, true);
    assert.equal(report.xstateProductionImportCount, 0);
    assert.equal(report.productionUseAuthorized, false);
  });
});

test('step 6 rejects missing manifest or physical lock binding', () => {
  const { registry } = fixture();
  const changed = structuredClone(registry);
  resetStepsAfter(changed.candidates[0], 'INTRODUCE_ORIGINAL_MODULE');
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
  resetStepsAfter(changed.candidates[0], 'UPSTREAM_TESTS_PASS');
  withSyntheticRepository({
    packageJson: exactPackageJson(),
    packageLock: exactPackageLock(),
    adapterSource: "'use strict'; const { createMachine } = require('xstate'); module.exports = { createMachine };\n"
  }, repositoryRoot => {
    const report = verifyChangedRegistry(changed, repositoryRoot);
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_IMPORTED_BEFORE_ADAPTER_GATE'));
    assert.equal(report.violations.some(item => item.code === 'WP_B_OPEN_SOURCE_STEP_COMPLETED_OUT_OF_ORDER'), false);
  });
});
