'use strict';

const DEFAULT_BAILEYS = require('@whiskeysockets/baileys');

const PRIVATE = new WeakMap();

function stateStoreError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppAuthStateStoreError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw stateStoreError('WHATSAPP_AUTH_STATE_STORE_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw stateStoreError('WHATSAPP_AUTH_STATE_STORE_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw stateStoreError('WHATSAPP_AUTH_STATE_STORE_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function privateState(instance) {
  const state = PRIVATE.get(instance);
  if (!state) {
    throw stateStoreError('WHATSAPP_AUTH_STATE_STORE_INVALID', 'AuthenticationState store private state is unavailable');
  }
  return state;
}

function validateRepository(repository) {
  const methods = [
    'loadAccount',
    'initializeAccount',
    'assertWriter',
    'commitCreds',
    'getKeys',
    'setKeys'
  ];
  for (const method of methods) {
    if (typeof repository?.[method] !== 'function') {
      throw stateStoreError(
        'WHATSAPP_AUTH_STATE_STORE_REPOSITORY_INVALID',
        'WhatsApp auth repository capability is incomplete',
        { method }
      );
    }
  }
  return repository;
}

function validateBaileys(baileys) {
  if (typeof baileys?.initAuthCreds !== 'function'
    || typeof baileys?.BufferJSON?.replacer !== 'function'
    || typeof baileys?.BufferJSON?.reviver !== 'function'
    || typeof baileys?.proto?.Message?.AppStateSyncKeyData?.fromObject !== 'function') {
    throw stateStoreError(
      'WHATSAPP_AUTH_STATE_STORE_BAILEYS_INVALID',
      'Pinned Baileys AuthenticationState helpers are unavailable'
    );
  }
  return baileys;
}

function cloneWithBufferJson(value, baileys) {
  try {
    return JSON.parse(
      JSON.stringify(value, baileys.BufferJSON.replacer),
      baileys.BufferJSON.reviver
    );
  } catch (_) {
    throw stateStoreError(
      'WHATSAPP_AUTH_STATE_STORE_CREDS_INVALID',
      'Persisted Baileys credentials cannot be restored'
    );
  }
}

function mutableCreds(value, baileys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw stateStoreError(
      'WHATSAPP_AUTH_STATE_STORE_CREDS_INVALID',
      'Persisted Baileys credentials are invalid'
    );
  }
  return Object.isFrozen(value) ? cloneWithBufferJson(value, baileys) : value;
}

function writerInput(binding) {
  return Object.freeze({
    accountKey: binding.accountKey,
    expectedEpoch: binding.epoch,
    expectedWriterGeneration: binding.generation,
    expectedSocketToken: binding.socketToken
  });
}

function assertOpen(leaseState) {
  if (leaseState.closed) {
    throw stateStoreError(
      'WHATSAPP_AUTH_LEASE_CLOSED',
      'WhatsApp AuthenticationState lease is closed',
      { accountKey: leaseState.binding.accountKey, epoch: leaseState.binding.epoch }
    );
  }
  return leaseState;
}

function restoreAppStateKeys(values, baileys) {
  const restored = {};
  for (const [id, value] of Object.entries(values || {})) {
    if (value != null) {
      restored[id] = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
    }
  }
  return restored;
}

class WhatsAppAuthStateStore {
  constructor(options = {}) {
    PRIVATE.set(this, Object.freeze({
      repository: validateRepository(options.repository),
      baileys: validateBaileys(options.baileys || DEFAULT_BAILEYS)
    }));
    Object.freeze(this);
  }

  async open(input = {}) {
    const state = privateState(this);
    const accountId = nonEmptyString(input.accountId, 'accountId');
    const accountKey = nonEmptyString(input.accountKey, 'accountKey');
    const generation = nonNegativeInteger(input.generation, 'generation');
    const socketToken = nonEmptyString(input.socketToken, 'socketToken');

    let account = await Promise.resolve(state.repository.loadAccount(accountKey));
    let creds;
    let epoch;

    if (!account) {
      epoch = 1;
      creds = state.baileys.initAuthCreds();
      if (!creds || typeof creds !== 'object') {
        throw stateStoreError(
          'WHATSAPP_AUTH_STATE_STORE_CREDS_INVALID',
          'Pinned Baileys initAuthCreds returned an invalid value'
        );
      }
      await Promise.resolve(state.repository.initializeAccount({
        accountId,
        accountKey,
        currentEpoch: epoch,
        writerGeneration: generation,
        socketToken,
        creds
      }));
    } else {
      if (String(account.accountId || '') !== accountId) {
        throw stateStoreError(
          'WHATSAPP_AUTH_STATE_STORE_ACCOUNT_MISMATCH',
          'Persisted WhatsApp auth account does not match the requested account',
          { accountKey }
        );
      }
      epoch = positiveInteger(Number(account.currentEpoch), 'currentEpoch');
      creds = mutableCreds(account.creds, state.baileys);
    }

    const binding = Object.freeze({ accountId, accountKey, epoch, generation, socketToken });
    await Promise.resolve(state.repository.assertWriter(writerInput(binding)));

    const leaseState = {
      binding,
      creds,
      closed: false
    };

    const keys = Object.freeze({
      async get(category, ids) {
        assertOpen(leaseState);
        const normalizedCategory = nonEmptyString(category, 'category');
        if (!Array.isArray(ids)) {
          throw stateStoreError('WHATSAPP_AUTH_STATE_STORE_INPUT_INVALID', 'ids must be an array');
        }
        const normalizedIds = ids.map(id => nonEmptyString(id, 'keyId'));
        const values = await Promise.resolve(state.repository.getKeys(
          binding.accountKey,
          binding.epoch,
          normalizedCategory,
          normalizedIds
        ));
        assertOpen(leaseState);
        if (normalizedCategory === 'app-state-sync-key') {
          return restoreAppStateKeys(values, state.baileys);
        }
        return values || {};
      },
      async set(updates) {
        assertOpen(leaseState);
        const result = await Promise.resolve(state.repository.setKeys({
          ...writerInput(binding),
          updates
        }));
        assertOpen(leaseState);
        return result;
      }
    });

    const authenticationState = Object.freeze({
      creds,
      keys
    });

    const lease = Object.freeze({
      epoch,
      state: authenticationState,
      async saveCreds() {
        assertOpen(leaseState);
        const result = await Promise.resolve(state.repository.commitCreds({
          ...writerInput(binding),
          creds: leaseState.creds
        }));
        assertOpen(leaseState);
        return result;
      },
      async close() {
        if (leaseState.closed) return false;
        leaseState.closed = true;
        return true;
      }
    });

    return lease;
  }
}

Object.freeze(WhatsAppAuthStateStore.prototype);

function createWhatsAppAuthStateStore(options = {}) {
  return new WhatsAppAuthStateStore(options);
}

module.exports = Object.freeze({
  WhatsAppAuthStateStore,
  createWhatsAppAuthStateStore
});
