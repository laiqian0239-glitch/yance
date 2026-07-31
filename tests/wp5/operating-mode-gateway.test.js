'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { createAuthorityHarness, envelope } = require('./helpers');

test('operating mode command persists applies publishes and replays without a second revision', async () => {
  const h = await createAuthorityHarness();
  let applies = 0;
  let publishes = 0;
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h.store, ownership: h.ownership,
      applyMode: async () => { applies += 1; },
      publishMode: async () => { publishes += 1; }
    });
    const input = envelope({ commandId: 'same-command', expectedStateVersion: 1, operatingMode: 'safeMode' });
    const first = await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    const replay = await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    assert.equal(first.stateVersion, 2);
    assert.equal(replay.stateVersion, 2);
    assert.equal(replay.duplicate, true);
    assert.equal(h.store.snapshot().stateVersion, 2);
    assert.equal(applies, 1);
    assert.equal(publishes, 1);
  } finally { await h.close(); }
});

test('same commandId with a different mutation is rejected before any second side effect', async () => {
  const h = await createAuthorityHarness();
  let applies = 0;
  try {
    const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => { applies += 1; } });
    const first = envelope({ commandId: 'conflict-command', expectedStateVersion: 1, operatingMode: 'safeMode' });
    await gateway.transition({ targetMode: 'safeMode', commandId: first.commandId, envelope: first });
    const conflict = envelope({ commandId: 'conflict-command', expectedStateVersion: 2, operatingMode: 'normal' });
    await assert.rejects(gateway.transition({ targetMode: 'normal', commandId: conflict.commandId, envelope: conflict }), error => error.code === 'COMMAND_ID_REUSE_MISMATCH');
    assert.equal(applies, 1);
    assert.equal(h.store.snapshot().runtime.operatingMode, 'safeMode');
  } finally { await h.close(); }
});

test('apply failure leaves a recoverable durable command and same command resumes without another revision', async () => {
  const h = await createAuthorityHarness();
  let fail = true;
  let applies = 0;
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h.store, ownership: h.ownership,
      applyMode: async () => { applies += 1; if (fail) throw Object.assign(new Error('apply failed'), { code: 'INJECTED_APPLY_FAILURE' }); }
    });
    const input = envelope({ commandId: 'resume-command', expectedStateVersion: 1, operatingMode: 'safeMode' });
    await assert.rejects(gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input }), error => error.code === 'OPERATING_MODE_APPLY_FAILED');
    assert.equal(h.store.snapshot().stateVersion, 2);
    const other = envelope({ commandId: 'other-command', expectedStateVersion: 2, operatingMode: 'normal' });
    await assert.rejects(gateway.transition({ targetMode: 'normal', commandId: other.commandId, envelope: other }), error => error.code === 'OPERATING_MODE_RECOVERY_REQUIRED');
    fail = false;
    const recovered = await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    assert.equal(recovered.stateVersion, 2);
    assert.equal(recovered.recovered, true);
    assert.equal(h.store.snapshot().stateVersion, 2);
    assert.equal(applies, 2);
  } finally { await h.close(); }
});

test('startup reconcile validates ledger against authority before applying any mode', async () => {
  const h = await createAuthorityHarness();
  let applies = 0;
  try {
    const input = envelope({ commandId: 'corrupt-command', expectedStateVersion: 1, operatingMode: 'safeMode' });
    h.store.persistOperatingModeCommand({ ...h.ownership.guard(), envelope: input, targetMode: 'safeMode', reason: 'test', source: 'test' });
    h.store.db.prepare("UPDATE command_idempotency SET committed_revision=999 WHERE command_id='corrupt-command'").run();
    const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => { applies += 1; } });
    await assert.rejects(gateway.reconcile(), error => error.code === 'OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH');
    assert.equal(applies, 0);
  } finally { await h.close(); }
});

test('generic runtime state and command writers cannot bypass the operating mode gateway', async () => {
  const h = await createAuthorityHarness();
  try {
    assert.throws(() => h.store.updateRuntimeState({ ...h.ownership.guard(), patch: { operatingMode: 'safeMode' } }), error => error.code === 'OPERATING_MODE_GATEWAY_REQUIRED');
    const input = envelope({ commandId: 'generic-bypass', expectedStateVersion: 1, operatingMode: 'safeMode' });
    assert.throws(() => h.store.executeCommand({
      ...h.ownership.guard(), envelope: input,
      execute: () => ({ patch: { operatingMode: 'safeMode' }, result: { bypass: true } })
    }), error => error.code === 'OPERATING_MODE_GATEWAY_REQUIRED');
    assert.equal(h.store.snapshot().runtime.operatingMode, 'normal');
  } finally { await h.close(); }
});

test('concurrent identical commandId shares one in-flight apply and publication', async () => {
  const h = await createAuthorityHarness();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let applies = 0;
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h.store, ownership: h.ownership,
      applyMode: async () => { applies += 1; await barrier; }
    });
    const input = envelope({ commandId: 'inflight-command', expectedStateVersion: 1, operatingMode: 'safeMode' });
    const first = gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    const second = gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(applies, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(h.store.snapshot().stateVersion, 2);
  } finally { await h.close(); }
});

