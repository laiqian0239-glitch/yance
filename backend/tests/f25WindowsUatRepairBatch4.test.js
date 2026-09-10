'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeSafetySupervisor } = require('../services/runtimeSafetySupervisor');

test('automatic safety supervisor isolates an unknown-send capability without global safe mode', async () => {
  const transitions = [];
  const runtime = {
    operatingMode: 'normal',
    async enterSafeMode(reason, metadata) { transitions.push({ reason, metadata }); this.operatingMode = 'safeMode'; }
  };
  const supervisor = new RuntimeSafetySupervisor({
    runtime,
    sendQueue: { status: () => ({ resumeBlocked: true, outcomeUnknown: 1, pausedReason: 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN' }) },
    modelStatus: { read: () => ({ routeIntegrity: { pass: true, invalidPersistedRouteCount: 0, quarantine: [] } }) },
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 0 } }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} },
    intervalMs: 60_000
  });
  await supervisor.evaluate();
  await supervisor.evaluate();
  assert.equal(transitions.length, 0);
  assert.equal(runtime.operatingMode, 'normal');
  const snapshot = supervisor.snapshot();
  assert.equal(snapshot.manualReviewRequired, true);
  assert.equal(snapshot.globalWriteBlocked, false);
  assert.equal(snapshot.capabilities.send.blocked, true);
  assert.deepEqual(snapshot.capabilities.send.reasons, ['SEND_OUTCOME_UNKNOWN']);
});
