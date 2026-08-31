'use strict';

const { SqliteStorePersistenceAdapter } = require('./SqliteStorePersistenceAdapter');

class SynchronousSqliteStorePersistenceAdapter extends SqliteStorePersistenceAdapter {
  transaction(work, metadata = {}) {
    if (typeof work !== 'function') throw new TypeError('Store persistence transaction work must be a function');
    return this.store.transaction(() => {
      const transaction = this._createTransaction(metadata);
      const result = work(transaction);
      if (result && typeof result.then === 'function') {
        const error = new Error('Store persistence transaction returned a Promise inside DatabaseSync transaction');
        error.code = 'STORE_PERSISTENCE_ASYNC_TRANSACTION_UNSUPPORTED';
        throw error;
      }
      return result;
    });
  }
}

module.exports = { SynchronousSqliteStorePersistenceAdapter };
