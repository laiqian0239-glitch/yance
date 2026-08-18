'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  findXStateImports,
  inspectXStatePackageBinding,
  verifyCurrentXStateStatus,
  verifyFiles
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core');
const cliVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REGISTRY = require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json');
const EVIDENCE = require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json');
const SUPPLY_CHAIN_LOCK = require('../../../../governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json');
const HISTORICAL_RED = require('../../../../governance/architecture-closure-v2/wp-b-m1-red-evidence.json');

function verify(overrides = {}) {
  return verifyCurrentXStateStatus({
    registry: overrides.registry || structuredClone(REGISTRY),
    repositoryRoot: REPO_ROOT,
    packageBinding: inspectXStatePackageBinding(REPO_ROOT),
    xstateProductionImportPaths: findXStateImports(REPO_ROOT),
    productionUseAuthorized: false,
    evidence: overrides.evidence || structuredClone(EVIDENCE),
    supplyChainLock: overrides.supplyChainLock || structuredClone(SUPPLY_CHAIN_LOCK),
    historicalRedEvidence: overrides.historicalRedEvidence || structuredClone(HISTORICAL_RED)
  });
}

test('current XState adoption status is derived from physical gates and remains release-closed', () => {
  const report = verifyFiles(REPO_ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.deepEqual(report.xstateCurrentStatus.expected, {
    originalModuleIntroduced: true,
    upstreamTestsComplete: true,
    adapterIntroductionAuthorized: true,
    productionUseAuthorized: false,
    schema23Applied: true,
    formalRelease: false,
    publish: false,
    temporaryBypassAllowed: false
  });
  assert.equal(report.xstateCurrentStatus.historicalSchema23AppliedToProductionStartup, false);
  assert.equal(report.xstateCurrentStatus.schema23StartupBinding.applied, true);
});

test('current status authority rejects stale Adapter and Schema 23 flags independently', () => {
  const staleAdapterEvidence = structuredClone(EVIDENCE);
  staleAdapterEvidence.authorization.adapterIntroductionAuthorized = false;
  let report = verify({ evidence: staleAdapterEvidence });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item =>
    item.code === 'WP_B_XSTATE_ADOPTION_EVIDENCE_STATUS_MISMATCH'
      && item.field === 'adapterIntroductionAuthorized'
      && item.expected === true
      && item.actual === false
  ));

  const staleSchemaLock = structuredClone(SUPPLY_CHAIN_LOCK);
  staleSchemaLock.governance.schema23Applied = false;
  report = verify({ supplyChainLock: staleSchemaLock });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item =>
    item.code === 'WP_B_XSTATE_SUPPLY_CHAIN_STATUS_MISMATCH'
      && item.field === 'schema23Applied'
      && item.expected === true
      && item.actual === false
  ));
});

test('historical RED remains immutable while current Schema 23 startup is applied', () => {
  const mutatedHistorical = structuredClone(HISTORICAL_RED);
  mutatedHistorical.governance.schema23AppliedToProductionStartup = true;
  const report = verify({ historicalRedEvidence: mutatedHistorical });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_M1_HISTORICAL_SCHEMA23_RED_MUTATED'));
  assert.equal(EVIDENCE.authorization.schema23Applied, true);
  assert.equal(HISTORICAL_RED.governance.schema23AppliedToProductionStartup, false);
});


test('CLI verifier consumes the same derived current-status report as the core authority', () => {
  const report = cliVerifier.verifyFiles(REPO_ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.deepEqual(report.xstateCurrentStatus.expected, {
    originalModuleIntroduced: true,
    upstreamTestsComplete: true,
    adapterIntroductionAuthorized: true,
    productionUseAuthorized: false,
    schema23Applied: true,
    formalRelease: false,
    publish: false,
    temporaryBypassAllowed: false
  });
  assert.equal(report.productionUseAuthorized, false);
});
