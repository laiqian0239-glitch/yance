'use strict';

const { AppRuntime } = require('./AppRuntime');
const { AppRuntimeError } = require('./errors');
const {
  isAuthorityWriteHostCapability,
  assertCurrentAuthorityWriteHostToken
} = require('../services/authorityWriteHost');
const canonicalEventLedgerModule = require('../services/canonicalEventLedgerAuthority');
const domainEventLog = require('../services/domainEventLogService').singleton;
const { getSqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');

let processRuntime = null;
let processOwnership = null;
let processRuntimeStateStore = null;
let processLifecycle = null;
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
  const broker = options.sqliteBroker
    || options.ownership?._ownedSqliteBroker
    || optionalProcessBroker();
  const capability = options.authorityWriteHostCapability
    || options.authorityStore?.authorityWriteHostCapability
    || options.store?.authorityWriteHostCapability
    || broker?.authorityWriteHostCapability
    || null;
  if (!isAuthorityWriteHostCapability(capability)) {
    throw factoryError(
      'APP_RUNTIME_AUTHORITY_WRITE_HOST_REQUIRED',
      'Production AppRuntime requires a real AuthorityWriteHost capability before construction'
    );
  }
  const authorityStore = options.authorityStore
    || (broker && typeof broker.open === 'function' ? broker.open() : null)
    || (options.store?.authorityWriteHostCapability === capability ? options.store : null);
  if (!authorityStore?.db || typeof authorityStore.transaction !== 'function') {
    throw factoryError(
      'APP_RUNTIME_AUTHORITY_STORE_REQUIRED',
      'Production AppRuntime requires the broker-owned R32 authority store',
      409
    );
  }
  if (authorityStore.authorityWriteHostCapability !== capability) {
    throw factoryError(
      'APP_RUNTIME_AUTHORITY_STORE_CAPABILITY_MISMATCH',
      'Runtime authority store is not bound to the supplied AuthorityWriteHost capability',
      409
    );
  }
  if (!options.store?.db) {
    throw factoryError(
      'APP_RUNTIME_PRIMARY_DB_REQUIRED',
      'Runtime state store must expose the broker-owned primary SQLite database',
      409
    );
  }
  if (options.store.db !== authorityStore.db) {
    throw factoryError(
      'APP_RUNTIME_PRIMARY_DB_MISMATCH',
      'Runtime state and canonical authorities must use the same primary SQLite database',
      409
    );
  }
  try {
    assertCurrentAuthorityWriteHostToken(capability, authorityStore.db);
  } catch (cause) {
    throw factoryError(
      cause?.code || 'APP_RUNTIME_AUTHORITY_WRITE_HOST_NOT_CURRENT',
      'AppRuntime rejected a stale or non-current AuthorityWriteHost capability',
      409,
      { causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) }
    );
  }
  return Object.freeze({ capability, authorityStore, token: capability.tokenSnapshot() });
}

function defineImmutableAuthorityBindings(runtime, binding) {
  Object.defineProperties(runtime, {
    authorityWriteHostCapability: {
      value: binding.capability,
      enumerable: false,
      writable: false,
      configurable: false
    },
    authorityWriteHostToken: {
      value: binding.token,
      enumerable: false,
      writable: false,
      configurable: false
    },
    primaryAuthorityStore: {
      value: binding.authorityStore,
      enumerable: false,
      writable: false,
      configurable: false
    }
  });
  return runtime;
}

function lockGatewayEvidenceSurface(gateway) {
  if (!gateway || typeof gateway !== 'object') return false;
  let RuntimeAuthorityCommandGateway = null;
  try {
    ({ RuntimeAuthorityCommandGateway } = require('./AppRuntimeComposition'));
  } catch (_) {
    return false;
  }
  const expectedPrototype = RuntimeAuthorityCommandGateway?.prototype || null;
  if (!expectedPrototype || Object.getPrototypeOf(gateway) !== expectedPrototype) return false;

  const requiredMethods = [
    'assertAuthorityCurrent',
    'assertCanonicalBinding',
    'execute',
    'submit',
    'seal',
    'snapshot'
  ];
  const descriptors = Object.getOwnPropertyDescriptors(expectedPrototype);
  for (const method of requiredMethods) {
    const descriptor = descriptors[method];
    if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') return false;
    if (Object.prototype.hasOwnProperty.call(gateway, method)) return false;
  }

  try {
    Object.freeze(expectedPrototype);
    Object.freeze(gateway);
  } catch (_) {
    return false;
  }
  return Object.isFrozen(expectedPrototype) && Object.isFrozen(gateway);
}

