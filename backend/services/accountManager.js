'use strict';

const core = require('./accountManagerCore');
const accountLifecycle = require('./accountLifecycle');
const { DurableExecutionAuthority } = require('./durableExecutionAuthority');
const { ExternalActionOutboxAuthority } = require('./externalActionOutboxAuthorityCore');
const { canonicalHash } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');
const {
  OPERATION_KIND: SESSION_RESTORE,
  prepareSessionRestore
} = require('./durableOperations/sessionRestoreOperation');

const SESSION_STATES = new WeakMap();
const RUNTIME_SESSION_AUTHORITIES = new WeakMap();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sessionManagerError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), { code, status, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result) {
    throw sessionManagerError('WP_B_SESSION_RESTORE_FIELD_REQUIRED', `${field} is required`, 400, { field });
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw sessionManagerError('WP_B_SESSION_RESTORE_FIELD_INVALID', `${field} is invalid`, 400, { field });
  }
  return result;
}

function positiveGeneration(value, field = 'requestedSessionGeneration') {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw sessionManagerError(
      'WP_B_SESSION_RESTORE_GENERATION_INVALID',
      `${field} must be one positive safe integer`,
      400,
      { field }
    );
  }
  return result;
}

function defaultAuthorityTimestamp() {
  return new Date().toISOString();
}

