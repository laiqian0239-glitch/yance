'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  groupedProbeStatus,
  buildRejectedOwnerContainmentProbes
} = require('../../tools/wp4/desktop-credential-application-lifecycle-matrix');

const pass = id => ({ id, status: 'PASS' });

test('grouped containment probe distinguishes NOT_RUN, PARTIAL, PASS and FAIL', () => {
  assert.equal(groupedProbeStatus([null, null]), 'NOT_RUN');
  assert.equal(groupedProbeStatus([pass('a'), null]), 'PARTIAL');
  assert.equal(groupedProbeStatus([pass('a'), pass('b')]), 'PASS');
  assert.equal(groupedProbeStatus([pass('a'), { id: 'b', status: 'FAIL' }]), 'FAIL');
});

test('selected Windows target matrix reports unexecuted digest probe as NOT_RUN, not FAIL', () => {
  const probes = buildRejectedOwnerContainmentProbes([
    pass('A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'),
    pass('A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'),
    pass('A20_LIVE_REJECTED_OWNER_APPLICATION_EXIT_RETAINS_FENCE'),
    pass('A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER')
  ], { requireComplete: false });

  assert.equal(probes.status, 'PARTIAL');
  assert.equal(probes.complete, false);
  assert.deepEqual(probes.failures, []);
  assert.equal(probes.probes.rejectedReadyOwnerStopFailure.status, 'PARTIAL');
  assert.equal(probes.probes.rejectedReadyOwnerStopFailure.generationMismatchStatus, 'PASS');
  assert.equal(probes.probes.rejectedReadyOwnerStopFailure.digestMismatchStatus, 'NOT_RUN');
  assert.equal(probes.probes.rejectedReadyOwnerStopFailure.digestMismatch, null);
});

test('full containment evidence remains PASS only when every required probe is present and passing', () => {
  const cases = [
    {
      ...pass('A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'),
      childStillLive: true,
      applicationFenceActive: true,
      fd6Closed: true,
      coordinatorFinalState: 'FATAL_OWNER_CONTAINMENT',
      cleanupStopResult: { stopped: false, exitConfirmed: false }
    },
    pass('A13_READY_DIGEST_MISMATCH_SIGKILL_FAILURE_CONTAINED'),
    {
      ...pass('A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED'),
      childStillLive: true,
      applicationFenceActive: true,
      fd6Closed: true,
      coordinatorFinalState: 'FATAL_OWNER_CONTAINMENT'
    },
    pass('A15_FD6_MISSING_CLEANUP_STOP_FAILURE_CONTAINED'),
    { ...pass('A16_LIVE_REJECTED_OWNER_FD6_PREPARE_DENIED'), fd6RequestResult: { accepted: false }, applicationFence: { active: true }, coordinatorFinalState: 'FATAL_OWNER_CONTAINMENT' },
    { ...pass('A17_LIVE_REJECTED_OWNER_FD6_COMMIT_DENIED'), fd6RequestResult: { accepted: false }, applicationFence: { active: true }, coordinatorFinalState: 'FATAL_OWNER_CONTAINMENT' },
    { ...pass('A18_LIVE_REJECTED_OWNER_START_ALREADY_READY_DENIED'), alreadyReadyResult: { accepted: false }, applicationFence: { active: true }, coordinatorFinalState: 'FATAL_OWNER_CONTAINMENT' },
    { ...pass('A22_ALREADY_READY_REVALIDATES_RUNTIME_PROJECTION'), alreadyReadyResult: { accepted: false } },
    {
      ...pass('A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER'),
      beforeExit: { applicationFenceActive: true },
      afterExit: { applicationFenceActive: false },
      newOwnerStartResult: { accepted: true },
      finalState: { coordinatorState: 'IDLE' }
    }
  ];
  const probes = buildRejectedOwnerContainmentProbes(cases, { requireComplete: true });
  assert.equal(probes.status, 'PASS');
  assert.equal(probes.complete, true);
});
