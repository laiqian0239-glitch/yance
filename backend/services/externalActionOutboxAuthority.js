'use strict';

const core = require('./externalActionOutboxAuthorityCore');

const WP_B_INTENT_IDEMPOTENCY_CONFLICT = 'WP_B_INTENT_IDEMPOTENCY_CONFLICT';
const LATE_RESULT = core.RECEIPT_TYPES.LATE_RESULT;
const contentHashVersion = core.HASH_VERSION;

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw core.outboxError('WP_B_OUTBOX_FIELD_INVALID', `${field} is required and must be bounded`, { field });
  }
  return result;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw core.outboxError('WP_B_OUTBOX_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}

function normalizedTimestamp(value, field = 'authorityTimestamp') {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw core.outboxError(
      'WP_B_OUTBOX_AUTHORITY_TIMESTAMP_INVALID',
      `${field} must be an explicit normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

class ExternalActionOutboxAuthority extends core.ExternalActionOutboxAuthority {
  rearmRetry(input = {}) {
    const intentId = requiredString(input.intentId, 'intentId');
    const receiptId = requiredString(input.receiptId, 'receiptId');
    const ownerId = requiredString(input.ownerId, 'ownerId');
    const hostId = requiredString(input.hostId || ownerId, 'hostId');
    const claimId = requiredString(input.claimId, 'claimId');
    const stateVersion = safeInteger(input.stateVersion, 'stateVersion');
    const generation = safeInteger(input.generation, 'generation', 1);
    const hostGeneration = safeInteger(input.hostGeneration, 'hostGeneration', 1);
    const fencingToken = safeInteger(input.fencingToken, 'fencingToken', 1);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp);
    const store = this.store();
    this.assertSchema23(store);

    return store.transaction(() => {
      const result = store.db.prepare(`UPDATE external_action_claims SET
          state='READY',state_version=state_version+1,generation=generation+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',updated_at=?
        WHERE intent_id=? AND state='FAILED' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM external_action_receipts
            WHERE receipt_id=? AND intent_id=? AND receipt_type='FAILURE'
          )
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        authorityTimestamp,
        intentId,
        stateVersion,
        generation,
        ownerId,
        claimId,
        hostGeneration,
        fencingToken,
        authorityTimestamp,
        receiptId,
        intentId,
        hostId,
        hostGeneration,
        fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw core.outboxError(
          'WP_B_OUTBOX_RETRY_REARM_CAS_REJECTED',
          'Retry re-arm was rejected by receipt binding, claim identity, lease, or Host fencing',
          { intentId, receiptId, stateVersion, generation, claimId, hostGeneration, fencingToken }
        );
      }
      return this.intent(intentId, store);
    });
  }
}

const externalActionOutboxAuthority = new ExternalActionOutboxAuthority();

function intentContentSha256(input = {}) {
  return core.normalizeIntentCommand(input).intentContentSha256;
}

function recordLateResult(input = {}) {
  return externalActionOutboxAuthority.recordLateResult(input);
}

module.exports = externalActionOutboxAuthority;
for (const [name, value] of Object.entries(core)) {
  if (name === 'ExternalActionOutboxAuthority') continue;
  Object.defineProperty(module.exports, name, {
    value,
    enumerable: true,
    writable: false,
    configurable: false
  });
}
Object.defineProperties(module.exports, {
  ExternalActionOutboxAuthority: {
    value: ExternalActionOutboxAuthority,
    enumerable: true,
    writable: false,
    configurable: false
  },
  intentContentSha256: {
    value: intentContentSha256,
    enumerable: true,
    writable: false,
    configurable: false
  },
  recordLateResult: {
    value: recordLateResult,
    enumerable: true,
    writable: false,
    configurable: false
  },
  WP_B_INTENT_IDEMPOTENCY_CONFLICT: {
    value: WP_B_INTENT_IDEMPOTENCY_CONFLICT,
    enumerable: true,
    writable: false,
    configurable: false
  },
  LATE_RESULT: {
    value: LATE_RESULT,
    enumerable: true,
    writable: false,
    configurable: false
  },
  contentHashVersion: {
    value: contentHashVersion,
    enumerable: true,
    writable: false,
    configurable: false
  }
});
Object.freeze(module.exports);