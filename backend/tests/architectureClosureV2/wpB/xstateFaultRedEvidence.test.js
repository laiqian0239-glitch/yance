'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const evidence = require('../../../../governance/architecture-closure-v2/wp-b-xstate-fault-red-evidence.json');

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value.map(item => ({
    actualExit: item.observedChildExit,
    expectedCode: item.expectedCode,
    id: item.id,
    phase: item.phase
  })))).digest('hex');
}

test('XState fault RED evidence is exact-head, dual-platform and capability-only', () => {
  assert.equal(evidence.documentType, 'YANCE_ACV2_WP_B_XSTATE_FAULT_RED_EVIDENCE');
  assert.match(evidence.redHead, /^[0-9a-f]{40}$/u);
  assert.equal(evidence.workflowRun.id, 30795156540);
  assert.equal(evidence.workflowRun.exactHeadCheckoutEnforced, true);

  for (const platformName of ['ubuntu', 'windows']) {
    const platform = evidence.workflowRun[platformName];
    assert.equal(platform.status, 'VALID_CAPABILITY_RED');
    assert.equal(platform.passCount, 8);
    assert.equal(platform.validCapabilityRed, 4);
    assert.equal(platform.invalidRedInfrastructure, 0);
    assert.ok(Number.isInteger(platform.jobId) && platform.jobId > 0);
  }

  assert.deepEqual(evidence.normalizedFailureSet.failures.map(item => item.id), [
    'RUNTIME_UNAVAILABLE_NORMALIZATION',
    'CREATE_MACHINE_FAILURE_NORMALIZATION',
    'INITIAL_SNAPSHOT_FAILURE_NORMALIZATION',
    'TRANSITION_FAILURE_NORMALIZATION'
  ]);
  assert.equal(canonicalSha256(evidence.normalizedFailureSet.failures), evidence.normalizedFailureSet.sha256);
  assert.deepEqual(evidence.alreadyGreenFaultContracts, [
    'MISSING_RUNTIME_EXPORT',
    'TRANSITION_PARITY_DIVERGENCE',
    'CONFIGURATION_REJECTED_BEFORE_RUNTIME_LOAD'
  ]);
  assert.equal(evidence.authorization.faultBoundaryImplementationMayProceed, true);
  assert.equal(evidence.authorization.crossPlatformAndFaultValidationComplete, false);
  assert.equal(evidence.authorization.productionUseAuthorized, false);
  assert.equal(evidence.authorization.temporaryBypassAllowed, false);
});
