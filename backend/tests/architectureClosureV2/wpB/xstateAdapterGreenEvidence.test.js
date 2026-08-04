'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../../../../governance/architecture-closure-v2/wp-b-xstate-adapter-green-evidence.json');

const HEAD_PATTERN = /^[0-9a-f]{40}$/u;

test('XState Adapter GREEN evidence is exact-head, dual-platform and non-authorizing', () => {
  assert.equal(evidence.documentType, 'YANCE_ACV2_WP_B_XSTATE_ADAPTER_GREEN_EVIDENCE');
  assert.match(evidence.reviewedImplementationHead, HEAD_PATTERN);
  assert.equal(evidence.workflowRun.id, 30794133328);
  assert.equal(evidence.workflowRun.exactHeadCheckoutEnforced, true);

  for (const platformName of ['ubuntu', 'windows']) {
    const platform = evidence.workflowRun[platformName];
    assert.equal(platform.status, 'PASSED');
    assert.equal(platform.passCount, 5);
    assert.equal(platform.failCount, 0);
    assert.equal(platform.skipCount, 0);
    assert.ok(Number.isInteger(platform.jobId) && platform.jobId > 0);
  }

  assert.deepEqual(evidence.sourceBinding.productionXStateImportPaths, [
    'backend/services/xstateLifecycleAdapter.js'
  ]);
  assert.equal(evidence.sourceBinding.productionXStateImportCount, 1);
  for (const field of ['adapterBlobSha', 'lifecycleBlobSha', 'testBlobSha']) {
    assert.match(evidence.sourceBinding[field], HEAD_PATTERN);
  }
  assert.deepEqual(evidence.validatedCapabilities, [
    'SINGLE_XSTATE_IMPORT_BOUNDARY',
    'LAZY_RUNTIME_LOAD_BOUNDARY',
    'YANCE_GRAPH_PARITY',
    'FAIL_CLOSED_ILLEGAL_TRANSITIONS',
    'CONFIGURATION_SNAPSHOT_ISOLATION',
    'ZERO_DATABASE_TIME_OR_EXTERNAL_IO_AUTHORITY'
  ]);
  assert.equal(evidence.crossWorkPackageRegression.wp0Status, 'PASSED');
  assert.equal(evidence.crossWorkPackageRegression.wpAArchitectureStatus, 'PASSED');
  assert.equal(evidence.crossWorkPackageRegression.wpAPostMergeStatus, 'PASSED');
  assert.equal(evidence.authorization.adapterBoundaryComplete, true);
  assert.equal(evidence.authorization.crossPlatformAndFaultValidationComplete, false);
  assert.equal(evidence.authorization.productionUseAuthorized, false);
  assert.equal(evidence.authorization.temporaryBypassAllowed, false);
});
