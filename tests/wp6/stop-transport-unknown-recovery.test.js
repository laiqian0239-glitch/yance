'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectionHarness, jsonResponse, runtimeSnapshot } = require('./helpers');

function abortingResponse(signal) {
  return new Promise((resolve, reject) => {
    const fail = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) return fail();
    signal?.addEventListener('abort', fail, { once: true });
  });
}

function createUnknownStopHarness() {
  const commandBodies = [];
  const durable = new Map();
  let stopSideEffects = 0;
  let commandCalls = 0;
  const fetch = async (url, init = {}) => {
    if (url.includes('/snapshot')) return jsonResponse(runtimeSnapshot());
    if (url.includes('/events')) {
      return jsonResponse({
        contractVersion: 2,
        buildId: 'wp6-test-build',
        fromSequenceExclusive: 7,
        lastAvailableSequence: 7,
        events: []
      });
    }
    if (url.includes('/commands')) {
      commandCalls += 1;
      const envelope = JSON.parse(init.body || '{}');
      commandBodies.push(envelope);
      const serialized = JSON.stringify(envelope);
      const existing = durable.get(envelope.commandId);
      if (existing) {
        if (existing.serialized !== serialized) {
          return jsonResponse({ ok: false, reasonCode: 'COMMAND_ID_REUSE_MISMATCH', message: 'mismatch' }, 409);
        }
        return jsonResponse({ ...existing.response, duplicate: true, recovered: true });
      }
      stopSideEffects += 1;
      const response = {
        contractVersion: 2,
        commandId: envelope.commandId,
        accepted: true,
        duplicate: false,
        stateVersion: envelope.expectedStateVersion + 1,
        resultingEventSequence: 8,
        reasonCode: null,
        result: { stopRequested: true }
      };
      durable.set(envelope.commandId, { serialized, response });
      return abortingResponse(init.signal);
    }
    return jsonResponse({ ok: false, reasonCode: 'NOT_FOUND' }, 404);
  };
  const harness = createProjectionHarness({ fetch });
  return {
    ...harness,
    commandBodies,
    durable,
    get stopSideEffects() { return stopSideEffects; },
    get commandCalls() { return commandCalls; }
  };
}

async function establish(harness) {
  await harness.coordinator.validateCandidateProjection();
  harness.setBackend({ ownerTrusted: true });
  await harness.coordinator.bindTrustedOwnerBaseline();
}

test('transport-unknown stop recovery reuses the retained commandId and exact envelope', async () => {
  const h = createUnknownStopHarness();
  await establish(h);

  await assert.rejects(
    h.coordinator.requestStop('lost-stop-response', { timeoutMs: 100 }),
    error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN'
  );

  const unknown = h.coordinator.snapshot();
  assert.equal(unknown.state, 'STOP_OUTCOME_UNKNOWN');
  assert.equal(unknown.stopOperation.status, 'TRANSPORT_OUTCOME_UNKNOWN');
  assert.ok(unknown.stopOperation.commandId);
  assert.ok(unknown.stopOperation.envelopeDigest);
  assert.equal(unknown.stopOperation.retainedEnvelope.commandId, unknown.stopOperation.commandId);
  assert.equal(h.commandCalls, 1);
  assert.equal(h.durable.size, 1);
  assert.equal(h.stopSideEffects, 1);

  const recovered = await h.coordinator.recoverStopOperation({ timeoutMs: 500 });
  const finalState = h.coordinator.snapshot();
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.duplicate, true);
  assert.equal(recovered.commandId, unknown.stopOperation.commandId);
  assert.equal(finalState.state, 'STOP_REQUEST_CONFIRMED');
  assert.equal(finalState.stopOperation.status, 'CONFIRMED');
  assert.equal(finalState.stopOperation.attempts, 2);
  assert.equal(finalState.stopOperation.recoveryAttempts, 1);
  assert.equal(h.commandCalls, 2);
  assert.equal(h.durable.size, 1);
  assert.equal(h.stopSideEffects, 1);
  assert.deepEqual(h.commandBodies[1], h.commandBodies[0]);
});

