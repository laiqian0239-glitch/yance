'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');

const KEY_REFERENCE = 'whatsapp-auth-data-key:v1';

function minimalRuntimeDependencies(db) {
  return {
    ownership: {
      guard: () => ({ ownerInstanceId: 'oss1a-key-runtime-order-owner', fencingToken: 1 })
    },
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
    buildId: 'oss1a-key-runtime-order-test'
  };
}

async function withAuthorityStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-key-order-'));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({
    dbPath,
    instanceId: 'oss1a-key-runtime-order-host'
  });
  const broker = new SqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: host.capability
  });
  const authorityStore = broker.open();
  try {
    return await callback({ host, authorityStore });
  } finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

test('real AppRuntimeComposition places the critical key authority before account startup and fails closed without vault custody', async () => {
  const previousReset = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');

  try {
    AppRuntimeFactory.resetForTests();
    await withAuthorityStore(async ({ host, authorityStore }) => {
      const dependencies = minimalRuntimeDependencies(authorityStore.db);
      const runtime = AppRuntimeFactory.create({
        ...dependencies,
        authorityWriteHostCapability: host.capability,
        authorityStore
      });
      const composition = runtime.configureProductionServices();
      const participants = composition.participants;
      const names = participants.map(row => row.name);
      const securityIndex = names.indexOf('security-guard');
      const keyAuthorityIndex = names.indexOf('whatsapp-auth-key-authority');
      const lifecycleIndex = names.indexOf('account-lifecycle-saga');
      const accountContextIndex = names.indexOf('account-context');

      assert.equal(securityIndex, 0, 'security guard must remain the first participant');
      assert.equal(
        keyAuthorityIndex,
        securityIndex + 1,
        'WhatsApp key authority must immediately follow security guard'
      );
      assert.ok(lifecycleIndex > keyAuthorityIndex, 'account lifecycle must start after key custody');
      assert.ok(accountContextIndex > keyAuthorityIndex, 'account context must start after key custody');

      const keyAuthorityRow = participants[keyAuthorityIndex];
      assert.equal(keyAuthorityRow?.critical, true, 'key authority must be critical');
      assert.equal(
        composition.whatsappAuthKeyAuthority,
        keyAuthorityRow?.service,
        'composition must expose the same key authority capability used by startup ordering'
      );
      assert.throws(
        () => composition.whatsappAuthKeyAuthority.getCipher(),
        expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_NOT_STARTED')
      );

      assert.equal(composition.securityGuard.available, false);
      assert.equal(composition.securityGuard.credentials.has(KEY_REFERENCE), false);
      assert.equal(composition.accountContext.snapshot().ready, false);

      await assert.rejects(
        runtime.startProductionServices(),
        expectCode('WHATSAPP_AUTH_KEY_SECURE_STORAGE_UNAVAILABLE')
      );

      assert.equal(runtime.productionServicesStarted, false);
      assert.equal(composition.accountContext.snapshot().ready, false);
      assert.equal(
        composition.securityGuard.credentials.has(KEY_REFERENCE),
        false,
        'vault-unavailable startup must not create a process-local or fallback key'
      );
      assert.throws(
        () => composition.whatsappAuthKeyAuthority.getCipher(),
        expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_NOT_STARTED')
      );

      AppRuntimeFactory.clear(runtime);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previousReset == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previousReset;
  }
});
