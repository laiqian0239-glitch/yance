'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateUpstreamTestEvidence
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REVIEWED_HEAD = '32b4f962b909a7ec3d68374c116b00414be11e13';
const LOG_SHA256 = '891d98c2066fec37e9bc6d33089521d5b1326239bdc0694a3a174f5e2b0b9f7c';

function realCoreEvidence() {
  return {
    upstreamTestSelection: ['XSTATE_PNPM_TEST_CORE'],
    upstreamTestCommand: 'corepack pnpm test:core',
    runtimeVersion: 'node@22',
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    reviewedHead: REVIEWED_HEAD,
    platforms: {
      ubuntu: {
        status: 'PASSED',
        reviewedHead: REVIEWED_HEAD,
        workflowRunId: 30808750458,
        jobId: 91670159842,
        testLogSha256: LOG_SHA256
      },
      windows: {
        status: 'PASSED',
        reviewedHead: REVIEWED_HEAD,
        workflowRunId: 30808750458,
        jobId: 91670159764,
        testLogSha256: LOG_SHA256
      }
    }
  };
}

test('step 7 accepts only the real XState pnpm test:core evidence shape', () => {
  assert.deepEqual(validateUpstreamTestEvidence({ upstreamTestEvidence: realCoreEvidence() }), []);
});

test('step 7 rejects the former Yance-authored conformance selection', () => {
  const evidence = realCoreEvidence();
  evidence.upstreamTestSelection = [
    'PACKAGE_EXPORTS_PRESENT',
    'INITIAL_SNAPSHOT',
    'UNHANDLED_EVENT_STABILITY',
    'ACTOR_TRANSITION_SEQUENCE',
    'FINAL_STATE_STATUS'
  ];
  evidence.passCount = 5;
  evidence.upstreamTestCommand = 'node tools/architecture-closure-v2/verify-wp-b-xstate-upstream.js';

  const reasons = validateUpstreamTestEvidence({ upstreamTestEvidence: evidence });
  assert.ok(reasons.includes('SELECTION_INVALID'));
  assert.ok(reasons.includes('COMMAND_INVALID'));
  assert.ok(reasons.includes('PASS_COUNT_INVALID'));
});
