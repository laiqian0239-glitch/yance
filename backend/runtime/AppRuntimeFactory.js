'use strict';

const { AppRuntime } = require('./AppRuntime');
const { AppRuntimeError } = require('./errors');
const {
  isAuthorityWriteHostCapability,
  assertCurrentAuthorityWriteHostToken
} = require('../services/authorityWriteHost');
const { getSqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');

let processRuntime = null;
let processAuthorityWriteHostCapability = null;
let processAuthorityWriteHostStore = null;
let processAuthorityWriteHostToken = null;
let factoryCreateCount = 0;

function factoryError(code, message, status = 409, details = {}) {
  return new AppRuntimeError(code, message, { status, details });
}

function optionalProcessBroker() {
  try { return getSqliteConnectionBroker({ optional: true }); }
  catch (_) { return null; }
}

function resolveAuthorityBinding(options = {}) {
  const broker = options.sqliteBroker || options.ownership?._ownedSqliteBroker || optionalProcessBroker();
  const capability = options.authorityWriteHostCapability || options.authorityStore?.authorityWriteHostCapability || options.store?.authorityWriteHostCapability || broker?.authorityWriteHostCapability || null;
  if (!isAuthorityWriteHostCapability(capability)) {
    throw factoryError('APP_RUNTIME_AUTHORITY_WRITE_HOST_REQUIRED', 'Production AppRuntime requires a real AuthorityWriteHost capability before construction');
  }
  const authorityStore = options.authorityStore || (broker && typeof broker.open === 'function' ? broker.open() : null) || (options.store?.authorityWriteHostCapability === capability ? options.store : null);
  if (!authorityStore?.db || typeof authorityStore.transaction !== 'function') {
    throw factoryError('APP_RUNTIME_AUTHORITY_STORE_REQUIRED', 'Production AppRuntime requires the broker-owned R32 authority store', 409);
  }
  if (authorityStore.authorityWriteHostCapability !== capability) {
    throw factoryError('APP_RUNTIME_AUTHORITY_STORE_CAPABILITY_MISMATCH', 'Runtime authority store is not bound to the supplied AuthorityWriteHost capability', 409);
  }
  if (options.store?.db && options.store.db !== authorityStore.db) {
    throw factoryError('APP_RUNTIME_PRIMARY_DB_MISMATCH', 'Runtime state and canonical authorities must use the same primary SQLite database', 409);
  }
  try {
    assertCurrentAuthorityWriteHostToken(capability, authorityStore.db);
  } catch (cause) {
    throw factoryError(cause?.code || 'APP_RUNTIME_AUTHORITY_WRITE_HOST_NOT_CURRENT', 'AppRuntime rejected a stale or non-current AuthorityWriteHost capability', 409, { causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) });
  }
  return Object.freeze({ capability, authorityStore, token: capability.tokenSnapshot() });
}

function defineImmutableAuthorityBindings(runtime, binding) {
  Object.defineProperties(runtime, {
    authorityWriteHostCapability: Object.freeze({ value: binding.capability, enumerable: false, writable: false, configurable: false }),
    authorityWriteHostToken: Object.freeze({ value: binding.token, enumerable: false, writable: false, configurable: false }),
    primaryAuthorityStore: Object.freeze({ value: binding.authorityStore, enumerable: false, writable: false, configurable: false })
  });
  return runtime;
}

function canonicalAuthorityGraph(runtime) {
  const composition = runtime?.composition || null;
  const authorities = composition?.authorities || null;
  const coordinator = authorities?.authorityTransactionCoordinator || null;
  const ledger = authorities?.canonicalEventLedgerAuthority || null;
  const identity = authorities?.identityAuthority || null;
  const platformCoreRepository = authorities?.platformCoreRepository || null;
  const gateway = composition?.authorityCommandGateway || null;
  let identityStore = null;
  try { identityStore = identity?.repository?.store?.() || null; } catch (_) { identityStore = null; }
  let gatewayState = '';
  try { gatewayState = String(gateway?.snapshot?.().state || ''); } catch (_) { gatewayState = ''; }

  const checks = Object.freeze({
    runtimeCapabilityMatches: runtime?.authorityWriteHostCapability === processAuthorityWriteHostCapability,
    runtimeTokenMatches: runtime?.authorityWriteHostToken === processAuthorityWriteHostToken,
    runtimeStoreMatches: runtime?.primaryAuthorityStore === processAuthorityWriteHostStore,
    compositionCapabilityMatches: authorities?.authorityWriteHostCapability === processAuthorityWriteHostCapability,
    coordinatorStoreMatches: coordinator?.store === processAuthorityWriteHostStore,
    coordinatorDatabaseMatches: coordinator?.db === processAuthorityWriteHostStore?.db,
    ledgerCoordinatorMatches: ledger?.coordinator === coordinator,
    ledgerStoreMatches: ledger?.store === processAuthorityWriteHostStore,
    ledgerDatabaseMatches: ledger?.db === processAuthorityWriteHostStore?.db,
    identityRepositoryMatches: identity?.repository === platformCoreRepository,
    identityStoreMatches: identityStore === processAuthorityWriteHostStore,
    gatewayRuntimeMatches: gateway?.runtime === runtime,
    gatewayCapabilityMatches: gateway?.authorityWriteHostCapability === processAuthorityWriteHostCapability,
    gatewayStoreMatches: gateway?.authorityStore === processAuthorityWriteHostStore,
    gatewayHandlersMatch: gateway?.commandHandlers === composition?.startupCommandHandlers
  });
  const canonicalGraphBound = Object.values(checks).every(Boolean);
  return Object.freeze({ composition, authorities, coordinator, ledger, identity, gateway, checks, canonicalGraphBound, startupGatewayState: gatewayState, startupGatewaySealed: gatewayState === 'sealed' });
}