function hasImmutableValue(target, key, expected) {
  const descriptor = target && Object.getOwnPropertyDescriptor(target, key);
  return Boolean(
    descriptor
    && !descriptor.get
    && !descriptor.set
    && descriptor.value === expected
    && descriptor.writable === false
    && descriptor.configurable === false
  );
}

function canonicalAuthorityGraph(runtime) {
  const composition = runtime?.composition || null;
  const authorities = composition?.authorities || null;
  const coordinator = authorities?.authorityTransactionCoordinator || null;
  const ledger = authorities?.canonicalEventLedgerAuthority || null;
  const identity = authorities?.identityAuthority || null;
  const platformCoreRepository = authorities?.platformCoreRepository || null;
  const gateway = composition?.authorityCommandGateway || null;
  const gatewayEvidenceSurfaceLocked = lockGatewayEvidenceSurface(gateway);
  let identityStore = null;
  let repositoryStore = null;
  try { identityStore = identity?.repository?.store?.() || null; } catch (_) { identityStore = null; }
  try { repositoryStore = platformCoreRepository?.store?.() || null; } catch (_) { repositoryStore = null; }
  let gatewayState = '';
  try {
    if (gatewayEvidenceSurfaceLocked) gatewayState = String(gateway.snapshot().state || '');
  } catch (_) { gatewayState = ''; }
  let gatewayBinding = null;
  try {
    if (gatewayEvidenceSurfaceLocked) {
      gatewayBinding = gateway.assertCanonicalBinding({
        runtime,
        authorityWriteHostCapability: processAuthorityWriteHostCapability,
        authorityStore: processAuthorityWriteHostStore,
        identityAuthority: identity
      }) || null;
    }
  } catch (_) {
    gatewayBinding = null;
  }

  const domainEventFacadeImmutable = hasImmutableValue(
    domainEventLog,
    'canonicalAuthority',
    canonicalEventLedgerModule.singleton
  ) && Object.isFrozen(domainEventLog);
  const checks = Object.freeze({
    runtimeOwnershipMatches: runtime?.ownership === processOwnership,
    runtimeStateStoreMatches: runtime?.store === processRuntimeStateStore,
    runtimeLifecycleMatches: runtime?.lifecycle === processLifecycle,
    runtimeCapabilityMatches: runtime?.authorityWriteHostCapability === processAuthorityWriteHostCapability,
    runtimeTokenMatches: runtime?.authorityWriteHostToken === processAuthorityWriteHostToken,
    runtimeAuthorityStoreMatches: runtime?.primaryAuthorityStore === processAuthorityWriteHostStore,
    compositionCapabilityMatches: authorities?.authorityWriteHostCapability === processAuthorityWriteHostCapability,
    coordinatorStoreMatches: coordinator?.store === processAuthorityWriteHostStore,
    coordinatorDatabaseMatches: coordinator?.db === processAuthorityWriteHostStore?.db,
    repositoryProviderImmutable: hasImmutableValue(platformCoreRepository, 'storeProvider', platformCoreRepository?.storeProvider),
    repositoryStoreMatches: repositoryStore === processAuthorityWriteHostStore,
    ledgerCoordinatorMatches: ledger?.coordinator === coordinator,
    ledgerStoreMatches: ledger?.store === processAuthorityWriteHostStore,
    ledgerDatabaseMatches: ledger?.db === processAuthorityWriteHostStore?.db,
    ledgerCompatibilityRepositoryMatches: ledger?.compatibilityRepository === platformCoreRepository,
    ledgerCompatibilityRepositoryImmutable: hasImmutableValue(ledger, 'compatibilityRepository', platformCoreRepository),
    canonicalLedgerSingletonMatches: canonicalEventLedgerModule.isConfiguredSingleton?.(ledger) === true,
    domainEventFacadeImmutable,
    identityRepositoryMatches: identity?.repository === platformCoreRepository,
    identityRepositoryImmutable: hasImmutableValue(identity, 'repository', platformCoreRepository),
    identityEventRecorderImmutable: hasImmutableValue(identity, 'eventRecorder', identity?.eventRecorder),
    identityLegacyCanonicalizerImmutable: hasImmutableValue(identity, 'legacyCanonicalIdentity', identity?.legacyCanonicalIdentity),
    identityStoreMatches: identityStore === processAuthorityWriteHostStore,
    gatewayEvidenceSurfaceLocked,
    gatewayPrivateBindingMatches: gatewayBinding?.bound === true
  });
  const canonicalGraphBound = Object.values(checks).every(Boolean);
  return Object.freeze({
    composition,
    authorities,
    coordinator,
    ledger,
    identity,
    gateway,
    checks,
    gatewayBindingChecks: gatewayBinding?.checks || null,
    canonicalGraphBound,
    startupGatewayState: gatewayState,
    startupGatewaySealed: gatewayState === 'sealed'
  });
}

