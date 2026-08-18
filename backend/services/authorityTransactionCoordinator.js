'use strict';

const engine = require('./authorityTransactionCoordinatorEngine');

const ASYNC_CALLBACK_FORBIDDEN_CODE = 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN';
const EXTERNAL_IO_CAPABILITIES = Object.freeze([
  'network',
  'providerSdk',
  'platformSdk',
  'filesystemTransfer',
  'sleep',
  'remoteTimer',
  'userWait'
]);
const INTERNAL_TRANSACTION_CAPABILITIES = new Set([
  'sqlite',
  'canonicalLedger',
  'canonicalPayloadStore',
  'projection',
  'commandReceipt'
]);

function transactionIoError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizeCapability(value) {
  const capability = String(value == null ? '' : value).trim();
  if (!capability || capability.length > 128 || /[\u0000-\u001f\u007f]/u.test(capability)) {
    throw transactionIoError(
      'AUTHORITY_TRANSACTION_CAPABILITY_INVALID',
      'Transaction capability must be a non-empty stable identifier'
    );
  }
  return capability;
}

function createTransactionIoGuard() {
  const guard = {
    assertAllowed(value) {
      const capability = normalizeCapability(value);
      if (INTERNAL_TRANSACTION_CAPABILITIES.has(capability)) return capability;
      throw transactionIoError(
        'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN',
        `External I/O capability ${capability} is forbidden inside an authority transaction`,
        { capability }
      );
    },
    isAllowed(value) {
      try {
        const capability = normalizeCapability(value);
        return INTERNAL_TRANSACTION_CAPABILITIES.has(capability);
      } catch (_) {
        return false;
      }
    },
    allowedCapabilities() {
      return Object.freeze([...INTERNAL_TRANSACTION_CAPABILITIES].sort());
    }
  };
  return Object.freeze(guard);
}

class AuthorityTransactionCoordinator extends engine.AuthorityTransactionCoordinator {
  constructor(options = {}) {
    super(options);
    Object.defineProperty(this, 'transactionIoGuard', {
      value: createTransactionIoGuard(),
      enumerable: true,
      writable: false,
      configurable: false
    });
  }
}

module.exports = Object.freeze({
  ...engine,
  ASYNC_CALLBACK_FORBIDDEN_CODE,
  EXTERNAL_IO_CAPABILITIES,
  AuthorityTransactionCoordinator,
  createTransactionIoGuard,
  transactionIoError
});
