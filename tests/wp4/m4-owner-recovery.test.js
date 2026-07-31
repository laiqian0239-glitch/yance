'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { OwnerRecovery, STATES } = require('../../backend/services/ownerRecovery');

function makeRecovery(overrides = {}) {
  const events = [];
  const recovery = new OwnerRecovery({
    clock: () => '2026-07-10T00:00:00.000Z',
    recoveryWindowMs: overrides.windowMs != null ? overrides.windowMs : 5000,
    onRecoveryExpired: (reasonCode) => { events.push({ type: 'expired', reasonCode }); },
    ...overrides
  });
  return { recovery, events };
}

test('starts ACTIVE with the expected snapshot shape', () => {
  const { recovery } = makeRecovery();
  const snap = recovery.snapshot();
  assert.strictEqual(snap.state, STATES.ACTIVE);
  assert.strictEqual(snap.isRecovering, false);
  assert.strictEqual(snap.ownerExitCount, 0);
  assert.strictEqual(snap.recoveryCount, 0);
  assert.strictEqual(snap.expiryCount, 0);
  assert.strictEqual(recovery.isRecovering(), false);
});

test('markOwnerExited transitions to OWNER_EXIT_DETECTED and records metrics', () => {
  const { recovery } = makeRecovery();
  const ok = recovery.markOwnerExited('CREDENTIAL_VAULT_UNAVAILABLE');
  assert.strictEqual(ok, true);
  const snap = recovery.snapshot();
  assert.strictEqual(snap.state, STATES.OWNER_EXIT_DETECTED);
  assert.strictEqual(snap.isRecovering, true);
  assert.strictEqual(snap.ownerExitCount, 1);
  assert.strictEqual(snap.lastOwnerExitAtUtc, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(snap.lastReasonCode, 'CREDENTIAL_VAULT_UNAVAILABLE');
});

test('markOwnerExited is idempotent while in recovery', () => {
  const { recovery } = makeRecovery();
  assert.strictEqual(recovery.markOwnerExited('A'), true);
  assert.strictEqual(recovery.markOwnerExited('B'), false, 'second call must be ignored');
  const snap = recovery.snapshot();
  assert.strictEqual(snap.state, STATES.OWNER_EXIT_DETECTED);
  assert.strictEqual(snap.ownerExitCount, 1, 'only the first exit is counted');
  assert.strictEqual(snap.lastReasonCode, 'A');
});

test('recovery window expiry escalates via onRecoveryExpired (SIGTERM fallback)', async () => {
  const { recovery, events } = makeRecovery({ windowMs: 600 });
  recovery.markOwnerExited('CREDENTIAL_COMMIT_RESULT_INDETERMINATE');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const snap = recovery.snapshot();
  assert.strictEqual(snap.state, STATES.EXPIRED);
  assert.strictEqual(snap.expiryCount, 1);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'expired');
  assert.strictEqual(events[0].reasonCode, 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE');
});

test('attachNewOwner with valid context resumes ACTIVE and counts a recovery', () => {
  const { recovery } = makeRecovery();
  recovery.markOwnerExited('CREDENTIAL_VAULT_UNAVAILABLE');
  const result = recovery.attachNewOwner({ fd6PipeInstanceId: 'new-pipe-9', startupNonce: 'nonce-9', credentialGeneration: 7 });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.state, STATES.ACTIVE);
  assert.deepStrictEqual(result.ownerContext, { fd6PipeInstanceId: 'new-pipe-9', startupNonce: 'nonce-9', credentialGeneration: 7 });
  const snap = recovery.snapshot();
  assert.strictEqual(snap.state, STATES.ACTIVE);
  assert.strictEqual(snap.recoveryCount, 1);
  assert.strictEqual(snap.isRecovering, false);
});

test('attachNewOwner rejects a context missing required fields', () => {
  const { recovery } = makeRecovery();
  recovery.markOwnerExited('CREDENTIAL_VAULT_UNAVAILABLE');
  assert.throws(() => recovery.attachNewOwner({ fd6PipeInstanceId: 'x' }), (e) => e.reasonCode === 'WP4_OWNER_RECOVERY_CONTEXT_REJECTED');
  assert.throws(() => recovery.attachNewOwner({ startupNonce: 'y' }), (e) => e.reasonCode === 'WP4_OWNER_RECOVERY_CONTEXT_REJECTED');
  assert.strictEqual(recovery.snapshot().state, STATES.OWNER_EXIT_DETECTED, 'still awaiting valid re-attach');
});

test('attachNewOwner without a pending exit throws OWNER_RECOVERY_NOT_PENDING', () => {
  const { recovery } = makeRecovery();
  assert.throws(() => recovery.attachNewOwner({ fd6PipeInstanceId: 'p', startupNonce: 'n' }), (e) => e.reasonCode === 'OWNER_RECOVERY_NOT_PENDING');
});

test('attachNewOwner after expiry throws OWNER_RECOVERY_EXPIRED', async () => {
  const { recovery } = makeRecovery({ windowMs: 600 });
  recovery.markOwnerExited('CREDENTIAL_VAULT_UNAVAILABLE');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(recovery.snapshot().state, STATES.EXPIRED);
  assert.throws(() => recovery.attachNewOwner({ fd6PipeInstanceId: 'p', startupNonce: 'n' }), (e) => e.reasonCode === 'OWNER_RECOVERY_EXPIRED');
});

test('successful re-attach cancels the expiry timer so onRecoveryExpired does not fire', async () => {
  const { recovery, events } = makeRecovery({ windowMs: 200 });
  recovery.markOwnerExited('CREDENTIAL_VAULT_UNAVAILABLE');
  await new Promise((resolve) => setTimeout(resolve, 40));
  recovery.attachNewOwner({ fd6PipeInstanceId: 'p', startupNonce: 'n' });
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.strictEqual(events.length, 0, 'expiry must be cancelled by the recovery');
  assert.strictEqual(recovery.snapshot().state, STATES.ACTIVE);
});
