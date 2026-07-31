'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDesktopCredentialApplicationLifecycleMatrix } = require('../../tools/wp4/desktop-credential-application-lifecycle-matrix');

test('real Desktop Credential Application Lifecycle matrix closes stop, exit, FD6, commit, FD5, READY and application restart', async () => {
  const result = await runDesktopCredentialApplicationLifecycleMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.caseCount, 24);
  assert.equal(result.passedCount, 24);
  assert.ok(result.cases.every(row => row.productionChainExecuted === true));
  assert.equal(result.containmentProbes.status, 'PASS');
  assert.deepEqual(Object.keys(result.containmentProbes.probes).sort(), [
    'rejectedOwnerAlreadyReadyBypass',
    'rejectedOwnerEventualExitRecovery',
    'rejectedOwnerFd6Containment',
    'rejectedReadyOwnerStopFailure',
    'rejectedRuntimeProjectionOwnerStopFailure'
  ]);
  assert.equal(result.containmentProbes.probes.rejectedOwnerFd6Containment.prepareResult.accepted, false);
  assert.equal(result.containmentProbes.probes.rejectedOwnerFd6Containment.commitResult.accepted, false);
  assert.equal(result.containmentProbes.probes.rejectedOwnerEventualExitRecovery.finalState.coordinatorState, 'IDLE');
});