test('publish failure is recovered from durable authority after a real ownership restart', async () => {
  const h1 = await createAuthorityHarness();
  const { parent, currentRoot, legacyRoot } = h1;
  const input = envelope({ commandId: 'restart-recovery', expectedStateVersion: 1, operatingMode: 'safeMode' });
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h1.store, ownership: h1.ownership,
      applyMode: async () => {},
      publishMode: async () => { throw Object.assign(new Error('publish unavailable'), { code: 'INJECTED_PUBLISH_FAILURE' }); }
    });
    await assert.rejects(gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input }), error => error.code === 'OPERATING_MODE_PUBLISH_FAILED');
    assert.equal(h1.store.snapshot().runtime.operatingMode, 'safeMode');
  } finally { await h1.close({ remove: false }); }

  const h2 = await createAuthorityHarness({ parent, currentRoot, legacyRoot });
  let applied = 0;
  let published = 0;
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h2.store, ownership: h2.ownership,
      applyMode: async () => { applied += 1; },
      publishMode: async () => { published += 1; }
    });
    const recovered = await gateway.reconcile();
    assert.equal(recovered.recoveredCommands, 1);
    assert.equal(applied, 1);
    assert.equal(published, 1);
    const replay = await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.stateVersion, 2);
  } finally { await h2.close(); }
});

test('startup recovery uses the durable operating-mode revision after lifecycle transitions advance global stateVersion', async () => {
  const h1 = await createAuthorityHarness();
  const { parent, currentRoot, legacyRoot } = h1;
  const input = envelope({ commandId: 'lifecycle-revision-recovery', expectedStateVersion: 1, operatingMode: 'safeMode' });
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h1.store,
      ownership: h1.ownership,
      applyMode: async () => {},
      publishMode: async () => { throw Object.assign(new Error('publish unavailable'), { code: 'INJECTED_PUBLISH_FAILURE' }); }
    });
    await assert.rejects(
      gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input }),
      error => error.code === 'OPERATING_MODE_PUBLISH_FAILED'
    );
    assert.equal(h1.store.getOperatingModeAuthority().operatingModeRevision, 2);
  } finally { await h1.close({ remove: false }); }

  const h2 = await createAuthorityHarness({ parent, currentRoot, legacyRoot });
  let appliedRevision = 0;
  try {
    const guard = h2.ownership.guard();
    h2.store.recordTransition({ ...guard, bootAttemptId: h2.ownership.bootAttemptId, buildId: h2.ownership.buildId, fromState: 'created', toState: 'manifest_verified' });
    h2.store.recordTransition({ ...guard, bootAttemptId: h2.ownership.bootAttemptId, buildId: h2.ownership.buildId, fromState: 'manifest_verified', toState: 'ownership_acquired' });
    h2.store.recordTransition({ ...guard, bootAttemptId: h2.ownership.bootAttemptId, buildId: h2.ownership.buildId, fromState: 'ownership_acquired', toState: 'database_ready' });
    const before = h2.store.snapshot();
    assert.ok(before.stateVersion > 2);
    assert.equal(before.runtime.operatingModeRevision, 2);

    const gateway = new OperatingModeTransitionGateway({
      store: h2.store,
      ownership: h2.ownership,
      applyMode: async (_mode, context) => { appliedRevision = context.stateVersion; },
      publishMode: async () => {}
    });
    const recovered = await gateway.reconcile();
    assert.equal(recovered.operatingModeRevision, 2);
    assert.equal(recovered.stateVersion, before.stateVersion);
    assert.equal(appliedRevision, 2);
    const replay = await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.stateVersion, 2);
  } finally { await h2.close(); }
});

test('durable operating-mode revision survives event retention pruning and restart', async () => {
  const h1 = await createAuthorityHarness();
  const { parent, currentRoot, legacyRoot } = h1;
  try {
    const gateway = new OperatingModeTransitionGateway({
      store: h1.store,
      ownership: h1.ownership,
      applyMode: async () => {},
      publishMode: async () => {}
    });
    const input = envelope({ commandId: 'event-retention-pruning', expectedStateVersion: 1, operatingMode: 'safeMode' });
    await gateway.transition({ targetMode: 'safeMode', commandId: input.commandId, envelope: input });
    assert.equal(h1.store.getOperatingModeAuthority().operatingModeRevision, 2);
    h1.store.db.prepare("DELETE FROM runtime_event WHERE event_type IN ('runtime.authority_initialized','runtime.operating_mode_persisted')").run();
    const afterPrune = h1.store.getOperatingModeAuthority();
    assert.equal(afterPrune.operatingMode, 'safeMode');
    assert.equal(afterPrune.operatingModeRevision, 2);
    assert.equal(afterPrune.eventSequence, 0);
  } finally { await h1.close({ remove: false }); }

  const h2 = await createAuthorityHarness({ parent, currentRoot, legacyRoot });
  try {
    const afterRestart = h2.store.getOperatingModeAuthority();
    assert.equal(afterRestart.operatingMode, 'safeMode');
    assert.equal(afterRestart.operatingModeRevision, 2);
  } finally { await h2.close(); }
});
