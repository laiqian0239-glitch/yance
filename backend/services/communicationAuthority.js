'use strict';

const core = require('./canonicalChannelStateEngine');
const { canonicalHash, canonicalSerialize } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');
const { OPERATION_KINDS } = require('./durableOperationRegistry');

function clean(value) { return String(value == null ? '' : value).trim(); }
function historyAuthorityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function requiredString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result) throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}
function optionalString(value, field, maximum = 2048) {
  const result = clean(value);
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}
function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}
function normalizedTimestamp(value, field) {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_TIMESTAMP_INVALID', `${field} must be normalized UTC ISO-8601`, { field });
  }
  return source;
}
function requireFrozen(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw historyAuthorityError('WP_B_HISTORY_CHECKPOINT_SNAPSHOT_REQUIRED', `${field} must be one frozen snapshot`, { field });
  }
  return value;
}
function historyExecutionClaim(value) {
  const snapshot = requireFrozen(value, 'executionClaim');
  const allowedStates = Array.isArray(snapshot.allowedStates)
    ? Object.freeze([...new Set(snapshot.allowedStates.map(state => requiredString(state, 'executionClaim.allowedStates', 64)))])
    : Object.freeze([]);
  if (allowedStates.length < 1) {
    throw historyAuthorityError(
      'WP_B_HISTORY_EXECUTION_STATES_REQUIRED',
      'executionClaim.allowedStates must contain the current durable states'
    );
  }
  return Object.freeze({
    executionId: requiredString(snapshot.executionId, 'executionClaim.executionId'),
    stateVersion: safeInteger(snapshot.stateVersion, 'executionClaim.stateVersion'),
    generation: safeInteger(snapshot.generation, 'executionClaim.generation', 1),
    ownerId: requiredString(snapshot.ownerId, 'executionClaim.ownerId'),
    claimId: requiredString(snapshot.claimId, 'executionClaim.claimId'),
    hostId: requiredString(snapshot.hostId, 'executionClaim.hostId'),
    hostGeneration: safeInteger(snapshot.hostGeneration, 'executionClaim.hostGeneration', 1),
    fencingToken: safeInteger(snapshot.fencingToken, 'executionClaim.fencingToken', 1),
    allowedStates
  });
}
function checkpointFacts(value) {
  const snapshot = requireFrozen(value, 'checkpoint');
  return Object.freeze({
    checkpointId: requiredString(snapshot.checkpointId, 'checkpoint.checkpointId'),
    platform: requiredString(snapshot.platform, 'checkpoint.platform', 64).toLowerCase(),
    sourceAccountId: requiredString(snapshot.sourceAccountId, 'checkpoint.sourceAccountId'),
    streamKind: requiredString(snapshot.streamKind, 'checkpoint.streamKind', 64).toLowerCase(),
    externalConversationId: requiredString(snapshot.externalConversationId, 'checkpoint.externalConversationId'),
    expectedVersion: safeInteger(snapshot.expectedVersion, 'checkpoint.expectedVersion')
  });
}
function observationFacts(value) {
  const snapshot = requireFrozen(value, 'observation');
  const outcome = requiredString(snapshot.outcome, 'observation.outcome', 64);
  if (!['PAGE_OBSERVED', 'REMOTE_RESULT_UNKNOWN'].includes(outcome)) {
    throw historyAuthorityError('WP_B_HISTORY_OBSERVATION_OUTCOME_INVALID', 'History observation outcome is unsupported', { outcome });
  }
  return Object.freeze({
    outcome,
    segmentReference: optionalString(snapshot.segmentReference, 'observation.segmentReference'),
    cursorReference: optionalString(snapshot.cursorReference, 'observation.cursorReference'),
    highWatermarkReference: optionalString(snapshot.highWatermarkReference, 'observation.highWatermarkReference'),
    gapClosed: snapshot.gapClosed === true,
    evidenceReference: requiredString(snapshot.evidenceReference, 'observation.evidenceReference')
  });
}

class CommunicationAuthority extends core.CommunicationAuthority {
  constructor(options = {}) {
    super(options);
    this.historyCheckpointTransactionCapability = options.historyCheckpointTransactionCapability || null;
  }

  prepareHistorySynchronization(input = {}) {
    return this.prepareExternalAction({
      ...input,
      operationKind: OPERATION_KINDS.HISTORY_SYNCHRONIZATION,
      executionTimestampPurpose: 'history-synchronization-execution',
      intentTimestampPurpose: 'history-synchronization-intent'
    });
  }

