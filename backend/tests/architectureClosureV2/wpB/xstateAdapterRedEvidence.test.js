'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../../../../governance/architecture-closure-v2/wp-b-xstate-adapter-red-evidence.json');

const HEAD_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXPECTED_SIGNATURE = '06eb384582f663da87d53a7172491c29fbb87b171fcba84e9247bb140a4b3e07';

test('XState Adapter RED evidence is dual-platform, exact-head and fail-closed', () => {
  assert.equal(evidence.documentType, 'YANCE_ACV2_WP_B_XSTATE_ADAPTER_RED_EVIDENCE');
  assert.match(evidence.redHead, HEAD_PATTERN);
  assert.equal(evidence.workflowRun.id, 30792421897);
  assert.equal(evidence.workflowRun.exactHeadCheckoutEnforced, true);

  for (const platformName of ['ubuntu', 'windows']) {
    const platform = evidence.workflowRun[platformName];
    assert.equal(platform.status, 'VALID_CAPABILITY_RED');
    assert.equal(platform.failureCode, 'MODULE_NOT_FOUND');
    assert.equal(platform.missingModule, '../../../services/xstateLifecycleAdapter');
    assert.match(platform.normalizedFailureSha256, SHA256_PATTERN);
    assert.equal(platform.normalizedFailureSha256, EXPECTED_SIGNATURE);
    assert.ok(Number.isInteger(platform.jobId) && platform.jobId > 0);
  }

  assert.equal(evidence.contract.productionAdapterPresent, false);
  assert.equal(evidence.contract.productionXStateImportCount, 0);
  assert.deepEqual(evidence.contract.requiredCapabilities, [
    'SINGLE_XSTATE_IMPORT_BOUNDARY',
    'YANCE_GRAPH_PARITY',
    'FAIL_CLOSED_ILLEGAL_TRANSITIONS',
    'CONFIGURATION_SNAPSHOT_ISOLATION',
    'ZERO_DATABASE_TIME_OR_EXTERNAL_IO_AUTHORITY'
  ]);
  assert.equal(evidence.authorization.adapterImplementationMayProceed, true);
  assert.equal(evidence.authorization.adapterProductionUseAuthorized, false);
  assert.equal(evidence.authorization.crossPlatformFaultGateComplete, false);
  assert.equal(evidence.authorization.temporaryBypassAllowed, false);
});
