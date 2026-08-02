'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');

function minimalRuntimeDependencies(db) {
  return {
    ownership: { guard: () => ({ ownerInstanceId: 'owner', fencingToken: 1 }) },
    store: {
      db,
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

function startupHandlers() {
  return Object.freeze(Object.assign(Object.create(null), {
    'startup.noop': () => ({ ok: true })
  }));
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

test('gateway class and instances are sealed before readiness can trust them', () => {
  assert.equal(
    Object.isFrozen(RuntimeAuthorityCommandGateway.prototype),
    true,
    'gateway prototype must be frozen when the module defines the authority class'
  );
  withAuthorityStore(({ host, authorityStore }) => {
    const gateway = new RuntimeAuthorityCommandGateway({
      runtime: { snapshot: () => ({ stateVersion: 1 }) },
      authorityWriteHostCapability: host.capability,
      authorityStore,
      commandHandlers: startupHandlers()
    });
    assert.equal(Object.isFrozen(gateway), true, 'gateway instance must be frozen at construction');
    assert.equal(gateway.snapshot().state, 'open');
    gateway.seal();
    assert.equal(gateway.snapshot().state, 'sealed');
  });
});

test('readiness rejects attempts to forge startup gateway evidence methods', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  try {
    withAuthorityStore(({ host, authorityStore }) => {
      AppRuntimeFactory.resetForTests();
      const runtime = AppRuntimeFactory.create({
        ...minimalRuntimeDependencies(authorityStore.db),
        authorityWriteHostCapability: host.capability,
        authorityStore
      });
      const gateway = runtime.configureProductionServices().authorityCommandGateway;

      assert.throws(
        () => Object.defineProperty(gateway, 'snapshot', { value: () => ({ state: 'sealed' }) }),
        TypeError
      );
      assert.throws(
        () => Object.defineProperty(gateway, 'assertCanonicalBinding', { value: () => ({ bound: true }) }),
        TypeError
      );
      AppRuntimeFactory.assertAuthorityReady();
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
