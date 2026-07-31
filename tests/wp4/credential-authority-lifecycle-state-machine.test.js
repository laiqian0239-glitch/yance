'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, TRANSITIONS, canTransition, sameOwnerSession, validateOwnerSession } = require('../../shared/credentialAuthorityLifecycleStateMachine');

test('Credential Authority Lifecycle exposes all required states and only declared transitions', () => {
  assert.deepEqual(Object.keys(STATES).sort(), ['ACTIVE','BOOTSTRAP_COMMITTING','BOOTSTRAP_PREPARING','LEGACY_AUTHORITY_DETECTED','MIGRATION_COMMITTING','MIGRATION_PREPARING','OWNER_EXIT_RECOVERY','UNAVAILABLE','UNINITIALIZED']);
  for (const [from, targets] of Object.entries(TRANSITIONS)) for (const to of targets) assert.equal(canTransition(from, to), true, `${from}->${to}`);
  assert.equal(canTransition(STATES.UNAVAILABLE, STATES.ACTIVE), false);
  assert.equal(canTransition(STATES.ACTIVE, STATES.BOOTSTRAP_PREPARING), false);
});

test('backend owner session identity cannot be reduced to PID', () => {
  const base = { backendPid: 1234, startupNonce: 'nonce-a', backendSessionId: 'session-a', manifestSha256: 'a'.repeat(64), vaultEpoch: 'epoch-a', hydrationGeneration: 1, fd6PipeInstanceId: 'pipe-a' };
  assert.equal(validateOwnerSession(base), base);
  assert.equal(sameOwnerSession(base, { ...base }), true);
  for (const field of ['startupNonce','backendSessionId','manifestSha256','vaultEpoch','hydrationGeneration','fd6PipeInstanceId']) assert.equal(sameOwnerSession(base, { ...base, [field]: field === 'hydrationGeneration' ? 2 : `${base[field]}-other` }), false, field);
});
