'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateUpstreamTestEvidence
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REVIEWED_HEAD = '48961a5efc21e23b512988a3beb22b08ca8894d6';
const WORKFLOW_RUN_ID = 30809421417;
const PACKAGE_MANAGER = 'pnpm@9.15.9+sha512.68046141893c66fad01c079231128e9afb89ef87e2691d69e4d40eee228988295fd4682181bae55b58418c3a253bde65a505ec7c5f9403ece5cc3cd37dcf2531';
const UPSTREAM_COMMIT = 'c25dba07a2b68565edbe83d83c5d679dd85e00b2';
const TEST_SUMMARY = Object.freeze({
  testFilePassCount: 75,
  testFileFailCount: 0,
  testPassCount: 1747,
  testFailCount: 0,
  skipCount: 13,
  todoCount: 1
});

function realCoreEvidence() {
  return {
    upstreamTestSelection: ['XSTATE_PNPM_TEST_CORE'],
    upstreamTestCommand: 'corepack pnpm test:core',
    runtimeVersion: 'node@22',
    packageManager: PACKAGE_MANAGER,
    upstreamCommit: UPSTREAM_COMMIT,
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    reviewedHead: REVIEWED_HEAD,
    platforms: {
      ubuntu: {
        status: 'PASSED',
        reviewedHead: REVIEWED_HEAD,
        workflowRunId: WORKFLOW_RUN_ID,
        jobId: 91672352461,
        installLogSha256: '81df163ff138e68140c9926526319f949b0b952646ad1987283c4c1e59f53528',
        testLogSha256: 'b7ab83518fe8248f0e318fcfa88e2a47317cae6caefedc43fb20fbe5b0e0edec',
        testSummary: { ...TEST_SUMMARY }
      },
      windows: {
        status: 'PASSED',
        reviewedHead: REVIEWED_HEAD,
        workflowRunId: WORKFLOW_RUN_ID,
        jobId: 91672352425,
        installLogSha256: '43562ebd282ce1e8e607b5f66bfff6e2e1172135090ffbe83c107716acb1801d',
        testLogSha256: '733b4a9a1252115859d776f8ed6111b1a503856f15ba1cad57148ea510a84a42',
        testSummary: { ...TEST_SUMMARY }
      }
    }
  };
}

test('step 7 accepts only the real cross-platform XState pnpm test:core evidence', () => {
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

test('step 7 rejects missing, failed and cross-platform divergent Vitest summaries', () => {
  const evidence = realCoreEvidence();
  delete evidence.platforms.ubuntu.testSummary;
  evidence.platforms.windows.testSummary.testFailCount = 1;
  evidence.platforms.windows.testSummary.testPassCount = 1746;

  const reasons = validateUpstreamTestEvidence({ upstreamTestEvidence: evidence });
  assert.ok(reasons.includes('UBUNTU_TEST_SUMMARY_MISSING'));
  assert.ok(reasons.includes('WINDOWS_TESTFAILCOUNT_NONZERO'));
});
