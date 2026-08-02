'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('SqliteDocumentStore');

const { getR32Store } = require('./r32StoreSingleton');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class SqliteDocumentStore {
  constructor(namespace, defaults = {}) {
    this.namespace = String(namespace || '').trim();
    if (!this.namespace) throw new Error('SQLITE_DOCUMENT_NAMESPACE_REQUIRED');
    this.defaults = clone(defaults);
    const store = getR32Store();
    if (store.getSetting(this.namespace, 'document', undefined) === undefined) {
      store.setSetting(this.namespace, 'document', this.defaults);
    }
  }

  read() {
    return clone(getR32Store().getSetting(this.namespace, 'document', this.defaults));
  }

  write(value) {
    const next = clone(value);
    getR32Store().setSetting(this.namespace, 'document', next);
    return Promise.resolve(clone(next));
  }

  update(mutator) {
    const store = getR32Store();
    let next;
    store.transaction(() => {
      const current = clone(store.getSetting(this.namespace, 'document', this.defaults));
      const result = mutator(current);
      if (result && typeof result.then === 'function') throw new Error('ASYNC_MUTATOR_NOT_SUPPORTED');
      next = result === undefined ? current : result;
      store.setSetting(this.namespace, 'document', next);
    });
    return Promise.resolve(clone(next));
  }

  async updateAsync(mutator) {
    const store = getR32Store();
    let next;
    await store.transactionAsync(async () => {
      const current = clone(store.getSetting(this.namespace, 'document', this.defaults));
      const result = mutator(current);
      if (result && typeof result.then === 'function') throw new Error('ASYNC_MUTATOR_NOT_SUPPORTED');
      next = result === undefined ? current : result;
      store.setSetting(this.namespace, 'document', next);
    });
    return clone(next);
  }
}

module.exports = { SqliteDocumentStore, clone };
