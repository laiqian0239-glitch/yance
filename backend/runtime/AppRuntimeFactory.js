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
      runtime.authorityWriteHostCapability = binding.capability;
      runtime.authorityWriteHostToken = binding.token;
      runtime.primaryAuthorityStore = binding.authorityStore;
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

    const authorities = runtime.composition?.authorities || null;
    const canonicalLedgerReady = Boolean(authorities?.canonicalEventLedgerAuthority);
    const identityAuthorityReady = Boolean(authorities?.identityAuthority);
    const coordinatorReady = Boolean(authorities?.authorityTransactionCoordinator);
    if (options.requireComposition !== false && (!canonicalLedgerReady || !identityAuthorityReady || !coordinatorReady)) {
      throw factoryError(
        'APP_RUNTIME_CANONICAL_AUTHORITIES_NOT_READY',
        'Canonical coordinator, ledger and identity authorities must be composed before readiness',
        503,
        { coordinatorReady, canonicalLedgerReady, identityAuthorityReady }
      );
    }
    return Object.freeze({
      authorityWriteHostBound: true,
      coordinatorReady,
      canonicalLedgerReady,
      identityAuthorityReady,
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
    const authorities = processRuntime?.composition?.authorities || null;
    return Object.freeze({
      currentPresent: Boolean(processRuntime),
      createCount: factoryCreateCount,
      authorityWriteHostBound: Boolean(processAuthorityWriteHostToken),
      authorityWriteHostToken: processAuthorityWriteHostToken,
      coordinatorReady: Boolean(authorities?.authorityTransactionCoordinator),
      canonicalLedgerReady: Boolean(authorities?.canonicalEventLedgerAuthority),
      identityAuthorityReady: Boolean(authorities?.identityAuthority)
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
