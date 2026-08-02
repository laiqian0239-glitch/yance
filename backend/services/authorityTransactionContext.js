'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();
const CONTEXT_FIELDS = Object.freeze([
  'commandId',
  'authorityScope',
  'startedAtMs',
  'hostGeneration',
  'fencingToken'
]);

function contextError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizeContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw contextError('AUTHORITY_TRANSACTION_CONTEXT_INVALID', 'Authority transaction context must be an object');
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw contextError('AUTHORITY_TRANSACTION_CONTEXT_INVALID', 'Authority transaction context cannot contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const field of Object.getOwnPropertyNames(input)) {
    const descriptor = descriptors[field];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw contextError('AUTHORITY_TRANSACTION_CONTEXT_INVALID', 'Authority transaction context cannot contain accessors', { field });
    }
    if (!CONTEXT_FIELDS.includes(field)) {
      throw contextError('AUTHORITY_TRANSACTION_CONTEXT_INVALID', 'Authority transaction context contains an unknown field', { field });
    }
  }
  const commandId = String(descriptors.commandId?.value || '').trim();
  const authorityScope = String(descriptors.authorityScope?.value || '').trim();
  const startedAtMs = Number(descriptors.startedAtMs?.value);
  const hostGeneration = Number(descriptors.hostGeneration?.value);
  const fencingToken = Number(descriptors.fencingToken?.value);
  if (!commandId || !authorityScope || !Number.isFinite(startedAtMs) || startedAtMs <= 0 ||
      !Number.isSafeInteger(hostGeneration) || hostGeneration < 1 ||
      !Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw contextError('AUTHORITY_TRANSACTION_CONTEXT_INVALID', 'Authority transaction context fields are invalid', {
      commandId,
      authorityScope,
      startedAtMs,
      hostGeneration,
      fencingToken
    });
  }
  return Object.freeze({ commandId, authorityScope, startedAtMs, hostGeneration, fencingToken });
}

function currentAuthorityWriteTransaction() {
  return storage.getStore() || null;
}

function isAuthorityWriteTransactionActive() {
  return currentAuthorityWriteTransaction() !== null;
}

function sameContext(left, right) {
  return CONTEXT_FIELDS.every(field => left?.[field] === right?.[field]);
}

function runWithAuthorityWriteTransaction(input, work) {
  if (typeof work !== 'function') throw new TypeError('Authority transaction work must be a function');
  const normalized = normalizeContext(input);
  const current = currentAuthorityWriteTransaction();
  if (current) {
    if (!sameContext(current, normalized)) {
      throw contextError('AUTHORITY_TRANSACTION_CONTEXT_CONFLICT', 'A different authority transaction is already active', {
        activeCommandId: current.commandId,
        requestedCommandId: normalized.commandId
      });
    }
    return work();
  }
  return storage.run(normalized, work);
}

module.exports = {
  CONTEXT_FIELDS,
  runWithAuthorityWriteTransaction,
  currentAuthorityWriteTransaction,
  isAuthorityWriteTransactionActive,
  contextError
};