function clearProcessBindings() {
  processRuntime = null;
  processOwnership = null;
  processRuntimeStateStore = null;
  processLifecycle = null;
  processAuthorityWriteHostCapability = null;
  processAuthorityWriteHostStore = null;
  processAuthorityWriteHostToken = null;
}

class AppRuntimeFactory {
  static create(options = {}) {
    if (processRuntime) {
      throw factoryError('APP_RUNTIME_ALREADY_EXISTS', 'A backend process may create only one AppRuntime');
    }
    const binding = resolveAuthorityBinding(options);
    let runtime = null;
    try {
      runtime = new AppRuntime({
        ...options,
        authorityWriteHostCapability: binding.capability,
        authorityWriteHostToken: binding.token,
        primaryAuthorityStore: binding.authorityStore
      });
      defineImmutableAuthorityBindings(runtime, binding);
      processOwnership = runtime.ownership;
      processRuntimeStateStore = runtime.store;
      processLifecycle = runtime.lifecycle;
      processAuthorityWriteHostCapability = binding.capability;
      processAuthorityWriteHostStore = binding.authorityStore;
      processAuthorityWriteHostToken = binding.token;
      processRuntime = runtime;
      factoryCreateCount += 1;
      return processRuntime;
    } catch (error) {
      clearProcessBindings();
      throw error;
    }
  }

  static current() { return processRuntime; }

  static assertAuthorityReady(options = {}) {
    const runtime = processRuntime;
    if (!runtime) {
      throw factoryError('APP_RUNTIME_AUTHORITY_NOT_READY', 'AppRuntime has not been created', 503);
    }
    if (!isAuthorityWriteHostCapability(processAuthorityWriteHostCapability) || !processAuthorityWriteHostStore?.db) {
      throw factoryError('APP_RUNTIME_AUTHORITY_NOT_READY', 'AppRuntime has no current write-host binding', 503);
    }
    try {
      assertCurrentAuthorityWriteHostToken(processAuthorityWriteHostCapability, processAuthorityWriteHostStore.db);
    } catch (cause) {
      throw factoryError(
        cause?.code || 'APP_RUNTIME_AUTHORITY_WRITE_HOST_FENCED',
        'AppRuntime write-host authority is no longer current',
        503,
        { causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) }
      );
    }

    const graph = canonicalAuthorityGraph(runtime);
    const coordinatorReady = Boolean(graph.coordinator);
    const canonicalLedgerReady = Boolean(graph.ledger);
    const identityAuthorityReady = Boolean(graph.identity);
    if (options.requireComposition !== false && (!coordinatorReady || !canonicalLedgerReady || !identityAuthorityReady)) {
      throw factoryError(
        'APP_RUNTIME_CANONICAL_AUTHORITIES_NOT_READY',
        'Canonical coordinator, ledger and identity authorities must be composed before readiness',
        503,
        { coordinatorReady, canonicalLedgerReady, identityAuthorityReady }
      );
    }
    if (coordinatorReady && canonicalLedgerReady && identityAuthorityReady && !graph.canonicalGraphBound) {
      throw factoryError(
        'APP_RUNTIME_CANONICAL_AUTHORITY_BINDING_MISMATCH',
        'Canonical runtime authorities no longer share the validated write-host capability and primary store',
        503,
        { checks: graph.checks, gatewayBindingChecks: graph.gatewayBindingChecks }
      );
    }
    if (options.requireStartupGatewaySealed === true && !graph.startupGatewaySealed) {
      throw factoryError(
        'APP_RUNTIME_STARTUP_GATEWAY_NOT_SEALED',
        'Startup command gateway must be sealed before backend readiness',
        503,
        { startupGatewayState: graph.startupGatewayState }
      );
    }
    return Object.freeze({
      authorityWriteHostBound: true,
      coordinatorReady,
      canonicalLedgerReady,
      identityAuthorityReady,
      canonicalGraphBound: graph.canonicalGraphBound,
      startupGatewayState: graph.startupGatewayState,
      startupGatewaySealed: graph.startupGatewaySealed
    });
  }

  static clear(runtime) {
    if (runtime == null || processRuntime !== runtime) return false;
    clearProcessBindings();
    return true;
  }

  static diagnostics() {
    const graph = processRuntime ? canonicalAuthorityGraph(processRuntime) : null;
    return Object.freeze({
      currentPresent: Boolean(processRuntime),
      createCount: factoryCreateCount,
      authorityWriteHostBound: Boolean(processAuthorityWriteHostToken),
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
    clearProcessBindings();
    factoryCreateCount = 0;
  }
}

module.exports = { AppRuntimeFactory };