function parseCanonicalAccountPayload(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function currentRuntimeAuthorityStore() {
  const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
  const store = AppRuntimeFactory.current()?.primaryAuthorityStore;
  if (!store?.db || typeof store.transaction !== 'function') {
    throw sessionManagerError(
      'APP_RUNTIME_CANONICAL_AUTHORITY_STORE_REQUIRED',
      'Session restore requires the current AppRuntime broker-owned authority store',
      503
    );
  }
  return store;
}

function runtimeAccountList() {
  const store = currentRuntimeAuthorityStore();
  let rows;
  try {
    rows = store.db.prepare(`SELECT
      id, platform, state, lifecycle_state, payload_json
      FROM r32_accounts
      WHERE COALESCE(lifecycle_state, 'active') NOT IN ('merged','tombstoned','deleted')
        AND COALESCE(merged_into_id, '') = ''
      ORDER BY created_at ASC, id ASC`).all();
  } catch (error) {
    throw sessionManagerError(
      'APP_RUNTIME_ACCOUNT_PROJECTION_REQUIRED',
      'Session restore requires the canonical persisted account projection',
      503,
      { causeCode: clean(error?.code), causeMessage: clean(error?.message) }
    );
  }
  return Object.freeze(rows.map(row => {
    const payload = Object.freeze(parseCanonicalAccountPayload(row.payload_json));
    const metadata = Object.freeze(
      payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? { ...payload.metadata }
        : {}
    );
    return Object.freeze({
      ...payload,
      id: clean(row.id),
      platform: clean(row.platform || payload.platform).toLowerCase(),
      credentialRef: clean(payload.credentialRef || payload.credential_ref),
      paused: payload.paused === true || clean(row.state).toLowerCase() === 'paused',
      lifecycleState: clean(row.lifecycle_state || payload.lifecycleState || 'active'),
      sessionGeneration: Number(
        payload.sessionGeneration
        || payload.session_generation
        || metadata.sessionGeneration
        || 0
      ),
      sessionReference: clean(payload.sessionReference || metadata.sessionReference),
      metadata
    });
  }));
}

function runtimeAccountReader(accountId) {
  const normalized = clean(accountId);
  return runtimeAccountList().find(account => account.id === normalized) || null;
}

function runtimeSessionAuthorities() {
  const store = currentRuntimeAuthorityStore();
  let authorities = RUNTIME_SESSION_AUTHORITIES.get(store);
  if (!authorities) {
    const storeProvider = () => store;
    authorities = Object.freeze({
      durableExecutionAuthority: new DurableExecutionAuthority({ storeProvider }),
      outboxAuthority: new ExternalActionOutboxAuthority({ storeProvider })
    });
    RUNTIME_SESSION_AUTHORITIES.set(store, authorities);
  }
  return authorities;
}

function constantProvider(value) {
  return () => value;
}

function configureSessionState(target, options = {}) {
  const injectedExecutionAuthority = options.durableExecutionAuthority || null;
  const injectedOutboxAuthority = options.outboxAuthority || null;
  const state = Object.freeze({
    accountReader: options.accountReader || runtimeAccountReader,
    accountList: options.accountList || runtimeAccountList,
    durableExecutionAuthorityProvider: injectedExecutionAuthority
      ? constantProvider(injectedExecutionAuthority)
      : () => runtimeSessionAuthorities().durableExecutionAuthority,
    outboxAuthorityProvider: injectedOutboxAuthority
      ? constantProvider(injectedOutboxAuthority)
      : () => runtimeSessionAuthorities().outboxAuthority,
    issueTimestamp: options.issueTimestamp || defaultAuthorityTimestamp
  });
  if (typeof state.accountReader !== 'function' || typeof state.accountList !== 'function') {
    throw new TypeError('AccountManager session restoration requires persisted account readers');
  }
  if (typeof state.durableExecutionAuthorityProvider !== 'function'
      || typeof state.outboxAuthorityProvider !== 'function') {
    throw new TypeError('AccountManager session restoration requires authority providers');
  }
  SESSION_STATES.set(target, state);
  return target;
}

function sessionState(target) {
  const state = SESSION_STATES.get(target);
  if (!state) throw new TypeError('AccountManager session restoration state is unavailable');
  return state;
}

function resolveSessionAuthorities(state) {
  const durableExecutionAuthority = state.durableExecutionAuthorityProvider();
  const outboxAuthority = state.outboxAuthorityProvider();
  if (typeof durableExecutionAuthority?.createExecution !== 'function') {
    throw new TypeError('AccountManager SESSION_RESTORE requires DurableExecutionAuthority.createExecution');
  }
  if (typeof outboxAuthority?.createIntent !== 'function') {
    throw new TypeError('AccountManager SESSION_RESTORE requires ExternalActionOutboxAuthority.createIntent');
  }
  return Object.freeze({ durableExecutionAuthority, outboxAuthority });
}

function requestSessionRestore(input = {}) {
  const state = sessionState(this);
  const accountId = requiredString(input.accountId || input.accountReference, 'accountId');
  const account = state.accountReader(accountId);
  if (!account) {
    throw sessionManagerError('ACCOUNT_NOT_FOUND', 'Session restore account is not persisted', 404, { accountId });
  }
  const platform = requiredString(account.platform || input.platform, 'platform', 64).toLowerCase();
  const requestedSessionGeneration = positiveGeneration(input.requestedSessionGeneration);
  const credentialReference = requiredString(
    input.credentialReference || account.credentialRef || account.credential_ref,
    'credentialReference'
  );
  const sessionReference = requiredString(
    input.sessionReference || account.sessionReference || account.metadata?.sessionReference
      || `session:${platform}:${accountId}:${requestedSessionGeneration}`,
    'sessionReference'
  );
  const hashBase = Object.freeze({
    schemaVersion: 1,
    platform,
    accountReference: accountId,
    requestedSessionGeneration,
    sessionReference,
    credentialReference
  });
  const commandContentSha256 = clean(input.commandContentSha256) || canonicalHash(hashBase);
  if (!/^[a-f0-9]{64}$/u.test(commandContentSha256)) {
    throw sessionManagerError(
      'WP_B_SESSION_RESTORE_HASH_INVALID',
      'commandContentSha256 must be one lowercase SHA-256 digest'
    );
  }
  const command = deepFreeze({ ...hashBase, commandContentSha256 });
  const authorities = resolveSessionAuthorities(state);
  return prepareSessionRestore({
    durableExecutionAuthority: authorities.durableExecutionAuthority,
    outboxAuthority: authorities.outboxAuthority,
    issueTimestamp: state.issueTimestamp,
    traceId: clean(input.traceId),
    idempotencyKey: clean(input.idempotencyKey),
    deadlineAt: clean(input.deadlineAt),
    maxAttempts: Number(input.maxAttempts || 3),
    command
  });
}

function requestPersistedSessionRestores(input = {}) {
  const state = sessionState(this);
  const results = [];
  for (const account of state.accountList()) {
    if (!account || account.metadata?.loggedOut === true) continue;
    if (!accountLifecycle.eligibility(account).eligible) continue;
    const credentialReference = clean(account.credentialRef || account.credential_ref);
    if (!credentialReference) continue;
    const requestedSessionGeneration = positiveGeneration(
      account.sessionGeneration
      || account.session_generation
      || account.metadata?.sessionGeneration
      || 1
    );
    results.push(requestSessionRestore.call(this, {
      accountId: account.id,
      requestedSessionGeneration,
      sessionReference: account.sessionReference || account.metadata?.sessionReference || '',
      credentialReference,
      traceId: clean(input.traceId),
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: Number(input.maxAttempts || 3)
    }));
  }
  return Object.freeze(results);
}

class AccountManager extends core.AccountManager {
  constructor(options = {}) {
    super();
    configureSessionState(this, options);
  }

  requestSessionRestore(input = {}) {
    return requestSessionRestore.call(this, input);
  }

  requestPersistedSessionRestores(input = {}) {
    return requestPersistedSessionRestores.call(this, input);
  }
}

const accountManager = configureSessionState(core, {});
Object.defineProperties(accountManager, {
  requestSessionRestore: {
    enumerable: false,
    configurable: false,
    writable: false,
    value: requestSessionRestore.bind(accountManager)
  },
  requestPersistedSessionRestores: {
    enumerable: false,
    configurable: false,
    writable: false,
    value: requestPersistedSessionRestores.bind(accountManager)
  }
});

module.exports = accountManager;
module.exports.AccountManager = AccountManager;
module.exports.CAPABILITY_MATRIX = core.CAPABILITY_MATRIX;
module.exports.SESSION_RESTORE = SESSION_RESTORE;
module.exports.currentRuntimeAuthorityStore = currentRuntimeAuthorityStore;
module.exports.RuntimeAccountList = runtimeAccountList;
