'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_CONTRACTS,
  verifyEvidence,
  verifyFile
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-m1-red-evidence');
const {
  CONTRACTS: CAPTURE_CONTRACTS
} = require('../../../../tools/architecture-closure-v2/capture-wp-b-red-evidence');

function evidenceFixture() {
  return require('../../../../governance/architecture-closure-v2/wp-b-m1-red-evidence.json');
}

test('recorded Milestone 1 RED evidence authorizes Schema 23 startup registration only', () => {
  const report = verifyFile();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.sourceCommit, 'da773d5b29c1f54c6c14f6024c38b53ab7ca10bb');
  assert.equal(report.workflowRunId, 30779566915);
  assert.equal(report.platformCount, 2);
  assert.equal(report.contractCount, 7);
  assert.equal(report.schema23StartupRegistrationAuthorized, true);

  const evidence = evidenceFixture();
  assert.equal(evidence.authorization.automaticMilestoneClosureAuthorized, false);
  assert.equal(evidence.authorization.independentReviewRequired, true);
  assert.equal(evidence.governance.schema23AppliedToProductionStartup, false);
  assert.equal(evidence.governance.thirdPartyProductionUseAuthorized, false);
  assert.equal(evidence.governance.wpCAuthorized, false);
  assert.equal(evidence.governance.formalRelease, false);
  assert.equal(evidence.governance.publish, false);
});

test('every RED contract is bound to distinct Ubuntu and Windows output hashes', () => {
  const evidence = evidenceFixture();
  for (let index = 0; index < EXPECTED_CONTRACTS.length; index += 1) {
    const expected = EXPECTED_CONTRACTS[index];
    const ubuntu = evidence.platforms['ubuntu-latest'].contracts[index];
    const windows = evidence.platforms['windows-latest'].contracts[index];
    assert.equal(ubuntu.id, expected.id);
    assert.equal(windows.id, expected.id);
    assert.match(ubuntu.outputSha256, /^[a-f0-9]{64}$/u);
    assert.match(windows.outputSha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(ubuntu.outputSha256, windows.outputSha256);
  }
});

test('tampered RED output hash fails closed', () => {
  const changed = structuredClone(evidenceFixture());
  changed.platforms['ubuntu-latest'].contracts[0].outputSha256 = '0'.repeat(64);
  const report = verifyEvidence(changed);
  assert.equal(report.ok, false);
  assert.equal(report.schema23StartupRegistrationAuthorized, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_M1_RED_OUTPUT_HASH_INVALID'));
});

test('any infrastructure failure revokes Schema 23 startup registration authorization', () => {
  const changed = structuredClone(evidenceFixture());
  changed.platforms['windows-latest'].counts.invalidRedInfrastructure = 1;
  changed.platforms['windows-latest'].counts.validCapabilityRed = 6;
  const report = verifyEvidence(changed);
  assert.equal(report.ok, false);
  assert.equal(report.schema23StartupRegistrationAuthorized, false);
  assert.ok(report.violations.some(item => item.code === 'WP_B_M1_RED_PLATFORM_COUNTS_INVALID'));
});

test('release, publish, WP-C or bypass expansion invalidates the evidence', () => {
  for (const field of ['formalRelease', 'publish', 'wpCAuthorized', 'temporaryBypassAllowed']) {
    const changed = structuredClone(evidenceFixture());
    changed.governance[field] = true;
    const report = verifyEvidence(changed);
    assert.equal(report.ok, false, field);
    assert.equal(report.schema23StartupRegistrationAuthorized, false, field);
    assert.ok(report.violations.some(item => item.code === 'WP_B_M1_RED_GOVERNANCE_INVALID'), field);
  }
});


test('RED capture derives every indicator from the immutable verifier contract', () => {
  assert.deepEqual(
    CAPTURE_CONTRACTS.map(contract => ({
      id: contract.id,
      testPath: contract.testPath,
      matchedIndicators: [...contract.expectedMissingIndicators]
    })),
    EXPECTED_CONTRACTS.map(contract => ({
      id: contract.id,
      testPath: contract.testPath,
      matchedIndicators: [...contract.matchedIndicators]
    }))
  );
  const schema23 = CAPTURE_CONTRACTS.find(contract => contract.id === 'SCHEMA_23');
  assert.deepEqual(schema23.expectedMissingIndicators, ['architectureClosureV2WpB']);
});
