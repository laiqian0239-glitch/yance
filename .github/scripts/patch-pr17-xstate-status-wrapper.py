#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / 'tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js'
TEST = ROOT / 'backend/tests/architectureClosureV2/wpB/xstateAdoptionCurrentStatus.test.js'

source = WRAPPER.read_text(encoding='utf-8')
before_governance = """  if (authority.governance.temporaryBypassAllowed !== false
      || authority.governance.productionUseAuthorized !== false
      || authority.governance.adapterIntroductionAuthorized !== false) {
    violations.push({ code: 'WP_B_XSTATE_SUPPLY_CHAIN_GOVERNANCE_INVALID' });
  }
"""
after_governance = """  if (authority.governance.temporaryBypassAllowed !== false
      || authority.governance.productionUseAuthorized !== false) {
    violations.push({ code: 'WP_B_XSTATE_SUPPLY_CHAIN_RELEASE_GOVERNANCE_INVALID' });
  }
"""
if source.count(before_governance) != 1:
    raise RuntimeError('stale wrapper governance block is not unique')
source = source.replace(before_governance, after_governance, 1)

before_verify_files = """function verifyFiles(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  const registry = readJson(repositoryRoot, core.REGISTRY_PATH);
  const report = verifyRegistry({
    gate: readJson(repositoryRoot, core.GATE_PATH),
    registry,
    baseline: readJson(repositoryRoot, core.BASELINE_PATH),
    authorization: readJson(repositoryRoot, core.AUTHORIZATION_PATH),
    repositoryRoot
  });
  const violations = [
    ...report.violations,
    ...compareArtifactBindings({ repositoryRoot, registry, evidence: readJson(repositoryRoot, EVIDENCE_PATH) })
  ];
  return Object.freeze({
    ...report,
    schemaVersion: 6,
    ok: violations.length === 0,
    productionUseAuthorized: report.productionUseAuthorized && violations.length === 0,
    supplyChainAuthorityPath: core.SUPPLY_CHAIN_LOCK_PATH,
    violations
  });
}
"""
after_verify_files = """function verifyFiles(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  const registry = readJson(repositoryRoot, core.REGISTRY_PATH);
  const coreReport = core.verifyFiles(repositoryRoot);
  const violations = [...coreReport.violations];
  const xstate = coreReport.candidates && coreReport.candidates.xstate;
  if (xstate && xstate.gateSteps && xstate.gateSteps.UPSTREAM_TESTS_PASS === 'COMPLETE') {
    const reasons = validateUpstreamTestEvidence(xstate);
    if (reasons.length !== 0) violations.push({ code: 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID', reasons });
  }
  violations.push(...compareArtifactBindings({
    repositoryRoot,
    registry,
    evidence: readJson(repositoryRoot, EVIDENCE_PATH)
  }));
  return Object.freeze({
    ...coreReport,
    schemaVersion: 7,
    ok: violations.length === 0,
    productionUseAuthorized: coreReport.productionUseAuthorized && violations.length === 0,
    supplyChainAuthorityPath: core.SUPPLY_CHAIN_LOCK_PATH,
    violations: Object.freeze(violations.map(item => Object.freeze(item)))
  });
}
"""
if source.count(before_verify_files) != 1:
    raise RuntimeError('stale wrapper verifyFiles block is not unique')
source = source.replace(before_verify_files, after_verify_files, 1)
WRAPPER.write_text(source, encoding='utf-8')

test_source = TEST.read_text(encoding='utf-8')
import_anchor = "} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core');\n"
import_replacement = import_anchor + "const cliVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');\n"
if test_source.count(import_anchor) != 1:
    raise RuntimeError('current status test core import is not unique')
test_source = test_source.replace(import_anchor, import_replacement, 1)
addition = r'''

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
'''
if "CLI verifier consumes the same derived current-status report" in test_source:
    raise RuntimeError('CLI status authority test already exists')
TEST.write_text(test_source + addition, encoding='utf-8')
print('PR17_XSTATE_STATUS_WRAPPER_PATCHED')
