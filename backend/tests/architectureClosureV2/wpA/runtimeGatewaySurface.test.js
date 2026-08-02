'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');

function minimalRuntimeDependencies() {
  return {
    ownership: { guard: () => ({ ownerInstanceId: 'owner', fencingToken: 1 }) },
    store: {
      snapshot: () => ({
        stateVersion: 1,
        lastEventSequence: 0,
        runtime: { operatingMode: 'normal', operatingModeRevision: 1 },
        capabilities: {},
        diagnosticsSummary: {}
      })
    },
    lifecycle: { state: 'runtime_state_ready' },
    buildId: 'acv2-a6-gateway-surface-test'
  };
}

function withAuthorityStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a6-gateway-surface-'));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-gateway-surface-host' });
  const broker = new SqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: host.capability
  });
  const authorityStore = broker.open();
  try {
    return callback({ host, authorityStore });
  } finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('readiness locks startup gateway surface against forged evidence methods', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  try {
    withAuthorityStore(({ host, authorityStore }) => {
      AppRuntimeFactory.resetForTests();
      const runtime = AppRuntimeFactory.create({
        ...minimalRuntimeDependencies(),
        authorityWriteHostCapability: host.capability,
        authorityStore
      });
      const gateway = runtime.configureProductionServices().authorityCommandGateway;

      AppRuntimeFactory.assertAuthorityReady();
      assert.equal(Object.isFrozen(gateway), true, 'gateway instance must reject own-property method shadowing');
      assert.equal(Object.isFrozen(Object.getPrototypeOf(gateway)), true, 'gateway prototype must reject process-wide method replacement');
      assert.throws(
        () => Object.defineProperty(gateway, 'snapshot', { value: () => ({ state: 'sealed' }) }),
        TypeError
      );
      assert.throws(
        () => Object.defineProperty(gateway, 'assertCanonicalBinding', { value: () => ({ bound: true }) }),
        TypeError
      );

      assert.equal(gateway.snapshot().state, 'open');
      gateway.seal();
      assert.equal(gateway.snapshot().state, 'sealed');
      AppRuntimeFactory.clear(runtime);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});
