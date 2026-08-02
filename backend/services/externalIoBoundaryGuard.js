'use strict';

const { currentAuthorityWriteTransaction } = require('./authorityTransactionContext');

const EXTERNAL_IO_KINDS = Object.freeze([
  'network',
  'provider-sdk',
  'platform-sdk',
  'filesystem-transfer',
  'child-process',
  'user-wait',
  'timer-wait'
]);
const EXTERNAL_IO_KIND_SET = new Set(EXTERNAL_IO_KINDS);

function ioBoundaryError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertExternalIoAllowed(kindInput) {
  const kind = String(kindInput || '').trim();
  if (!EXTERNAL_IO_KIND_SET.has(kind)) {
    throw ioBoundaryError('EXTERNAL_IO_KIND_UNREGISTERED', `External IO kind ${kind || '<empty>'} is not registered`, { kind });
  }
  const context = currentAuthorityWriteTransaction();
  if (!context) return true;
  throw ioBoundaryError(
    'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN',
    `External IO (${kind}) is forbidden inside authority write transaction ${context.commandId}`,
    {
      kind,
      commandId: context.commandId,
      authorityScope: context.authorityScope,
      hostGeneration: context.hostGeneration,
      fencingToken: context.fencingToken,
      startedAtMs: context.startedAtMs
    }
  );
}

module.exports = {
  EXTERNAL_IO_KINDS,
  assertExternalIoAllowed,
  ioBoundaryError
};
