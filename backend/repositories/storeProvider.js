'use strict';

// The repository layer is the only application layer allowed to resolve the
// process primary store. Callers receive revocable capability facades rather
// than the raw R32SqliteStore or DatabaseSync objects.
const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');

const storeCapabilities = new WeakMap();
const databaseCapabilities = new WeakMap();
const statementCapabilities = new WeakMap();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertCurrentStore(store) {
  if (!store || typeof store.assertOwnership !== 'function') {
    throw fail('PRIMARY_STORE_CAPABILITY_INVALID', 'Primary store does not expose an ownership assertion');
  }
  store.assertOwnership();
  return store;
}

function immutableValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return Object.freeze(JSON.parse(JSON.stringify(value))); }
  catch (_) { return value; }
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableAsyncValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return deepFreeze(JSON.parse(JSON.stringify(value))); }
  catch (_) { return value; }
}

function wrapStatement(store, statement) {
  if (!statement || typeof statement !== 'object') return statement;
  if (statementCapabilities.has(statement)) return statementCapabilities.get(statement);
  const capability = new Proxy(Object.create(null), {
    get(_target, property) {
      const value = statement[property];
      if (typeof value !== 'function') return immutableValue(value);
      return (...args) => {
        assertCurrentStore(store);
        const result = Reflect.apply(value, statement, args);
        return result === statement ? capability : immutableValue(result);
      };
    },
    set() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Statement capability is immutable'); },
    defineProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Statement capability is immutable'); },
    deleteProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Statement capability is immutable'); }
  });
  statementCapabilities.set(statement, capability);
  return capability;
}

function wrapDatabase(store) {
  const db = assertCurrentStore(store).db;
  if (!db) throw fail('PRIMARY_STORE_DATABASE_UNAVAILABLE', 'Primary database is unavailable');
  if (databaseCapabilities.has(db)) return databaseCapabilities.get(db);
  const capability = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'close') {
        return () => { throw fail('PRIMARY_DATABASE_CLOSE_FORBIDDEN', 'Only the SQLite broker may close the primary database'); };
      }
      const value = db[property];
      if (typeof value !== 'function') return immutableValue(value);
      return (...args) => {
        assertCurrentStore(store);
        const result = Reflect.apply(value, db, args);
        return property === 'prepare' ? wrapStatement(store, result) : immutableValue(result);
      };
    },
    set() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Database capability is immutable'); },
    defineProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Database capability is immutable'); },
    deleteProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Database capability is immutable'); }
  });
  databaseCapabilities.set(db, capability);
  return capability;
}

function createStoreCapability(store) {
  if (storeCapabilities.has(store)) return storeCapabilities.get(store);
  const capability = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'db') return wrapDatabase(store);
      if (property === 'close' || property === 'authorityWriteHostCapability' || property === 'ownedAuthorityWriteHost' || property === 'ownership' || property === 'transactions') {
        return undefined;
      }
      const value = assertCurrentStore(store)[property];
      if (typeof value !== 'function') return immutableValue(value);
      return (...args) => {
        assertCurrentStore(store);
        const result = Reflect.apply(value, store, args);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(resolved =>
            resolved === store ? capability : immutableAsyncValue(resolved)
          );
        }
        return result === store ? capability : immutableValue(result);
      };
    },
    set() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Primary store capability is immutable'); },
    defineProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Primary store capability is immutable'); },
    deleteProperty() { throw fail('PRIMARY_STORE_CAPABILITY_IMMUTABLE', 'Primary store capability is immutable'); }
  });
  storeCapabilities.set(store, capability);
  return capability;
}

function getPrimaryStoreCapability() {
  return createStoreCapability(getR32Store());
}

function getAuthorityReadSnapshot() {
  const store = assertCurrentStore(getR32Store());
  return Object.freeze({
    dbPath: String(store.dbPath || ''),
    schemaVersion: Number(store.getMeta?.('schema_version', 0) || 0),
    authorityWriteHost: immutableValue(store.authorityWriteHostCapability?.tokenSnapshot?.() || null)
  });
}

function getDocumentPersistenceCapability() {
  const store = getPrimaryStoreCapability();
  return Object.freeze({
    getSetting: (...args) => store.getSetting(...args),
    setSetting: (...args) => store.setSetting(...args),
    transaction: work => store.transaction(work),
    transactionAsync: work => store.transactionAsync(work)
  });
}

// Compatibility name retained for repositories during staged work-package
// migration. It returns a guarded capability, never the raw writable store.
function getStore() {
  return getPrimaryStoreCapability();
}

function closeStore() {
  return closeR32Store();
}

module.exports = {
  getAuthorityReadSnapshot,
  getDocumentPersistenceCapability,
  getPrimaryStoreCapability,
  getStore,
  closeStore
};
