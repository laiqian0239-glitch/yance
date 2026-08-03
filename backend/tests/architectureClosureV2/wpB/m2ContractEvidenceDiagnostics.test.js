'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  failureDiagnostics,
  publicReport
} = require('../../../../tools/architecture-closure-v2/run-wp-b-m2-contracts');

const EXPECTED_DIAGNOSTIC = Object.freeze({
  contractId: 'M2-AI-008',
  errorCode: 'ERR_ASSERTION',
  errorName: 'AssertionError',
  operator: 'deepStrictEqual',
  location: 'backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js:430:12',
  expected: Object.freeze({
    code: 'UNCERTAIN_REMOTE_OUTCOME',
    attemptId: 'attempt-ai-008'
  }),
  actual: Object.freeze({
    code: 'HOST_PROCESS_EXITED',
    attemptId: 'attempt-ai-008'
  })
});

const TAP_OUTPUT = `TAP version 13
# Subtest: M2-AI-008 preserves uncertain remote outcome
not ok 1 - M2-AI-008 preserves uncertain remote outcome
  ---
  duration_ms: 4.25
  location: '/home/runner/work/yance/yance/backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js:430:12'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly deep-equal:
    bearer secret-business-content@example.invalid https://example.invalid/private
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    code: 'UNCERTAIN_REMOTE_OUTCOME'
    attemptId: 'attempt-ai-008'
    payload: 'secret-business-content'
  actual:
    code: 'HOST_PROCESS_EXITED'
    attemptId: 'attempt-ai-008'
    payload: 'different-business-content'
  operator: 'deepStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/runner/work/yance/yance/backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js:430:12)
  ...
1..1
# tests 1
# pass 0
# fail 1
`;

const WINDOWS_TAP_OUTPUT = TAP_OUTPUT.replace(
  "'/home/runner/work/yance/yance/backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js:430:12'",
  "'D:\\\\a\\\\yance\\\\yance\\\\backend\\\\tests\\\\architectureClosureV2\\\\wpB\\\\aiProviderDurableMigration.test.js:430:12'"
);

test('M2 evidence diagnostics expose only bounded allowlisted assertion facts', () => {
  assert.equal(typeof failureDiagnostics, 'function');
  const diagnostics = failureDiagnostics(TAP_OUTPUT);
  assert.deepEqual(diagnostics, [EXPECTED_DIAGNOSTIC]);

  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes('secret-business-content'), false);
  assert.equal(serialized.includes('different-business-content'), false);
  assert.equal(serialized.includes('example.invalid'), false);
  assert.ok(serialized.length <= 1024);
});

test('M2 evidence diagnostics canonicalize Windows paths to one repository form', () => {
  assert.deepEqual(failureDiagnostics(WINDOWS_TAP_OUTPUT), [EXPECTED_DIAGNOSTIC]);
});

test('M2 public evidence includes diagnostics but never raw process output', () => {
  const evidence = publicReport({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_M2_CONTRACT_REPORT',
    mode: 'contract',
    status: 'RED',
    exitCode: 1,
    testFiles: ['contract.test.js'],
    testCount: 1,
    passCount: 0,
    failCount: 1,
    failureContractIds: ['M2-AI-008'],
    failureDiagnostics: [EXPECTED_DIAGNOSTIC],
    normalizedOutputSha256: '0'.repeat(64),
    matchedInfrastructurePattern: null,
    secretLeakCount: 0,
    businessContentLeakCount: 0,
    stdout: 'secret-business-content',
    stderr: 'different-business-content'
  });

  assert.deepEqual(evidence.failureDiagnostics, [EXPECTED_DIAGNOSTIC]);
  assert.equal(Object.hasOwn(evidence, 'stdout'), false);
  assert.equal(Object.hasOwn(evidence, 'stderr'), false);
});
