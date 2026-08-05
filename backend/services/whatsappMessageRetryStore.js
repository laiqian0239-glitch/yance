'use strict';

const {
  DEFAULT_TTL_MS,
  createWhatsAppMessageRetryRepository
} = require('../repositories/whatsappMessageRetryRepository');

const PRIVATE = new WeakMap();

function serviceError(code, message) {
  const error = new Error(message);
  error.name = 'WhatsAppMessageRetryStoreError';
  error.code = code;
  error.reasonCode = code;
  return error;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw serviceError('WHATSAPP_RETRY_STORE_INVALID', 'Retry store private state is unavailable');
  return state;
}

function validateRepository(repository) {
  for (const method of ['read', 'write', 'delete', 'deleteAll', 'snapshot']) {
    if (typeof repository?.[method] !== 'function') {
      throw serviceError('WHATSAPP_RETRY_STORE_REPOSITORY_INVALID', `Retry repository method ${method} is unavailable`);
    }
  }
  return repository;
}

class WhatsAppMessageRetryStore {
  constructor(options = {}) {
    const repository = options.repository || createWhatsAppMessageRetryRepository(options);
    PRIVATE.set(this, Object.freeze({ repository: validateRepository(repository) }));
    Object.freeze(this);
  }

  get(key) {
    return stateFor(this).repository.read(key);
  }

  set(key, value, ttlMs = undefined) {
    return stateFor(this).repository.write(key, value, ttlMs);
  }

  del(key) {
    return stateFor(this).repository.delete(key);
  }

  flushAll() {
    return stateFor(this).repository.deleteAll();
  }

  snapshot() {
    const snapshot = stateFor(this).repository.snapshot();
    return Object.freeze({
      module: 'WhatsAppMessageRetryStore',
      accountKey: snapshot.accountKey,
      persistedCounters: snapshot.persistedCounters
    });
  }
}

Object.freeze(WhatsAppMessageRetryStore.prototype);

function createWhatsAppMessageRetryStore(options = {}) {
  return new WhatsAppMessageRetryStore(options);
}

module.exports = Object.freeze({
  DEFAULT_TTL_MS,
  WhatsAppMessageRetryStore,
  createWhatsAppMessageRetryStore
});
