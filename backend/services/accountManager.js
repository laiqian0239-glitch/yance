'use strict';

const core = require('./accountManagerCore');
const accountStore = require('./accountStore');
const durableExecutionAuthority = require('./durableExecutionAuthority');
const outboxAuthority = require('./externalActionOutboxAuthority');
const { canonicalHash } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');
const {
  OPERATION_KIND: SESSION_RESTORE,
  prepareSessionRestore
} = require('./durableOperations/sessionRestoreOperation');

const SESSION_STATES = new WeakMap();

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

function configureSessionState(target, options = {}) {
  const state = Object.freeze({
    accountReader: options.accountReader || accountStore.get.bind(accountStore),
    accountList: options.accountList || accountStore.listAll.bind(accountStore),
    durableExecutionAuthority: options.durableExecutionAuthority || durableExecutionAuthority,
    outboxAuthority: options.outboxAuthority || outboxAuthority,
    issueTimestamp: options.issueTimestamp || defaultAuthorityTimestamp
  });
  if (typeof state.accountReader !== 'function' || typeof state.accountList !== 'function') {
    throw new TypeError('AccountManager session restoration requires persisted account readers');
  }
  if (typeof state.durableExecutionAuthority?.createExecution !== 'function') {
    throw new TypeError('AccountManager SESSION_RESTORE requires DurableExecutionAuthority.createExecution');
  }
  if (typeof state.outboxAuthority?.createIntent !== 'function') {
    throw new TypeError('AccountManager SESSION_RESTORE requires ExternalActionOutboxAuthority.createIntent');
  }
  SESSION_STATES.set(target, state);
  return target;
}

function sessionState(target) {
  const state = SESSION_STATES.get(target);
  if (!state) throw new TypeError('AccountManager session restoration state is unavailable');
  return state;
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
  return prepareSessionRestore({
    durableExecutionAuthority: state.durableExecutionAuthority,
    outboxAuthority: state.outboxAuthority,
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
    if (!account || account.paused === true || account.metadata?.loggedOut === true) continue;
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
      credentialReference: account.credentialRef || account.credential_ref || '',
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
