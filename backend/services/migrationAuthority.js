'use strict';

const path = require('node:path');
const { isAuthorityWriteHostCapability, assertCurrentAuthorityWriteHostToken } = require('./authorityWriteHost');

const AUTHORITY = 'AuthorityWriteHostMigrationAuthority';
const AUTHORITY_STATES = new WeakMap();
let configuredAuthority = null;

function migrationAuthorityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, status: details.status || 503, ...details });
}
function testResetAllowed() {
  return Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test' || process.env.YANCE_TEST_ONLY_RUNTIME_RESET === '1');
}
function canonicalPath(value) { return path.resolve(String(value || '')); }
function stateFor(authority) {
  const state = AUTHORITY_STATES.get(authority);
  if (!state) throw migrationAuthorityError('MIGRATION_AUTHORITY_INVALID', 'Migration requires the runtime-issued AuthorityWriteHost migration capability');
  return state;
}
function assertStateCurrent(state) {
  const { store, authorityWriteHostCapability } = state;
  if (store.authorityWriteHostCapability !== authorityWriteHostCapability) {
    throw migrationAuthorityError('MIGRATION_AUTHORITY_STORE_MISMATCH', 'Migration target store is not bound to the supplied AuthorityWriteHost capability');
  }
  store.assertOwnership();
  assertCurrentAuthorityWriteHostToken(authorityWriteHostCapability, store.db);
  return state;
}
function createMigrationAuthority(options = {}) {
  const store = options.store;
  const authorityWriteHostCapability = options.authorityWriteHostCapability;
  if (!store || !store.db || typeof store.transaction !== 'function' || typeof store.assertOwnership !== 'function') {
    throw migrationAuthorityError('MIGRATION_AUTHORITY_STORE_REQUIRED', 'Migration authority requires the broker-owned primary store');
  }
  if (!isAuthorityWriteHostCapability(authorityWriteHostCapability)) {
    throw migrationAuthorityError('MIGRATION_AUTHORITY_WRITE_HOST_REQUIRED', 'Migration authority requires a genuine AuthorityWriteHost capability');
  }
  if (store.authorityWriteHostCapability !== authorityWriteHostCapability) {
    throw migrationAuthorityError('MIGRATION_AUTHORITY_STORE_MISMATCH', 'Migration authority store and AuthorityWriteHost capability do not match');
  }
  const dbPath = canonicalPath(store.dbPath || authorityWriteHostCapability.dbPath);
  const authority = Object.freeze({
    authority: AUTHORITY,
    targetStore() { return assertStateCurrent(stateFor(authority)).store; },
    assertTargetDbPath(candidate) {
      const state = assertStateCurrent(stateFor(authority));
      const actual = canonicalPath(candidate);
      if (actual !== state.dbPath) {
        throw migrationAuthorityError('MIGRATION_TARGET_DB_MISMATCH', 'Migration target path differs from the broker-owned primary database', { expected: state.dbPath, actual });
      }
      return state.dbPath;
    },
    snapshot() {
      const state = assertStateCurrent(stateFor(authority));
      const token = state.authorityWriteHostCapability.tokenSnapshot();
      return Object.freeze({ authority: AUTHORITY, dbPath: state.dbPath, hostGeneration: Number(token.hostGeneration), fencingToken: Number(token.fencingToken) });
    }
  });
  AUTHORITY_STATES.set(authority, Object.freeze({ store, authorityWriteHostCapability, dbPath }));
  assertStateCurrent(AUTHORITY_STATES.get(authority));
  return authority;
}
function assertMigrationAuthority(authority) { assertStateCurrent(stateFor(authority)); return authority; }
function configureMigrationAuthority(authority) {
  assertMigrationAuthority(authority);
  if (configuredAuthority && configuredAuthority !== authority && !testResetAllowed()) {
    throw migrationAuthorityError('MIGRATION_AUTHORITY_ALREADY_CONFIGURED', 'Migration authority is already bound for this process', { status: 409 });
  }
  configuredAuthority = authority;
  return authority;
}
function getMigrationAuthority() {
  if (!configuredAuthority) throw migrationAuthorityError('MIGRATION_AUTHORITY_NOT_READY', 'Migration authority is unavailable before AppRuntime composition');
  return assertMigrationAuthority(configuredAuthority);
}
function resetMigrationAuthorityForTests() {
  if (!testResetAllowed()) throw migrationAuthorityError('MIGRATION_AUTHORITY_TEST_RESET_FORBIDDEN', 'Migration authority reset is test-only', { status: 403 });
  configuredAuthority = null;
  return true;
}
module.exports = { AUTHORITY, createMigrationAuthority, assertMigrationAuthority, configureMigrationAuthority, getMigrationAuthority, resetMigrationAuthorityForTests };
