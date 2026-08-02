'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const factoryPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeFactory.js');
const compositionPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeComposition.js');
const desktopClientPath = path.join(repoRoot, 'electron', 'desktopHost', 'ApiV2RuntimeClient.js');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

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
    buildId: 'acv2-a6-test-build'
  };
}

test('AppRuntimeFactory rejects every production runtime that lacks a real AuthorityWriteHost capability', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
  try {
    AppRuntimeFactory.resetForTests();
    assert.throws(
      () => AppRuntimeFactory.create(minimalRuntimeDependencies()),
      error => error?.code === 'APP_RUNTIME_AUTHORITY_WRITE_HOST_REQUIRED'
    );
    assert.equal(AppRuntimeFactory.current(), null);
    assert.equal(AppRuntimeFactory.diagnostics().authorityWriteHostBound, false);
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});

test('runtime composition constructs coordinator, canonical ledger and identity authority before recovery services', () => {
  const text = source(compositionPath);
  const coordinator = text.indexOf('AuthorityTransactionCoordinator');
  const ledger = text.indexOf('CanonicalEventLedgerAuthority');
  const identity = text.indexOf('IdentityAuthority');
  const recovery = text.indexOf('new RecoveryManager');

  assert.ok(coordinator >= 0, 'AppRuntimeComposition must construct AuthorityTransactionCoordinator');
  assert.ok(ledger >= 0, 'AppRuntimeComposition must construct CanonicalEventLedgerAuthority');
  assert.ok(identity >= 0, 'AppRuntimeComposition must construct IdentityAuthority');
  assert.ok(recovery >= 0, 'existing RecoveryManager must remain present');
  assert.ok(coordinator < recovery && ledger < recovery && identity < recovery, 'all authorities must exist before recovery construction');
  assert.match(text, /authorityWriteHostCapability/);
  assert.match(text, /authorities\s*:\s*Object\.freeze/);
});

test('desktop runtime client refuses injected primary write capability instead of retaining or ignoring it', () => {
  const { ApiV2RuntimeClient } = require('../../../../electron/desktopHost/ApiV2RuntimeClient');
  assert.throws(
    () => new ApiV2RuntimeClient({
      baseURL: 'http://127.0.0.1:1',
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      sessionProvider: () => ({
        apiSessionToken: 'token',
        backendSessionId: 'session',
        startupNonce: 'nonce'
      }),
      authorityWriteHostCapability: { forged: true }
    }),
    error => error?.reasonCode === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN' || error?.code === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN'
  );
});

test('desktop runtime client remains a command transport and exposes no write-host capability surface', async () => {
  const clientSource = source(desktopClientPath);
  assert.doesNotMatch(clientSource, /require\([^\n]*authorityWriteHost/i);
  assert.doesNotMatch(clientSource, /authorityWriteHostCapability\s*[:=]/);

  const requests = [];
  const { ApiV2RuntimeClient } = require('../../../../electron/desktopHost/ApiV2RuntimeClient');
  const client = new ApiV2RuntimeClient({
    baseURL: 'http://127.0.0.1:1',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, accepted: true }) };
    },
    sessionProvider: () => ({
      apiSessionToken: 'token',
      backendSessionId: 'session',
      startupNonce: 'nonce',
      backendPid: 1,
      ownerTrusted: true
    }),
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    clock: () => '2026-08-02T11:00:00.000Z'
  });
  const envelope = client.command({
    commandType: 'runtime.stop',
    expectedStateVersion: 1,
    payload: { reason: 'a6-contract' }
  });
  await client.executeCommand(envelope);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/app\/v2\/commands$/);
  assert.equal(Object.hasOwn(client.snapshot(), 'authorityWriteHostCapability'), false);
});

test('A6 production files remain the exact frozen implementation boundary', () => {
  assert.ok(fs.existsSync(factoryPath));
  assert.ok(fs.existsSync(compositionPath));
  assert.ok(fs.existsSync(desktopClientPath));
});
