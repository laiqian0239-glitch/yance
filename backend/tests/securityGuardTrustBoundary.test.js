'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SecurityGuard } = require('../core/securityGuard');

function createBridge(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    available: true,
    get: ref => values.get(ref) || null,
    has: ref => values.has(ref),
    listRefs: () => [...values.keys()],
    persist: async (ref, value) => { values.set(ref, value); return true; },
    remove: async ref => values.delete(ref),
    on() {},
    off() {}
  };
}

function createGuard(options = {}) {
  return new SecurityGuard({
    secureBridge: options.secureBridge || createBridge(),
    systemPolicy: options.systemPolicy || { assertWriteAllowed() {} },
    eventBus: { publish() {} },
    logger: { warn() {} }
  });
}

test('caller supplied actor strings cannot satisfy requireInternal', () => {
  const guard = createGuard();
  for (const actor of ['system', 'backend-core', 'desktop-core', 'platform-adapter', 'recovery-manager']) {
    assert.throws(
      () => guard.authorize('security.credential.read', { actor, requireInternal: true }),
      error => error.code === 'SECURITY_INTERNAL_ONLY'
    );
  }
});

test('credential facade owns the internal capability and ignores caller actor claims', () => {
  const guard = createGuard({ secureBridge: createBridge({ 'account:wa-1': { token: 'secret' } }) });
  assert.deepEqual(
    guard.credentials.get('account:wa-1', { actor: 'external-attacker', correlationId: 'corr-1' }),
    { token: 'secret' }
  );
});

test('safe-mode write exceptions are exact commands, never recovery prefixes', () => {
  const guard = createGuard();
  guard.setPolicyProviders({ safeModeProvider: () => true, lifecycleStateProvider: () => 'ready' });
  assert.doesNotThrow(() => guard.authorize('recovery.createBackup'));
  assert.throws(
    () => guard.authorize('recovery.createBackup.elevated'),
    error => error.code === 'SAFE_MODE_WRITE_BLOCKED'
  );
});

test('caller supplied write hints cannot change command-owned write classification', () => {
  let writePolicyCalls = 0;
  const guard = createGuard({
    systemPolicy: {
      assertWriteAllowed() { writePolicyCalls += 1; }
    }
  });

  const readDecision = guard.authorize('security.getState', { actor: 'external-caller', write: true });
  assert.equal(readDecision.write, false);
  assert.equal(writePolicyCalls, 0);

  const writeDecision = guard.authorize('security.saveCredential', { actor: 'external-caller', write: false });
  assert.equal(writeDecision.write, true);
  assert.equal(writePolicyCalls, 1);
});

test('caller supplied write hints cannot probe lifecycle or safe-mode write policy', () => {
  let writePolicyCalls = 0;
  const guard = createGuard({
    systemPolicy: {
      assertWriteAllowed() { writePolicyCalls += 1; }
    }
  });
  guard.setPolicyProviders({ safeModeProvider: () => true, lifecycleStateProvider: () => 'updating' });

  const decision = guard.authorize('security.getState', { actor: 'external-caller', write: true });
  assert.equal(decision.write, false);
  assert.equal(decision.safeMode, true);
  assert.equal(decision.lifecycleState, 'updating');
  assert.equal(writePolicyCalls, 0);
});

test('credential references reject path syntax, traversal and control characters', async () => {
  const guard = createGuard();
  for (const ref of ['../vault', 'account/wa-1', 'account\\wa-1', 'account:..:wa-1', ' account:wa-1 ', 'account:\nwa-1']) {
    assert.throws(() => guard.credentials.get(ref), error => error.code === 'INVALID_CREDENTIAL_REF');
  }
  await assert.rejects(
    guard.credentials.persist('../vault', { token: 'secret' }),
    error => error.code === 'INVALID_CREDENTIAL_REF'
  );
  assert.equal(guard.credentials.has(''), false);
  assert.equal(await guard.credentials.persist('model:openrouter.primary-1', { apiKey: 'secret' }), true);
});

test('policy providers become immutable after the first binding', () => {
  const guard = createGuard();
  guard.setPolicyProviders({ safeModeProvider: () => true, lifecycleStateProvider: () => 'ready' });
  assert.equal(guard.snapshot().safeMode, true);
  assert.throws(
    () => guard.setPolicyProviders({ safeModeProvider: () => false }),
    error => error.code === 'SECURITY_POLICY_PROVIDERS_SEALED'
  );
  assert.equal(guard.snapshot().safeMode, true);
});
