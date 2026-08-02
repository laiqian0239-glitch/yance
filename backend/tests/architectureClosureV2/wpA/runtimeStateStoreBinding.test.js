'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');

function dependencies(db) {
  return {
    ownership: { guard: () => ({ ownerInstanceId: 'owner', fencingToken: 1 }) },
    store: {
      ...(db ? { db } : {}),
      snapshot: () => ({
        stateVersion: 1,
        lastEventSequence: 0,
        runtime: { operatingMode: 'normal', operatingModeRevision: 1 },
        capabilities: {},
        diagnosticsSummary: {}
      })
    },
    lifecycle: { state: 'runtime_state_ready' },
    buildId: 'acv2-a6-runtime-store-binding-test'
  };
}

function withAuthorityStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a6-runtime-store-'));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-runtime-store-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const authorityStore = broker.open();
  try {
    return callback({ host, authorityStore });
  } finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('runtime state store must expose the exact broker-owned primary database', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  try {
    withAuthorityStore(({ host, authorityStore }) => {
      AppRuntimeFactory.resetForTests();
      assert.throws(
        () => AppRuntimeFactory.create({
          ...dependencies(),
          authorityWriteHostCapability: host.capability,
          authorityStore
        }),
        error => error?.code === 'APP_RUNTIME_PRIMARY_DB_REQUIRED'
      );
      assert.equal(AppRuntimeFactory.current(), null);

      const runtime = AppRuntimeFactory.create({
        ...dependencies(authorityStore.db),
        authorityWriteHostCapability: host.capability,
        authorityStore
      });
      assert.equal(runtime.store.db, authorityStore.db);
      assert.equal(AppRuntimeFactory.clear(runtime), true);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});