test('transport-unknown stop is never replayed to a changed owner or backend session', async () => {
  const h = createUnknownStopHarness();
  await establish(h);
  await assert.rejects(h.coordinator.requestStop('owner-change', { timeoutMs: 100 }), error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN');
  const retained = h.coordinator.snapshot().stopOperation;

  h.setBackend({
    backendPid: 2200,
    startupNonce: 'nonce-2',
    backendSessionId: 'backend-session-2',
    fd6PipeInstanceId: 'fd6-2',
    ownerSessionId: 'owner-session-2',
    apiSessionToken: 'token-secret-2',
    ownerTrusted: true
  });

  await assert.rejects(
    h.coordinator.recoverStopOperation({ timeoutMs: 500 }),
    error => error.reasonCode === 'WP6_STOP_RECOVERY_OWNER_SESSION_CHANGED'
  );
  const blocked = h.coordinator.snapshot();
  assert.equal(blocked.stopOperation.commandId, retained.commandId);
  assert.equal(blocked.stopOperation.status, 'FAILED_PERMANENT');
  assert.equal(blocked.state, 'STOP_RECOVERY_BLOCKED');
  assert.equal(h.commandCalls, 1);
  assert.equal(h.durable.size, 1);
  assert.equal(h.stopSideEffects, 1);
});

test('a conflicting stop envelope is rejected without replacing the retained operation', async () => {
  const h = createUnknownStopHarness();
  await establish(h);
  await assert.rejects(h.coordinator.requestStop('original-stop', { timeoutMs: 100 }), error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN');
  const before = h.coordinator.snapshot().stopOperation;

  await assert.rejects(
    async () => h.coordinator.requestStop('different-stop', { timeoutMs: 500 }),
    error => error.reasonCode === 'WP6_STOP_OPERATION_ENVELOPE_MISMATCH'
  );
  const after = h.coordinator.snapshot().stopOperation;
  assert.equal(after.commandId, before.commandId);
  assert.equal(after.envelopeDigest, before.envelopeDigest);
  assert.deepEqual(after.retainedEnvelope, before.retainedEnvelope);
  assert.equal(after.status, 'TRANSPORT_OUTCOME_UNKNOWN');
  assert.equal(h.commandCalls, 1);
  assert.equal(h.durable.size, 1);
  assert.equal(h.stopSideEffects, 1);
});

test('backend exit after unknown stop outcome enters exit recovery without creating a second intent', async () => {
  const h = createUnknownStopHarness();
  await establish(h);
  await assert.rejects(h.coordinator.requestStop('exit-after-unknown', { timeoutMs: 100 }), error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN');
  const retained = h.coordinator.snapshot().stopOperation;

  h.setBackend({ running: false, apiSessionEstablished: false, ownerTrusted: false });
  const recovery = await h.coordinator.recoverStopOperation({ timeoutMs: 500 });
  assert.equal(recovery.commandId, retained.commandId);
  assert.equal(recovery.backendExited, true);
  assert.equal(recovery.exitRecoveryRequired, true);
  assert.equal(h.commandCalls, 1);
  assert.equal(h.durable.size, 1);
  assert.equal(h.stopSideEffects, 1);
  assert.equal(h.coordinator.snapshot().state, 'STOP_OWNER_EXITED_RECOVERY_REQUIRED');

  const resolved = h.coordinator.resolveStopAfterProcessExit({ stopped: true, exitConfirmed: true, alreadyStopped: true });
  assert.equal(resolved.commandId, retained.commandId);
  assert.equal(resolved.status, 'PROCESS_CUSTODY_CONFIRMED');
  assert.equal(h.coordinator.snapshot().state, 'STOP_PROCESS_CUSTODY_CONFIRMED');
});

test('a confirmed stop remains locally idempotent and cannot create a second intent for the same owner', async () => {
  const h = createProjectionHarness();
  await establish(h);

  const first = await h.coordinator.requestStop('confirmed-idempotent');
  const firstState = h.coordinator.snapshot();
  const second = await h.coordinator.requestStop('confirmed-idempotent');
  const secondState = h.coordinator.snapshot();
  const commands = h.calls.filter(call => call.url.includes('/commands'));

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(second.commandId, first.commandId);
  assert.equal(firstState.stopOperation.commandId, secondState.stopOperation.commandId);
  assert.equal(secondState.stopOperation.status, 'CONFIRMED');
  assert.equal(secondState.metrics.stopCommandIntentsCreated, 1);
  assert.equal(commands.length, 1);
});

test('a new trusted owner cannot bind until retained stop process custody is resolved', async () => {
  const h = createUnknownStopHarness();
  await establish(h);
  await assert.rejects(h.coordinator.requestStop('owner-rebind-gate', { timeoutMs: 100 }), error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN');

  h.coordinator.discardBaseline('TEST_OWNER_ROTATION');
  h.setBackend({
    backendPid: 2200,
    startupNonce: 'nonce-2',
    backendSessionId: 'backend-session-2',
    fd6PipeInstanceId: 'fd6-2',
    ownerSessionId: 'owner-session-2',
    apiSessionToken: 'token-secret-2',
    ownerTrusted: true
  });
  await h.coordinator.validateCandidateProjection();
  await assert.rejects(
    h.coordinator.bindTrustedOwnerBaseline(),
    error => error.reasonCode === 'WP6_STOP_OPERATION_EXIT_RECOVERY_REQUIRED'
  );
});

test('resolved old stop operation is archived before a different trusted owner baseline is established', async () => {
  const h = createUnknownStopHarness();
  await establish(h);
  await assert.rejects(h.coordinator.requestStop('owner-rebind-after-exit', { timeoutMs: 100 }), error => error.reasonCode === 'TRANSPORT_OUTCOME_UNKNOWN');
  const oldCommandId = h.coordinator.snapshot().stopOperation.commandId;

  h.setBackend({ running: false, apiSessionEstablished: false, ownerTrusted: false });
  await h.coordinator.recoverStopOperation();
  h.coordinator.resolveStopAfterProcessExit({ stopped: true, exitConfirmed: true, alreadyStopped: true });
  h.coordinator.discardBaseline('TEST_OWNER_ROTATION_RESOLVED');
  h.setBackend({
    running: true,
    apiSessionEstablished: true,
    backendPid: 3300,
    startupNonce: 'nonce-3',
    backendSessionId: 'backend-session-3',
    fd6PipeInstanceId: 'fd6-3',
    ownerSessionId: 'owner-session-3',
    apiSessionToken: 'token-secret-3',
    ownerTrusted: true
  });
  await h.coordinator.validateCandidateProjection();
  await h.coordinator.bindTrustedOwnerBaseline();

  const rebound = h.coordinator.snapshot();
  assert.equal(rebound.trustedOwnerBound, true);
  assert.equal(rebound.stopOperation, null);
  assert.equal(rebound.lastStopOperation.commandId, oldCommandId);
  assert.equal(rebound.lastStopOperation.processCustody.exitConfirmed, true);
});