class AppRuntimeFactory {
  static create(options = {}) {
    if (processRuntime) throw factoryError('APP_RUNTIME_ALREADY_EXISTS', 'A backend process may create only one AppRuntime');
    const binding = resolveAuthorityBinding(options);
    let runtime = null;
    try {
      runtime = new AppRuntime({ ...options, authorityWriteHostCapability: binding.capability, authorityWriteHostToken: binding.token, primaryAuthorityStore: binding.authorityStore });
      defineImmutableAuthorityBindings(runtime, binding);
      processAuthorityWriteHostCapability = binding.capability;
      processAuthorityWriteHostStore = binding.authorityStore;
      processAuthorityWriteHostToken = binding.token;
      processRuntime = runtime;
      factoryCreateCount += 1;
      return processRuntime;
    } catch (error) {
      processRuntime = null;
      processAuthorityWriteHostCapability = null;
      processAuthorityWriteHostStore = null;
      processAuthorityWriteHostToken = null;
      throw error;
    }
  }

  static current() { return processRuntime; }

  static assertAuthorityReady(options = {}) {
    const runtime = processRuntime;
    if (!runtime) throw factoryError('APP_RUNTIME_AUTHORITY_NOT_READY', 'AppRuntime has not been created', 503);
    if (!isAuthorityWriteHostCapability(processAuthorityWriteHostCapability) || !processAuthorityWriteHostStore?.db) {
      throw factoryError('APP_RUNTIME_AUTHORITY_NOT_READY', 'AppRuntime has no current write-host binding', 503);
    }
    try {
      assertCurrentAuthorityWriteHostToken(processAuthorityWriteHostCapability, processAuthorityWriteHostStore.db);
    } catch (cause) {
      throw factoryError(cause?.code || 'APP_RUNTIME_AUTHORITY_WRITE_HOST_FENCED', 'AppRuntime write-host authority is no longer current', 503, { causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) });
    }

    const graph = canonicalAuthorityGraph(runtime);
    const coordinatorReady = Boolean(graph.coordinator);
    const canonicalLedgerReady = Boolean(graph.ledger);
    const identityAuthorityReady = Boolean(graph.identity);
    if (options.requireComposition !== false && (!coordinatorReady || !canonicalLedgerReady || !identityAuthorityReady)) {
      throw factoryError('APP_RUNTIME_CANONICAL_AUTHORITIES_NOT_READY', 'Canonical coordinator, ledger and identity authorities must be composed before readiness', 503, { coordinatorReady, canonicalLedgerReady, identityAuthorityReady });
    }
    if (coordinatorReady && canonicalLedgerReady && identityAuthorityReady && !graph.canonicalGraphBound) {
      throw factoryError('APP_RUNTIME_CANONICAL_AUTHORITY_BINDING_MISMATCH', 'Canonical runtime authorities no longer share the validated write-host capability and primary store', 503, { checks: graph.checks });
    }
    if (options.requireStartupGatewaySealed === true && !graph.startupGatewaySealed) {
      throw factoryError('APP_RUNTIME_STARTUP_GATEWAY_NOT_SEALED', 'Startup command gateway must be sealed before backend readiness', 503, { startupGatewayState: graph.startupGatewayState });
    }
    return Object.freeze({
      authorityWriteHostBound: true,
      coordinatorReady,
      canonicalLedgerReady,
      identityAuthorityReady,
      canonicalGraphBound: graph.canonicalGraphBound,
      startupGatewayState: graph.startupGatewayState,
      startupGatewaySealed: graph.startupGatewaySealed,
      token: processAuthorityWriteHostToken
    });
  }

  static clear(runtime) {
    if (runtime == null || processRuntime !== runtime) return false;
    processRuntime = null;
    processAuthorityWriteHostCapability = null;
    processAuthorityWriteHostStore = null;
    processAuthorityWriteHostToken = null;
    return true;
  }

  static diagnostics() {
    const graph = processRuntime ? canonicalAuthorityGraph(processRuntime) : null;
    return Object.freeze({
      currentPresent: Boolean(processRuntime),
      createCount: factoryCreateCount,
      authorityWriteHostBound: Boolean(processAuthorityWriteHostToken),
      authorityWriteHostToken: processAuthorityWriteHostToken,
      coordinatorReady: Boolean(graph?.coordinator),
      canonicalLedgerReady: Boolean(graph?.ledger),
      identityAuthorityReady: Boolean(graph?.identity),
      canonicalGraphBound: graph?.canonicalGraphBound === true,
      startupGatewayState: graph?.startupGatewayState || '',
      startupGatewaySealed: graph?.startupGatewaySealed === true
    });
  }

  static resetForTests() {
    if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_RUNTIME_RESET !== '1') {
      throw factoryError('APP_RUNTIME_TEST_RESET_FORBIDDEN', 'AppRuntime test reset is unavailable in production', 403);
    }
    processRuntime = null;
    processAuthorityWriteHostCapability = null;
    processAuthorityWriteHostStore = null;
    processAuthorityWriteHostToken = null;
    factoryCreateCount = 0;
  }
}

module.exports = { AppRuntimeFactory };