  historyCheckpointCapability() {
    if (this.historyCheckpointTransactionCapability) return this.historyCheckpointTransactionCapability;
    const store = this.store();
    if (!store?.db || typeof store.transaction !== 'function') {
      throw new TypeError('History synchronization requires the primary store transaction capability');
    }
    return Object.freeze({
      transaction: work => store.transaction(work),
      recordObservation: input => this.recordHistoryCheckpointObservation(input, store),
      advanceCheckpoint: input => this.advanceHistoryCheckpoint(input, store)
    });
  }

  recordHistoryCheckpointObservation(input = {}, store = this.store()) {
    const claim = historyExecutionClaim(input);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const observation = deepFreeze({
      schemaVersion: 1,
      observationType: 'HISTORY_CHECKPOINT_OBSERVATION',
      checkpointId: requiredString(input.checkpointId, 'checkpointId'),
      expectedVersion: safeInteger(input.expectedVersion, 'expectedVersion'),
      outcome: requiredString(input.outcome, 'outcome', 64),
      segmentReference: optionalString(input.segmentReference, 'segmentReference'),
      cursorReference: optionalString(input.cursorReference, 'cursorReference'),
      highWatermarkReference: optionalString(input.highWatermarkReference, 'highWatermarkReference'),
      gapClosed: input.gapClosed === true,
      evidenceReference: requiredString(input.evidenceReference, 'evidenceReference')
    });
    const sequence = Number(store.db.prepare(
      'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM durable_execution_checkpoints WHERE execution_id=?'
    ).get(claim.executionId)?.sequence || 1);
    const checkpointId = this.idFactory('history-observation');
    const snapshotJson = canonicalSerialize(observation);
    const snapshotSha256 = canonicalHash(observation);
    store.db.prepare(`INSERT INTO durable_execution_checkpoints(
      checkpoint_id,execution_id,sequence,state,state_version,generation,owner_id,claim_id,
      host_generation,fencing_token,snapshot_json,snapshot_sha256,authority_timestamp,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      checkpointId,
      claim.executionId,
      sequence,
      observation.outcome,
      claim.stateVersion,
      claim.generation,
      claim.ownerId,
      claim.claimId,
      claim.hostGeneration,
      claim.fencingToken,
      snapshotJson,
      snapshotSha256,
      authorityTimestamp,
      authorityTimestamp
    );
    return Object.freeze({ checkpointId, executionId: claim.executionId, sequence, snapshotSha256 });
  }

  advanceHistoryCheckpoint(input = {}, store = this.store()) {
    const claim = historyExecutionClaim(input);
    const checkpoint = Object.freeze({
      checkpointId: requiredString(input.checkpointId, 'checkpointId'),
      platform: requiredString(input.platform, 'platform', 64).toLowerCase(),
      sourceAccountId: requiredString(input.sourceAccountId, 'sourceAccountId'),
      streamKind: requiredString(input.streamKind, 'streamKind', 64).toLowerCase(),
      externalConversationId: requiredString(input.externalConversationId, 'externalConversationId'),
      expectedVersion: safeInteger(input.expectedVersion, 'expectedVersion'),
      cursorReference: optionalString(input.cursorReference, 'cursorReference'),
      highWatermarkReference: optionalString(input.highWatermarkReference, 'highWatermarkReference'),
      gapClosed: input.gapClosed === true,
      authorityTimestamp: normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp')
    });
    this.assertAccount(checkpoint.platform, checkpoint.sourceAccountId, store);
    const statePlaceholders = claim.allowedStates.map(() => '?').join(',');
    const executionGuard = `EXISTS(
      SELECT 1 FROM durable_executions execution
      WHERE execution.execution_id=?
        AND execution.state_version=?
        AND execution.generation=?
        AND execution.owner_id=?
        AND execution.claim_id=?
        AND execution.host_generation=?
        AND execution.fencing_token=?
        AND execution.lease_expires_at>=?
        AND execution.state IN (${statePlaceholders})
        AND EXISTS(
          SELECT 1 FROM authority_write_host_lease host
          WHERE host.singleton_id=1
            AND host.owner_instance_id=?
            AND host.host_generation=?
            AND host.fencing_token=?
            AND host.state='ACTIVE'
        )
    )`;
    const guardValues = [
      claim.executionId,
      claim.stateVersion,
      claim.generation,
      claim.ownerId,
      claim.claimId,
      claim.hostGeneration,
      claim.fencingToken,
      checkpoint.authorityTimestamp,
      ...claim.allowedStates,
      claim.hostId,
      claim.hostGeneration,
      claim.fencingToken
    ];
    let result;
    if (checkpoint.expectedVersion === 0) {
      result = store.db.prepare(`INSERT INTO communication_sync_checkpoints(
        checkpoint_id,platform,source_account_id,stream_kind,external_conversation_id,
        version,cursor,high_watermark,gap_closed,updated_at
      ) SELECT ?,?,?,?,?,1,?,?,?,?
        WHERE NOT EXISTS(
          SELECT 1 FROM communication_sync_checkpoints
          WHERE platform=? AND source_account_id=? AND stream_kind=? AND external_conversation_id=?
        ) AND ${executionGuard}`).run(
        checkpoint.checkpointId,
        checkpoint.platform,
        checkpoint.sourceAccountId,
        checkpoint.streamKind,
        checkpoint.externalConversationId,
        checkpoint.cursorReference,
        checkpoint.highWatermarkReference,
        checkpoint.gapClosed ? 1 : 0,
        checkpoint.authorityTimestamp,
        checkpoint.platform,
        checkpoint.sourceAccountId,
        checkpoint.streamKind,
        checkpoint.externalConversationId,
        ...guardValues
      );
    } else {
      result = store.db.prepare(`UPDATE communication_sync_checkpoints SET
        version=version+1,cursor=?,high_watermark=?,gap_closed=?,updated_at=?
        WHERE checkpoint_id=? AND platform=? AND source_account_id=?
          AND stream_kind=? AND external_conversation_id=? AND version=?
          AND ${executionGuard}`).run(
        checkpoint.cursorReference,
        checkpoint.highWatermarkReference,
        checkpoint.gapClosed ? 1 : 0,
        checkpoint.authorityTimestamp,
        checkpoint.checkpointId,
        checkpoint.platform,
        checkpoint.sourceAccountId,
        checkpoint.streamKind,
        checkpoint.externalConversationId,
        checkpoint.expectedVersion,
        ...guardValues
      );
    }
    if (Number(result.changes || 0) !== 1) {
      throw historyAuthorityError(
        'WP_B_HISTORY_CHECKPOINT_CAS_REJECTED',
        'History checkpoint CAS rejected stale ownership, version, lease, generation or fencing facts',
        {
          checkpointId: checkpoint.checkpointId,
          executionId: claim.executionId,
          expectedVersion: checkpoint.expectedVersion,
          stateVersion: claim.stateVersion,
          generation: claim.generation,
          claimId: claim.claimId,
          hostGeneration: claim.hostGeneration,
          fencingToken: claim.fencingToken
        }
      );
    }
    return this.getSyncCheckpoint({
      platform: checkpoint.platform,
      sourceAccountId: checkpoint.sourceAccountId,
      streamKind: checkpoint.streamKind,
      externalConversationId: checkpoint.externalConversationId
    });
  }

  applyHistoryCheckpointObservation(input = {}) {
    const claim = historyExecutionClaim(input.executionClaim);
    const checkpoint = checkpointFacts(input.checkpoint);
    const observation = observationFacts(input.observation);
    const authorityTimestamp = normalizedTimestamp(
      this.issueTimestamp('history-checkpoint-observation'),
      'history-checkpoint-observation'
    );
    const capability = this.historyCheckpointCapability();
    for (const method of ['transaction', 'recordObservation', 'advanceCheckpoint']) {
      if (typeof capability?.[method] !== 'function') {
        throw new TypeError(`History checkpoint transaction capability requires ${method}`);
      }
    }
    return capability.transaction(() => {
      capability.recordObservation({
        ...claim,
        checkpointId: checkpoint.checkpointId,
        expectedVersion: checkpoint.expectedVersion,
        ...observation,
        authorityTimestamp
      });
      if (observation.outcome === 'REMOTE_RESULT_UNKNOWN') {
        return Object.freeze({
          state: 'REMOTE_RESULT_UNKNOWN',
          checkpointAdvanced: false,
          retryAllowed: false,
          terminal: false
        });
      }
      const advanced = capability.advanceCheckpoint({
        ...claim,
        ...checkpoint,
        cursorReference: observation.cursorReference,
        highWatermarkReference: observation.highWatermarkReference,
        gapClosed: observation.gapClosed,
        authorityTimestamp
      });
      return Object.freeze({
        state: observation.gapClosed ? 'GAP_CLOSED' : 'SEGMENT_COMMITTED',
        checkpoint: advanced,
        checkpointAdvanced: true,
        nextSegmentRequired: observation.gapClosed !== true,
        retryAllowed: false,
        terminal: observation.gapClosed === true
      });
    });
  }
}

const communicationAuthority = new CommunicationAuthority();
module.exports = communicationAuthority;
module.exports.CommunicationAuthority = CommunicationAuthority;
module.exports.AUTHORITY = core.AUTHORITY;
module.exports.SCHEMA_VERSION = core.SCHEMA_VERSION;
module.exports.normalizeContent = core.normalizeContent;
module.exports.renderProjection = core.renderProjection;
module.exports.historyAuthorityError = historyAuthorityError;
module.exports.historyExecutionClaim = historyExecutionClaim;
