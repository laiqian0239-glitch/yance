'use strict';

const history = require('./communicationAuthorityHistoryEngine');
const {
  OPERATION_KINDS
} = require('./durableOperationRegistry');
const {
  prepareSessionRestore
} = require('./durableOperations/sessionRestoreOperation');

const COMMUNICATION_OPERATION_KINDS = Object.freeze([
  OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
  OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION,
  OPERATION_KINDS.MEDIA_TRANSFER,
  OPERATION_KINDS.HISTORY_SYNCHRONIZATION
]);

class CommunicationAuthority extends history.CommunicationAuthority {
  constructor(options = {}) {
    super(options);
    if (typeof this.durableExecutionAuthority?.createExecution !== 'function') {
      throw new TypeError('CommunicationAuthority SESSION_RESTORE requires DurableExecutionAuthority.createExecution');
    }
    if (typeof this.outboxAuthority?.createIntent !== 'function') {
      throw new TypeError('CommunicationAuthority SESSION_RESTORE requires ExternalActionOutboxAuthority.createIntent');
    }
  }

  prepareSessionRestore(input = {}) {
    return prepareSessionRestore({
      durableExecutionAuthority: this.durableExecutionAuthority,
      outboxAuthority: this.outboxAuthority,
      issueTimestamp: this.issueTimestamp,
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey,
      deadlineAt: input.deadlineAt,
      maxAttempts: input.maxAttempts,
      command: input.command
    });
  }
}

const communicationAuthority = new CommunicationAuthority();
module.exports = communicationAuthority;
module.exports.CommunicationAuthority = CommunicationAuthority;
module.exports.AUTHORITY = history.AUTHORITY;
module.exports.SCHEMA_VERSION = history.SCHEMA_VERSION;
module.exports.COMMUNICATION_OPERATION_KINDS = COMMUNICATION_OPERATION_KINDS;
module.exports.normalizeContent = history.normalizeContent;
module.exports.renderProjection = history.renderProjection;
module.exports.historyAuthorityError = history.historyAuthorityError;
module.exports.historyExecutionClaim = history.historyExecutionClaim;
