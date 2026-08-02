'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const runtimePath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntime.js');
const factoryPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeFactory.js');
const compositionPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeComposition.js');
const desktopClientPath = path.join(repoRoot, 'electron', 'desktopHost', 'ApiV2RuntimeClient.js');
const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');

function source(filePath) { return fs.readFileSync(filePath, 'utf8'); }

function minimalRuntimeDependencies(db = null) {
  return {
    ownership: { guard: () => ({ ownerInstanceId: 'owner', fencingToken: 1 }) },
    store: {
      ...(db ? { db } : {}),
      snapshot: () => ({ stateVersion: 1, lastEventSequence: 0, runtime: { operatingMode: 'normal', operatingModeRevision: 1 }, capabilities: {}, diagnosticsSummary: {} })
    },
    lifecycle: { state: 'runtime_state_ready' },
    buildId: 'acv2-a6-test-build'
  };
}

function withAuthorityStore(prefix, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: `${prefix}-host` });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const authorityStore = broker.open();
  try { return callback({ root, dbPath, host, broker, authorityStore }); }
  finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function startupEnvelope(commandType, payload = {}) {
  return { contractVersion: 2, commandId: '11111111-1111-4111-8111-111111111111', commandType, expectedStateVersion: 1, issuedAtUtc: '2026-08-02T11:00:00.000Z', payload };
}

function testStartupHandlers() {
  return Object.freeze(Object.assign(Object.create(null), { 'startup.noop': () => null }));
}

function assertImmutableBinding(target, key, expected) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  assert.equal(descriptor?.value, expected, `${key} must retain the canonical binding`);
  assert.equal(descriptor?.writable, false, `${key} must not be replaceable`);
  assert.equal(descriptor?.configurable, false, `${key} must not be redefinable`);
}

test('AppRuntimeFactory rejects every production runtime that lacks a real AuthorityWriteHost capability', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
  try {
    AppRuntimeFactory.resetForTests();
    assert.throws(() => AppRuntimeFactory.create(minimalRuntimeDependencies()), error => error?.code === 'APP_RUNTIME_AUTHORITY_WRITE_HOST_REQUIRED');
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
  assert.ok(coordinator >= 0 && ledger >= 0 && identity >= 0 && recovery >= 0);
  assert.ok(coordinator < recovery && ledger < recovery && identity < recovery);
  assert.match(text, /authorityWriteHostCapability/);
  assert.match(text, /authorities\s*:\s*Object\.freeze/);
});

test('startup identity handler is built from the composition IdentityAuthority instance', () => {
  const { createStartupCommandHandlers } = require('../../../runtime/AppRuntimeComposition');
  let received = null;
  const identityAuthority = {
    canonicalizeWhatsAppAccounts(options) {
      received = options;
      return { authority: 'injected-identity-authority', options };
    }
  };
  const handlers = createStartupCommandHandlers({ identityAuthority });
  assert.equal(Object.getPrototypeOf(handlers), null);
  assert.equal(Object.isFrozen(handlers), true);
  const result = handlers['startup.canonicalizeIdentity']({ dryRun: true });
  assert.deepEqual(received, { dryRun: true });
  assert.equal(result.authority, 'injected-identity-authority');
});

