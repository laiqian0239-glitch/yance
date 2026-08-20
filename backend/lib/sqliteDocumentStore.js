'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');

const { getDocumentPersistenceCapability } = require('../repositories/storeProvider');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function capabilityError(message) {
  const error = new Error(message);
  error.code = 'DOCUMENT_PERSISTENCE_CAPABILITY_REQUIRED';
  return error;
}

function validatePersistenceCapability(value) {
  if (!value || typeof value !== 'object') {
    throw capabilityError('SqliteDocumentStore requires a persistenceCapability');
  }
  for (const method of ['getSetting', 'setSetting', 'transaction', 'transactionAsync']) {
    if (typeof value[method] !== 'function') {
      throw capabilityError(`persistenceCapability.${method} must be a function`);
    }
  }
  return value;
}

class SqliteDocumentStore {
  constructor(namespace, defaults = {}, options = {}) {
    assertStorageAccess('SqliteDocumentStore.constructor');
    this.namespace = String(namespace || '').trim();
    if (!this.namespace) throw new Error('SQLITE_DOCUMENT_NAMESPACE_REQUIRED');
    this.defaults = clone(defaults);
    this.persistenceCapability = options.persistenceCapability || null;
    this.initialized = false;
  }

  _persistence() {
    const persistence = validatePersistenceCapability(
      this.persistenceCapability || getDocumentPersistenceCapability()
    );
    if (!this.initialized) {
      const existing = persistence.getSetting(this.namespace, 'document', undefined);
      if (existing === undefined) {
        persistence.setSetting(this.namespace, 'document', clone(this.defaults));
      }
      this.initialized = true;
    }
    return persistence;
  }

  read() {
    const persistence = this._persistence();
    return clone(persistence.getSetting(this.namespace, 'document', this.defaults));
  }

  write(value) {
    const persistence = this._persistence();
    const next = clone(value);
    persistence.setSetting(this.namespace, 'document', next);
    return Promise.resolve(clone(next));
  }

  update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('SQLITE_DOCUMENT_MUTATOR_REQUIRED');
    const persistence = this._persistence();
    let next;
    persistence.transaction(() => {
      const current = clone(persistence.getSetting(this.namespace, 'document', this.defaults));
      const result = mutator(current);
      if (result && typeof result.then === 'function') throw new Error('ASYNC_MUTATOR_NOT_SUPPORTED');
      next = result === undefined ? current : result;
      persistence.setSetting(this.namespace, 'document', clone(next));
    });
    return Promise.resolve(clone(next));
  }

  async updateAsync(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('SQLITE_DOCUMENT_MUTATOR_REQUIRED');
    const persistence = this._persistence();
    let next;
    await persistence.transactionAsync(async () => {
      const current = clone(persistence.getSetting(this.namespace, 'document', this.defaults));
      const result = mutator(current);
      if (result && typeof result.then === 'function') throw new Error('ASYNC_MUTATOR_NOT_SUPPORTED');
      next = result === undefined ? current : result;
      persistence.setSetting(this.namespace, 'document', clone(next));
    });
    return clone(next);
  }
}

module.exports = { SqliteDocumentStore, clone, validatePersistenceCapability };
