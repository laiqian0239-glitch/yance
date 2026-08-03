'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  EXPECTED_STEP_IDS,
  verifyFiles,
  verifyRegistry
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

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

test('WP-B open-source admission is ordered and fail-closed', () => {
  const { report } = fixture();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.deepEqual(report.orderedStepIds, [...EXPECTED_STEP_IDS]);
  assert.equal(report.productionUseAuthorized, false);
});

test('XState candidate is exact-versioned but not production-authorized', () => {
  const { report } = fixture();
  assert.equal(report.candidates.xstate.exactVersion, '5.32.5');
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

test('a candidate cannot complete a later step before an earlier incomplete step', () => {
  const { gate, registry, baseline, authorization } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.ADOPTION_MODE_DECISION = 'COMPLETE';
  const report = verifyRegistry({
    gate,
    registry: changed,
    baseline,
    authorization,
    repositoryRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_OPEN_SOURCE_STEP_COMPLETED_OUT_OF_ORDER'));
});

test('XState production import before gate step 6 fails closed', () => {
  const { gate, registry, baseline, authorization } = fixture();
  const changed = structuredClone(registry);
  changed.candidates[0].gateSteps.INTRODUCE_ORIGINAL_MODULE = 'NOT_STARTED';
  const report = verifyRegistry({
    gate,
    registry: changed,
    baseline,
    authorization,
    repositoryRoot: REPO_ROOT
  });
  assert.equal(report.xstateProductionImportCount, 0);
});