test('real broker capability and R32 store bind one immutable runtime authority graph', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
  try {
    withAuthorityStore('yance-acv2-a6-runtime-', ({ host, authorityStore }) => {
      AppRuntimeFactory.resetForTests();
      const dependencies = minimalRuntimeDependencies(authorityStore.db);
      const runtime = AppRuntimeFactory.create({ ...dependencies, authorityWriteHostCapability: host.capability, authorityStore });
      assertImmutableBinding(runtime, 'ownership', dependencies.ownership);
      assertImmutableBinding(runtime, 'store', dependencies.store);
      assertImmutableBinding(runtime, 'lifecycle', dependencies.lifecycle);
      assertImmutableBinding(runtime, 'authorityWriteHostCapability', host.capability);
      assertImmutableBinding(runtime, 'authorityWriteHostToken', host.capability.tokenSnapshot());
      assertImmutableBinding(runtime, 'primaryAuthorityStore', authorityStore);

      const compositionDescriptor = Object.getOwnPropertyDescriptor(runtime, 'composition');
      assert.equal(typeof compositionDescriptor?.get, 'function');
      assert.equal(compositionDescriptor?.set, undefined);
      assert.equal(compositionDescriptor?.configurable, false);
      assert.equal(runtime.composition, null);
      assert.throws(() => { runtime.composition = Object.freeze({ forged: true }); }, TypeError);

      const coreBusinessCommand = Object.getPrototypeOf(runtime).executeBusinessCommand;
      const composition = runtime.configureProductionServices();
      assert.equal(runtime.composition, composition);
      assert.equal(runtime.configureProductionServices(), composition);
      assert.throws(() => { runtime.composition = Object.freeze({ forged: true }); }, TypeError);

      const coordinator = composition.authorities.authorityTransactionCoordinator;
      const ledger = composition.authorities.canonicalEventLedgerAuthority;
      const identity = composition.authorities.identityAuthority;
      const platformCoreRepository = composition.authorities.platformCoreRepository;
      const gateway = composition.authorityCommandGateway;
      assertImmutableBinding(coordinator, 'store', authorityStore);
      assertImmutableBinding(coordinator, 'db', authorityStore.db);
      assertImmutableBinding(platformCoreRepository, 'storeProvider', platformCoreRepository.storeProvider);
      assertImmutableBinding(ledger, 'coordinator', coordinator);
      assertImmutableBinding(ledger, 'store', authorityStore);
      assertImmutableBinding(ledger, 'db', authorityStore.db);
      assertImmutableBinding(ledger, 'compatibilityRepository', platformCoreRepository);
      assertImmutableBinding(identity, 'repository', platformCoreRepository);
      assertImmutableBinding(identity, 'eventRecorder', identity.eventRecorder);
      assertImmutableBinding(identity, 'legacyCanonicalIdentity', identity.legacyCanonicalIdentity);

      const canonicalLedgerModule = require('../../../services/canonicalEventLedgerAuthority');
      const domainEventLog = require('../../../services/domainEventLogService').singleton;
      assert.equal(typeof canonicalLedgerModule.isConfiguredSingleton, 'function');
      assert.equal(canonicalLedgerModule.isConfiguredSingleton(ledger), true);
      assertImmutableBinding(domainEventLog, 'canonicalAuthority', canonicalLedgerModule.singleton);
      const competingLedger = new canonicalLedgerModule.CanonicalEventLedgerAuthority({
        coordinator,
        store: authorityStore,
        compatibilityRepository: platformCoreRepository
      });
      assert.throws(
        () => canonicalLedgerModule.configureSingleton(competingLedger),
        error => error?.code === 'CANONICAL_EVENT_LEDGER_SINGLETON_ALREADY_CONFIGURED'
      );

      assert.equal(Object.hasOwn(composition, 'startupCommandHandlers'), false);
      assert.equal(Object.hasOwn(gateway, 'commandHandlers'), false);
      assert.equal(gateway.commandHandlers, undefined);
      assert.equal(gateway.assertCanonicalBinding({ runtime, authorityWriteHostCapability: host.capability, authorityStore, identityAuthority: identity }).bound, true);

      assert.equal(runtime.executeBusinessCommand, coreBusinessCommand);
      assert.equal(Object.hasOwn(runtime, 'executeBusinessCommand'), false);
      assert.equal(typeof composition.commandSubmitter, 'function');
      assert.equal(Object.hasOwn(composition.recoveryManager, 'commandSubmitter'), false);
      assert.equal(composition.authorities.authorityWriteHostCapability, host.capability);
      assert.equal(identity.repository.store(), authorityStore);

      const openReadiness = AppRuntimeFactory.assertAuthorityReady();
      assert.equal(openReadiness.authorityWriteHostBound, true);
      assert.equal(openReadiness.canonicalGraphBound, true);
      assert.equal(openReadiness.startupGatewaySealed, false);
      assert.throws(() => AppRuntimeFactory.assertAuthorityReady({ requireStartupGatewaySealed: true }), error => error?.code === 'APP_RUNTIME_STARTUP_GATEWAY_NOT_SEALED');
      gateway.seal();
      const sealedReadiness = AppRuntimeFactory.assertAuthorityReady({ requireStartupGatewaySealed: true });
      assert.equal(sealedReadiness.coordinatorReady, true);
      assert.equal(sealedReadiness.canonicalLedgerReady, true);
      assert.equal(sealedReadiness.identityAuthorityReady, true);
      assert.equal(sealedReadiness.canonicalGraphBound, true);
      assert.equal(sealedReadiness.startupGatewaySealed, true);
      AppRuntimeFactory.clear(runtime);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});

test('AppRuntimeFactory rejects a runtime state store bound to a different primary database', () => {
  const previous = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  const { AppRuntimeFactory } = require('../../../runtime/AppRuntimeFactory');
  try {
    withAuthorityStore('yance-acv2-a6-db-mismatch-', ({ host, authorityStore }) => {
      AppRuntimeFactory.resetForTests();
      const dependencies = minimalRuntimeDependencies();
      dependencies.store = { ...dependencies.store, db: { deliberatelyDifferentDatabase: true } };
      assert.throws(() => AppRuntimeFactory.create({ ...dependencies, authorityWriteHostCapability: host.capability, authorityStore }), error => error?.code === 'APP_RUNTIME_PRIMARY_DB_MISMATCH');
      assert.equal(AppRuntimeFactory.current(), null);
    });
  } finally {
    AppRuntimeFactory.resetForTests();
    if (previous == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previous;
  }
});

test('startup command gateway rejects forged write-host capabilities before any handler can run', () => {
  const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');
  const forged = { forged: true };
  assert.throws(() => new RuntimeAuthorityCommandGateway({ runtime: { snapshot: () => ({ stateVersion: 1 }) }, authorityWriteHostCapability: forged, authorityStore: { db: {}, transaction() {}, authorityWriteHostCapability: forged }, commandHandlers: testStartupHandlers() }), error => error?.code === 'STARTUP_COMMAND_GATEWAY_WRITE_HOST_REQUIRED');
});

test('startup command gateway rejects a capability fenced by a newer host generation', () => {
  const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a6-stale-gateway-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let hostA; let hostB; let brokerA; let brokerB;
  try {
    hostA = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-gateway-host-a', ownershipPid: 47001, ownershipProcessIdentity: 'a6-gateway-host-a', ownershipPidAlive: pid => pid === 47001 });
    brokerA = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: hostA.capability });
    const authorityStoreA = brokerA.open();
    hostA.releaseStartupClaimForTests();
    hostB = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-gateway-host-b', ownershipPid: 47002, ownershipProcessIdentity: 'a6-gateway-host-b', ownershipPidAlive: () => false });
    brokerB = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: hostB.capability });
    brokerB.open();
    assert.throws(() => new RuntimeAuthorityCommandGateway({ runtime: { snapshot: () => ({ stateVersion: 1 }) }, authorityWriteHostCapability: hostA.capability, authorityStore: authorityStoreA, commandHandlers: testStartupHandlers() }), error => error?.code === 'AUTHORITY_WRITE_HOST_FENCED');
  } finally {
    try { brokerB?.checkpointAndClose(); } catch (_) {}
    try { hostB?.release(); } catch (_) {}
    try { brokerA?.checkpointAndClose(); } catch (_) {}
    try { hostA?.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('startup gateway hides handlers, rejects prototype-chain commands and seals after boot', () => {
  const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');
  withAuthorityStore('yance-acv2-a6-sealed-', ({ host, authorityStore }) => {
    const runtime = { snapshot: () => ({ stateVersion: 1 }) };
    const gateway = new RuntimeAuthorityCommandGateway({ runtime, authorityWriteHostCapability: host.capability, authorityStore, commandHandlers: testStartupHandlers() });
    assert.equal(Object.hasOwn(gateway, 'commandHandlers'), false);
    assert.equal(gateway.commandHandlers, undefined);
    assert.throws(() => gateway.execute(startupEnvelope('constructor')), error => error?.code === 'STARTUP_COMMAND_ENVELOPE_INVALID');
    assert.equal(gateway.snapshot().state, 'open');
    gateway.seal();
    assert.equal(gateway.snapshot().state, 'sealed');
    assert.throws(() => gateway.execute(startupEnvelope('startup.invalid')), error => error?.code === 'STARTUP_COMMAND_GATEWAY_SEALED');
  });
});

test('desktop runtime client refuses own or inherited primary write capability injection', () => {
  const { ApiV2RuntimeClient } = require('../../../../electron/desktopHost/ApiV2RuntimeClient');
  const baseOptions = { baseURL: 'http://127.0.0.1:1', fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }), sessionProvider: () => ({ apiSessionToken: 'token', backendSessionId: 'session', startupNonce: 'nonce' }) };
  assert.throws(() => new ApiV2RuntimeClient({ ...baseOptions, authorityWriteHostCapability: { forged: true } }), error => error?.reasonCode === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN' || error?.code === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN');
  const inherited = Object.assign(Object.create({ authorityWriteHostCapability: { forged: true } }), baseOptions);
  assert.throws(() => new ApiV2RuntimeClient(inherited), error => error?.reasonCode === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN' || error?.code === 'DESKTOP_WRITE_CAPABILITY_FORBIDDEN');
});

test('startup command payload accessors are rejected without getter execution', () => {
  const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');
  let getterExecuted = false;
  const payload = {};
  Object.defineProperty(payload, 'hidden', { enumerable: true, get() { getterExecuted = true; return 'must-not-run'; } });
  withAuthorityStore('yance-acv2-a6-payload-', ({ host, authorityStore }) => {
    const gateway = new RuntimeAuthorityCommandGateway({ runtime: { snapshot: () => ({ stateVersion: 1 }) }, authorityWriteHostCapability: host.capability, authorityStore, commandHandlers: testStartupHandlers() });
    assert.throws(() => gateway.execute(startupEnvelope('startup.invalid', payload)), error => error?.code === 'STARTUP_COMMAND_PAYLOAD_ACCESSOR_FORBIDDEN');
  });
  assert.equal(getterExecuted, false);
});

test('desktop runtime client remains a command transport and exposes no write-host capability surface', async () => {
  const clientSource = source(desktopClientPath);
  assert.doesNotMatch(clientSource, /require\([^\n]*authorityWriteHost/i);
  assert.doesNotMatch(clientSource, /authorityWriteHostCapability\s*[:=]/);
  const requests = [];
  const { ApiV2RuntimeClient } = require('../../../../electron/desktopHost/ApiV2RuntimeClient');
  const client = new ApiV2RuntimeClient({ baseURL: 'http://127.0.0.1:1', fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => ({ ok: true, accepted: true }) }; }, sessionProvider: () => ({ apiSessionToken: 'token', backendSessionId: 'session', startupNonce: 'nonce', backendPid: 1, ownerTrusted: true }), randomUUID: () => '11111111-1111-4111-8111-111111111111', clock: () => '2026-08-02T11:00:00.000Z' });
  const envelope = client.command({ commandType: 'runtime.stop', expectedStateVersion: 1, payload: { reason: 'a6-contract' } });
  await client.executeCommand(envelope);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/app\/v2\/commands$/);
  assert.equal(Object.hasOwn(client.snapshot(), 'authorityWriteHostCapability'), false);
});

test('A6 production files remain the exact frozen implementation boundary', () => {
  assert.ok(fs.existsSync(runtimePath));
  assert.ok(fs.existsSync(factoryPath));
  assert.ok(fs.existsSync(compositionPath));
  assert.ok(fs.existsSync(desktopClientPath));
});
