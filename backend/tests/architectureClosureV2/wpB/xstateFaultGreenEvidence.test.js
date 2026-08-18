'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../../../../governance/architecture-closure-v2/wp-b-xstate-fault-green-evidence.json');

const HEAD_PATTERN = /^[0-9a-f]{40}$/u;

test('XState fault GREEN evidence is exact-head, dual-platform and non-authorizing', () => {
  assert.equal(evidence.documentType, 'YANCE_ACV2_WP_B_XSTATE_FAULT_GREEN_EVIDENCE');
  assert.match(evidence.reviewedImplementationHead, HEAD_PATTERN);
  assert.equal(evidence.workflowRun.id, 30796337742);
  assert.equal(evidence.workflowRun.exactHeadCheckoutEnforced, true);

  for (const platformName of ['ubuntu', 'windows']) {
    const platform = evidence.workflowRun[platformName];
    assert.equal(platform.status, 'PASSED');
    assert.equal(platform.passCount, 12);
    assert.equal(platform.failCount, 0);
    assert.equal(platform.skipCount, 0);
    assert.ok(Number.isInteger(platform.jobId) && platform.jobId > 0);
  }

  for (const field of [
    'adapterBlobSha',
    'lifecycleBlobSha',
    'adapterContractBlobSha',
    'faultContractBlobSha'
  ]) {
    assert.match(evidence.sourceBinding[field], HEAD_PATTERN);
  }

  assert.deepEqual(evidence.faultCapabilities, [
    'RUNTIME_UNAVAILABLE_NORMALIZATION',
    'MISSING_RUNTIME_EXPORT',
    'CREATE_MACHINE_FAILURE_NORMALIZATION',
    'INITIAL_SNAPSHOT_FAILURE_NORMALIZATION',
    'TRANSITION_FAILURE_NORMALIZATION',
    'TRANSITION_PARITY_DIVERGENCE',
    'CONFIGURATION_REJECTED_BEFORE_RUNTIME_LOAD'
  ]);

  for (const gate of Object.values(evidence.crossWorkPackageRegression)) {
    assert.equal(gate.status, 'PASSED');
    assert.ok(Number.isInteger(gate.runId) && gate.runId > 0);
  }

  assert.equal(evidence.authorization.crossPlatformAndFaultValidationComplete, true);
  assert.equal(evidence.authorization.noticeSbomProvenanceComplete, false);
  assert.equal(evidence.authorization.independentReviewComplete, false);
  assert.equal(evidence.authorization.productionUseAuthorized, false);
  assert.equal(evidence.authorization.temporaryBypassAllowed, false);
});
