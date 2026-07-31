'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AppRuntime } = require('../../backend/runtime/AppRuntime');

function runtimeHarness(mode) {
  let entered = 0;
  let exited = 0;
  const store = {
    snapshot: () => ({
      stateVersion: 9,
      runtime: { operatingMode: mode, operatingModeRevision: 4 },
      capabilities: {},
      diagnosticsSummary: {}
    })
  };
  const runtime = new AppRuntime({
    ownership: { guard: () => ({ leaseName: 'app-runtime', ownerInstanceId: 'owner', fencingToken: 1 }) },
    store,
    lifecycle: { state: 'api_contract_verified' },
    buildId: 'wp5-startup-apply-test'
  });
  runtime.composition = {
    accountContext: {
      enterSafeMode: async () => { entered += 1; },
      exitSafeMode: async () => { exited += 1; }
    },
    eventBus: { publish: () => {} },
    participants: [],
    logger: { warn: () => {} }
  };
  return { runtime, counts: () => ({ entered, exited }) };
}

test('safeMode is applied before production services and local-ready workers can proceed', async () => {
  const h = runtimeHarness('safeMode');
  assert.equal(h.runtime.productionServicesStarted, false);
  await h.runtime._applyOperatingMode('safeMode', { stateVersion: 4, source: 'startup-reconcile', recovering: true });
  assert.deepEqual(h.counts(), { entered: 1, exited: 0 });
  assert.equal(h.runtime.appliedOperatingMode, 'safeMode');
  assert.equal(h.runtime.appliedOperatingModeRevision, 4);
});

test('normal startup records the authority revision without prematurely resuming services', async () => {
  const h = runtimeHarness('normal');
  await h.runtime._applyOperatingMode('normal', { stateVersion: 4, source: 'startup-reconcile', recovering: true });
  assert.deepEqual(h.counts(), { entered: 0, exited: 0 });
  assert.equal(h.runtime.appliedOperatingMode, 'normal');
  assert.equal(h.runtime.appliedOperatingModeRevision, 4);
});
