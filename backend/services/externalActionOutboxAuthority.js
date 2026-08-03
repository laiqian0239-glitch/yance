'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const { canonicalHash, canonicalSerialize } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');

const AUTHORITY = 'ExternalActionOutboxAuthority';
const HASH_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RECONCILIATION_OUTCOMES = Object.freeze({
  REMOTE_SUCCESS_PROVEN: 'REMOTE_SUCCESS_PROVEN',
  REMOTE_ABSENCE_PROVEN: 'REMOTE_ABSENCE_PROVEN',
  REMOTE_RESULT_UNKNOWN: 'REMOTE_RESULT_UNKNOWN'
});
const RECONCILIATION_OUTCOME_VALUES = new Set(Object.values(RECONCILIATION_OUTCOMES));
const RECEIPT_TYPES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  UNKNOWN: 'UNKNOWN',
  LATE_RESULT: 'LATE_RESULT',
  MANUAL_RESOLUTION: 'MANUAL_RESOLUTION'
});

function outboxError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (!result) throw outboxError('WP_B_OUTBOX_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw outboxError('WP_B_OUTBOX_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw outboxError('WP_B_OUTBOX_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw outboxError('WP_B_OUTBOX_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}

function normalizedTimestamp(value, field) {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw outboxError(
      'WP_B_OUTBOX_AUTHORITY_TIMESTAMP_INVALID',
      `${field} must be an explicit normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

function canonicalPlainData(value, field) {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(value == null ? {} : value)));
  } catch (error) {
    throw outboxError('WP_B_OUTBOX_CANONICAL_DATA_INVALID', `${field} must be canonical plain data`, {
      field,
      causeCode: String(error?.code || ''),
      causeMessage: String(error?.message || error)
    });
  }
}

function normalizeIntentCommand(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw outboxError('WP_B_INTENT_COMMAND_INVALID', 'External action intent command must be an object');
  }
  const executionId = requiredString(input.executionId, 'executionId');
  const actionKind = requiredString(input.actionKind, 'actionKind', 128);
  const idempotencyKey = requiredString(input.idempotencyKey, 'idempotencyKey');
  const payload = canonicalPlainData(input.payload || {}, 'payload');
  const intentContentSha256 = canonicalHash({
    schemaVersion: 1,
    executionId,
    actionKind,
    idempotencyKey,
    payload
  });
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    executionId,
    actionKind,
    idempotencyKey,
    intentContentSha256,
    contentHashVersion: HASH_VERSION,
    payload
  });
}

function defaultIdFactory(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseJson(value, fallback = {}) {
  try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; }
}

function assertHash(value, field) {
  const hash = requiredString(value, field, 64).toLowerCase();
  if (!HASH_PATTERN.test(hash)) {
    throw outboxError('WP_B_OUTBOX_HASH_INVALID', `${field} must be a lowercase SHA-256`, { field });
  }
  return hash;
}

function claimSnapshot(row = {}) {
  return deepFreeze({
    state: String(row.state || ''),
    stateVersion: Number(row.state_version || 0),
    generation: Number(row.generation || 0),
    ownerId: String(row.owner_id || ''),
    claimId: String(row.claim_id || ''),
    hostGeneration: Number(row.host_generation || 0),
    fencingToken: Number(row.fencing_token || 0),
    leaseStartedAt: String(row.lease_started_at || ''),
    leaseExpiresAt: String(row.lease_expires_at || ''),
    updatedAt: String(row.updated_at || '')
  });
}

function intentSnapshot(intentRow, claimRow) {
  if (!intentRow) return null;
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    intentId: String(intentRow.intent_id || ''),
    executionId: String(intentRow.execution_id || ''),
    actionKind: String(intentRow.action_kind || ''),
    idempotencyKey: String(intentRow.idempotency_key || ''),
    intentContentSha256: String(intentRow.intent_content_sha256 || ''),
    contentHashVersion: Number(intentRow.content_hash_version || 0),
    payload: canonicalPlainData(parseJson(intentRow.payload_json, {}), 'persistedIntent.payload'),
    createdAt: String(intentRow.created_at || ''),
    claim: claimSnapshot(claimRow || {})
  });
}

function attemptSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    attemptId: String(row.attempt_id || ''),
    intentId: String(row.intent_id || ''),
    attemptSequence: Number(row.attempt_sequence || 0),
    claimId: String(row.claim_id || ''),
    generation: Number(row.generation || 0),
    hostGeneration: Number(row.host_generation || 0),
    fencingToken: Number(row.fencing_token || 0),
    requestContentSha256: String(row.request_content_sha256 || ''),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || ''),
    state: String(row.state || 'ATTEMPTED'),
    stateVersion: Number(row.state_version || 0),
    ownerId: String(row.owner_id || '')
  });
}

function receiptSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    receiptId: String(row.receipt_id || ''),
    intentId: String(row.intent_id || ''),
    attemptId: String(row.attempt_id || ''),
    receiptType: String(row.receipt_type || ''),
    providerReceiptId: String(row.provider_receipt_id || ''),
    evidenceReference: String(row.evidence_reference || ''),
    receiptContentSha256: String(row.receipt_content_sha256 || ''),
    result: canonicalPlainData(parseJson(row.result_json, {}), 'persistedReceipt.result'),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || '')
  });
}

function reconciliationSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    reconciliationId: String(row.reconciliation_id || ''),
    intentId: String(row.intent_id || ''),
    attemptId: String(row.attempt_id || ''),
    observationOutcome: String(row.observation_outcome || ''),
    evidenceReference: String(row.evidence_reference || ''),
    remoteReceiptId: String(row.remote_receipt_id || ''),
    observation: canonicalPlainData(
      parseJson(row.observation_json, {}),
      'persistedReconciliation.observation'
    ),
    reconciliationContentSha256: String(row.reconciliation_content_sha256 || ''),
    contentHashVersion: Number(row.content_hash_version || 0),
    observedAt: String(row.observed_at || ''),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || '')
  });
}

class ExternalActionOutboxAuthority {
  constructor(options = {}) {
    this.storeProvider = typeof options.storeProvider === 'function' ? options.storeProvider : getStore;
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
  }

  store() {
    const store = this.storeProvider();
    if (!store?.db || typeof store.transaction !== 'function') {
      throw outboxError('WP_B_OUTBOX_STORE_REQUIRED', 'External action outbox requires the AuthorityWriteHost store');
    }
    return store;
  }

  assertSchema23(store) {
    const row = store.db.prepare(`SELECT status FROM r32_schema_migrations
      WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    if (String(row?.status || '') !== 'completed') {
      throw outboxError('WP_B_SCHEMA_23_REQUIRED', 'External action outbox requires completed Schema 23');
    }
  }

  intent(intentId, store = this.store()) {
    const id = requiredString(intentId, 'intentId');
    const intentRow = store.db.prepare('SELECT * FROM external_action_intents WHERE intent_id=?').get(id);
    const claimRow = store.db.prepare('SELECT * FROM external_action_claims WHERE intent_id=?').get(id);
    return intentSnapshot(intentRow, claimRow);
  }

  createIntent(input = {}) {
    const command = normalizeIntentCommand(input);
    const authorityTimestamp = normalizedTimestamp(
      input.authorityTimestamp || input.createdAt,
      'authorityTimestamp'
    );
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_action_intents
        WHERE action_kind=? AND idempotency_key=?`).get(command.actionKind, command.idempotencyKey);
      if (existing) {
        if (String(existing.intent_content_sha256 || '') !== command.intentContentSha256
            || Number(existing.content_hash_version || 0) !== HASH_VERSION) {
          throw outboxError(
            'WP_B_INTENT_IDEMPOTENCY_CONFLICT',
            'The external action idempotency key is already bound to different canonical content',
            {
              actionKind: command.actionKind,
              idempotencyKey: command.idempotencyKey,
              existingIntentId: String(existing.intent_id || ''),
              existingIntentContentSha256: String(existing.intent_content_sha256 || ''),
              incomingIntentContentSha256: command.intentContentSha256
            }
          );
        }
        return this.intent(existing.intent_id, store);
      }

      const execution = store.db.prepare('SELECT execution_id FROM durable_executions WHERE execution_id=?')
        .get(command.executionId);
      if (!execution) {
        throw outboxError('WP_B_OUTBOX_EXECUTION_NOT_FOUND', 'Durable execution does not exist', {
          executionId: command.executionId
        });
      }
      const intentId = optionalString(input.intentId, 'intentId') || this.idFactory('external-intent');
      store.db.prepare(`INSERT INTO external_action_intents(
        intent_id,execution_id,action_kind,idempotency_key,intent_content_sha256,
        content_hash_version,payload_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        intentId,
        command.executionId,
        command.actionKind,
        command.idempotencyKey,
        command.intentContentSha256,
        HASH_VERSION,
        canonicalSerialize(command.payload),
        authorityTimestamp
      );
      store.db.prepare(`INSERT INTO external_action_claims(
        intent_id,state,state_version,generation,owner_id,claim_id,host_generation,
        fencing_token,lease_started_at,lease_expires_at,updated_at
      ) VALUES(?,'READY',0,0,'','',0,0,'','',?)`).run(intentId, authorityTimestamp);
      return this.intent(intentId, store);
    });
  }

  claimIntent(input = {}) {
    const intentId = requiredString(input.intentId, 'intentId');
    const ownerId = requiredString(input.ownerId, 'ownerId');
    const hostId = optionalString(input.hostId, 'hostId') || ownerId;
    const claimId = requiredString(input.claimId, 'claimId');
    const expectedStateVersion = safeInteger(input.stateVersion ?? input.expectedStateVersion, 'stateVersion');
    const expectedGeneration = safeInteger(input.generation ?? input.expectedGeneration ?? 0, 'generation');
    const hostGeneration = safeInteger(input.hostGeneration, 'hostGeneration', 1);
    const fencingToken = safeInteger(input.fencingToken, 'fencingToken', 1);
    const leaseStartedAt = normalizedTimestamp(input.leaseStartedAt || input.authorityTimestamp, 'leaseStartedAt');
    const leaseExpiresAt = normalizedTimestamp(input.leaseExpiresAt, 'leaseExpiresAt');
    if (leaseExpiresAt <= leaseStartedAt) {
      throw outboxError('WP_B_OUTBOX_LEASE_INVALID', 'leaseExpiresAt must be after leaseStartedAt');
    }
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const result = store.db.prepare(`UPDATE external_action_claims SET
          state='CLAIMED',state_version=state_version+1,generation=generation+1,
          owner_id=?,claim_id=?,host_generation=?,fencing_token=?,
          lease_started_at=?,lease_expires_at=?,updated_at=?
        WHERE intent_id=? AND state='READY' AND state_version=? AND generation=?
          AND owner_id='' AND claim_id='' AND host_generation=0 AND fencing_token=0
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        ownerId,
        claimId,
        hostGeneration,
        fencingToken,
        leaseStartedAt,
        leaseExpiresAt,
        leaseStartedAt,
        intentId,
        expectedStateVersion,
        expectedGeneration,
        hostId,
        hostGeneration,
        fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw outboxError('WP_B_OUTBOX_CLAIM_CAS_REJECTED', 'External action claim CAS rejected', { intentId });
      }
      return this.intent(intentId, store);
    });
  }

  reclaimExpiredClaim(input = {}) {
    const intentId = requiredString(input.intentId, 'intentId');
    const stateVersion = safeInteger(input.stateVersion ?? input.expectedStateVersion, 'stateVersion');
    const generation = safeInteger(input.generation ?? input.expectedGeneration, 'generation', 1);
    const expiredOwnerId = requiredString(input.expiredOwnerId, 'expiredOwnerId');
    const expiredClaimId = requiredString(input.expiredClaimId, 'expiredClaimId');
    const expiredHostGeneration = safeInteger(input.expiredHostGeneration, 'expiredHostGeneration', 1);
    const expiredFencingToken = safeInteger(input.expiredFencingToken, 'expiredFencingToken', 1);
    const hostId = requiredString(input.hostId, 'hostId');
    const hostGeneration = safeInteger(input.hostGeneration, 'hostGeneration', 1);
    const fencingToken = safeInteger(input.fencingToken, 'fencingToken', 1);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const result = store.db.prepare(`UPDATE external_action_claims SET
          state='READY',state_version=state_version+1,generation=generation+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',updated_at=?
        WHERE intent_id=? AND state='CLAIMED' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at<?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        authorityTimestamp,
        intentId,
        stateVersion,
        generation,
        expiredOwnerId,
        expiredClaimId,
        expiredHostGeneration,
        expiredFencingToken,
        authorityTimestamp,
        hostId,
        hostGeneration,
        fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_OUTBOX_RECLAIM_CAS_REJECTED',
          'Expired external action claim reclaim CAS rejected',
          {
            intentId,
            stateVersion,
            generation,
            expiredClaimId,
            expiredHostGeneration,
            expiredFencingToken
          }
        );
      }
      return deepFreeze({
        schemaVersion: 1,
        authority: AUTHORITY,
        intentId,
        state: 'READY',
        stateVersion: stateVersion + 1,
        generation: generation + 1,
        ownerId: '',
        claimId: '',
        hostGeneration: 0,
        fencingToken: 0,
        leaseStartedAt: '',
        leaseExpiresAt: '',
        authorityTimestamp
      });
    });
  }

  startAttempt(input = {}) {
    const facts = this.normalizeClaimFacts(input, 'startAttempt');
    const request = canonicalPlainData(input.request || {}, 'request');
    const requestContentSha256 = canonicalHash({
      schemaVersion: 1,
      intentId: facts.intentId,
      claimId: facts.claimId,
      generation: facts.generation,
      request
    });
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(attempt_sequence),0)+1 AS next
        FROM external_action_attempts WHERE intent_id=?`).get(facts.intentId)?.next || 1);
      const result = store.db.prepare(`UPDATE external_action_claims SET
          state='ATTEMPTED',state_version=state_version+1,updated_at=?
        WHERE intent_id=? AND state='CLAIMED' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        authorityTimestamp,
        facts.intentId,
        facts.stateVersion,
        facts.generation,
        facts.ownerId,
        facts.claimId,
        facts.hostGeneration,
        facts.fencingToken,
        authorityTimestamp,
        facts.hostId,
        facts.hostGeneration,
        facts.fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw outboxError('WP_B_OUTBOX_ATTEMPT_CAS_REJECTED', 'External action attempt CAS rejected', {
          intentId: facts.intentId,
          claimId: facts.claimId
        });
      }
      const attemptId = optionalString(input.attemptId, 'attemptId') || this.idFactory('external-attempt');
      store.db.prepare(`INSERT INTO external_action_attempts(
        attempt_id,intent_id,attempt_sequence,claim_id,generation,host_generation,
        fencing_token,request_content_sha256,authority_timestamp,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        attemptId,
        facts.intentId,
        sequence,
        facts.claimId,
        facts.generation,
        facts.hostGeneration,
        facts.fencingToken,
        requestContentSha256,
        authorityTimestamp,
        authorityTimestamp
      );
      const row = store.db.prepare(`SELECT a.*,c.state,c.state_version,c.owner_id
        FROM external_action_attempts a
        JOIN external_action_claims c ON c.intent_id=a.intent_id
        WHERE a.attempt_id=?`).get(attemptId);
      return attemptSnapshot(row);
    });
  }

  normalizeClaimFacts(input, operation) {
    const ownerId = requiredString(input.ownerId, 'ownerId');
    return Object.freeze({
      operation,
      intentId: requiredString(input.intentId, 'intentId'),
      attemptId: optionalString(input.attemptId, 'attemptId'),
      ownerId,
      hostId: optionalString(input.hostId, 'hostId') || ownerId,
      claimId: requiredString(input.claimId, 'claimId'),
      stateVersion: safeInteger(input.stateVersion, 'stateVersion'),
      generation: safeInteger(input.generation, 'generation', 1),
      hostGeneration: safeInteger(input.hostGeneration, 'hostGeneration', 1),
      fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1)
    });
  }

  recordReceipt(input = {}) {
    return this.recordTerminalReceipt(input, RECEIPT_TYPES.SUCCESS, 'COMPLETED');
  }

  recordFailureReceipt(input = {}) {
    return this.recordTerminalReceipt(input, RECEIPT_TYPES.FAILURE, 'FAILED');
  }

  markUncertain(input = {}) {
    return this.recordTerminalReceipt(input, RECEIPT_TYPES.UNKNOWN, 'UNCERTAIN');
  }

  recordTerminalReceipt(input, receiptType, targetState) {
    const facts = this.normalizeClaimFacts(input, `record${receiptType}`);
    const attemptId = requiredString(input.attemptId, 'attemptId');
    const providerReceiptId = optionalString(input.providerReceiptId, 'providerReceiptId');
    const evidenceReference = requiredString(input.evidenceReference, 'evidenceReference');
    const resultDocument = canonicalPlainData(input.result || {}, 'result');
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const receiptContentSha256 = canonicalHash({
      schemaVersion: 1,
      receiptType,
      intentId: facts.intentId,
      attemptId,
      providerReceiptId,
      evidenceReference,
      result: resultDocument,
      authorityTimestamp
    });
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_action_receipts
        WHERE intent_id=? AND receipt_content_sha256=?`).get(facts.intentId, receiptContentSha256);
      if (existing) return receiptSnapshot(existing);

      const update = store.db.prepare(`UPDATE external_action_claims SET
          state=?,state_version=state_version+1,updated_at=?
        WHERE intent_id=? AND state='ATTEMPTED' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM external_action_attempts
            WHERE attempt_id=? AND intent_id=? AND claim_id=? AND generation=?
              AND host_generation=? AND fencing_token=?
          )
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        authorityTimestamp,
        facts.intentId,
        facts.stateVersion,
        facts.generation,
        facts.ownerId,
        facts.claimId,
        facts.hostGeneration,
        facts.fencingToken,
        authorityTimestamp,
        attemptId,
        facts.intentId,
        facts.claimId,
        facts.generation,
        facts.hostGeneration,
        facts.fencingToken,
        facts.hostId,
        facts.hostGeneration,
        facts.fencingToken
      );
      if (Number(update.changes || 0) !== 1) {
        throw outboxError('WP_B_OUTBOX_RECEIPT_CAS_REJECTED', 'External action receipt CAS rejected', {
          intentId: facts.intentId,
          attemptId,
          receiptType
        });
      }

      const receiptId = optionalString(input.receiptId, 'receiptId') || this.idFactory('external-receipt');
      const inserted = store.db.prepare(`INSERT INTO external_action_receipts(
          receipt_id,intent_id,attempt_id,receipt_type,provider_receipt_id,evidence_reference,
          receipt_content_sha256,result_json,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        receiptId,
        receiptType,
        providerReceiptId,
        evidenceReference,
        receiptContentSha256,
        canonicalSerialize(resultDocument),
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        facts.intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_OUTBOX_ATTEMPT_BINDING_REJECTED',
          'External action receipt attempt does not belong to the claimed intent',
          { intentId: facts.intentId, attemptId }
        );
      }
      return receiptSnapshot(store.db.prepare(
        'SELECT * FROM external_action_receipts WHERE receipt_id=?'
      ).get(receiptId));
    });
  }

  recordReconciliation(input = {}) {
    const reconciliationId = optionalString(input.reconciliationId, 'reconciliationId')
      || this.idFactory('external-reconciliation');
    const intentId = requiredString(input.intentId, 'intentId');
    const attemptId = requiredString(input.attemptId, 'attemptId');
    const observationOutcome = requiredString(
      input.observationOutcome || input.outcome,
      'observationOutcome',
      64
    );
    if (!RECONCILIATION_OUTCOME_VALUES.has(observationOutcome)) {
      throw outboxError(
        'WP_B_RECONCILIATION_OUTCOME_INVALID',
        'External outcome reconciliation has an unregistered outcome',
        { observationOutcome }
      );
    }
    const evidenceReference = requiredString(input.evidenceReference, 'evidenceReference');
    const remoteReceiptId = optionalString(input.remoteReceiptId, 'remoteReceiptId');
    const observation = canonicalPlainData(input.observation || {}, 'observation');
    const observedAt = normalizedTimestamp(input.observedAt, 'observedAt');
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const reconciliationContentSha256 = canonicalHash({
      schemaVersion: 1,
      intentId,
      attemptId,
      observationOutcome,
      evidenceReference,
      remoteReceiptId,
      observation,
      observedAt,
      authorityTimestamp
    });
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_outcome_reconciliations
        WHERE intent_id=? AND reconciliation_content_sha256=?`)
        .get(intentId, reconciliationContentSha256);
      if (existing) return reconciliationSnapshot(existing);

      const inserted = store.db.prepare(`INSERT INTO external_outcome_reconciliations(
          reconciliation_id,intent_id,attempt_id,observation_outcome,evidence_reference,
          remote_receipt_id,observation_json,reconciliation_content_sha256,
          content_hash_version,observed_at,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,1,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        reconciliationId,
        observationOutcome,
        evidenceReference,
        remoteReceiptId,
        canonicalSerialize(observation),
        reconciliationContentSha256,
        observedAt,
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_RECONCILIATION_ATTEMPT_BINDING_REJECTED',
          'External outcome reconciliation attempt does not belong to its intent',
          { intentId, attemptId }
        );
      }
      return reconciliationSnapshot(store.db.prepare(
        'SELECT * FROM external_outcome_reconciliations WHERE reconciliation_id=?'
      ).get(reconciliationId));
    });
  }

  recordLateResult(input = {}) {
    const intentId = requiredString(input.intentId, 'intentId');
    const attemptId = requiredString(input.attemptId, 'attemptId');
    const providerReceiptId = optionalString(input.providerReceiptId, 'providerReceiptId');
    const evidenceReference = requiredString(input.evidenceReference, 'evidenceReference');
    const resultDocument = canonicalPlainData(input.result || {}, 'result');
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const receiptContentSha256 = canonicalHash({
      schemaVersion: 1,
      receiptType: RECEIPT_TYPES.LATE_RESULT,
      intentId,
      attemptId,
      providerReceiptId,
      evidenceReference,
      result: resultDocument,
      authorityTimestamp
    });
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_action_receipts
        WHERE intent_id=? AND receipt_content_sha256=?`).get(intentId, receiptContentSha256);
      if (existing) return receiptSnapshot(existing);
      const receiptId = optionalString(input.receiptId, 'receiptId') || this.idFactory('external-late-result');
      const inserted = store.db.prepare(`INSERT INTO external_action_receipts(
          receipt_id,intent_id,attempt_id,receipt_type,provider_receipt_id,evidence_reference,
          receipt_content_sha256,result_json,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        receiptId,
        RECEIPT_TYPES.LATE_RESULT,
        providerReceiptId,
        evidenceReference,
        receiptContentSha256,
        canonicalSerialize(resultDocument),
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_OUTBOX_ATTEMPT_BINDING_REJECTED',
          'Late-result attempt does not belong to the supplied intent',
          { intentId, attemptId }
        );
      }
      return receiptSnapshot(store.db.prepare(
        'SELECT * FROM external_action_receipts WHERE receipt_id=?'
      ).get(receiptId));
    });
  }
}

module.exports = Object.freeze({
  AUTHORITY,
  HASH_VERSION,
  RECEIPT_TYPES,
  RECONCILIATION_OUTCOMES,
  ExternalActionOutboxAuthority,
  normalizeIntentCommand,
  outboxError
});
