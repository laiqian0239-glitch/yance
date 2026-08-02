'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
const canonicalLedgerModule = require('../../../services/canonicalEventLedgerAuthority');

function dependencies(db) {
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
    buildId: 'acv2-a6-process-singleton-test'
  };
}

function withAuthorityStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a6-process-singleton-'));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-process-singleton-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const authorityStore = broker.open();
  try { return callback({ host, authorityStore }); }
  finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('AppRuntime and canonical ledger remain one process-lifetime graph until explicit test reset', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  try {
    AppRuntimeFactory.resetForTests();
    withAuthorityStore(({ host, authorityStore }) => {
      const options = {
        ...dependencies(authorityStore.db),
        authorityWriteHostCapability: host.capability,
        authorityStore
      };
      const runtime = AppRuntimeFactory.create(options);
      const ledger = runtime.configureProductionServices().authorities.canonicalEventLedgerAuthority;
      assert.equal(canonicalLedgerModule.isConfiguredSingleton(ledger), true);

      assert.equal(AppRuntimeFactory.clear(runtime), true);
      assert.equal(canonicalLedgerModule.isConfiguredSingleton(ledger), true);
      assert.throws(
        () => AppRuntimeFactory.create(options),
        error => error?.code === 'APP_RUNTIME_ALREADY_EXISTS'
      );

      AppRuntimeFactory.resetForTests();
      assert.equal(canonicalLedgerModule.isConfiguredSingleton(ledger), false);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});
