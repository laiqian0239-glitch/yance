'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const repository = require('../repositories/syncCheckpointRepository');
const communicationAuthority = require('./communicationAuthority');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');

function clean(value) { return String(value == null ? '' : value).trim(); }
function syncError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function checkpointId(platform, accountId, scopeId) {
  return `legacy-sync:${crypto.createHash('sha256').update(`${clean(platform).toLowerCase()}\n${clean(accountId)}\n${clean(scopeId)}`).digest('hex')}`;
}
function evidenceReference(context, batchId, outcome) {
  return `sync-observation:${clean(context.executionId || context.operationId)}:${clean(batchId)}:${clean(outcome).toLowerCase()}`;
}
function batchIdForVersion(version) { return `sync-v${Number(version)}-${crypto.randomUUID()}`; }
function batchExpectedVersion(value) {
  const match = /^sync-v(\d+)-/u.exec(clean(value));
  if (!match) throw syncError('WP_B_SYNC_CHECKPOINT_BATCH_VERSION_REQUIRED', 'Sync batch id must carry the checkpoint version observed at begin');
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 0) throw syncError('WP_B_SYNC_CHECKPOINT_BATCH_VERSION_INVALID', 'Sync batch version is invalid');
  return version;
}

class SyncCheckpointService {
  constructor({
    checkpointRepository = repository,
    authority = communicationAuthority,
    lifecycleProvider = currentRuntimeInternalOperationAuthority,
    contextStorage = new AsyncLocalStorage()
  } = {}) {
    this.repository = checkpointRepository;
    this.authority = authority;
    this.lifecycleProvider = lifecycleProvider;
    this.contextStorage = contextStorage;
  }

  withPhysicalOperationContext(context, work) {
    if (typeof work !== 'function') throw new TypeError('Sync checkpoint context work must be a function');
    return this.contextStorage.run(context || null, work);
  }

  currentPhysicalOperationContext() {
    return this.contextStorage.getStore() || null;
  }

  executionClaim(platform, accountId) {
    const context = this.currentPhysicalOperationContext();
    if (!context || !Object.isFrozen(context)) {
      throw syncError('WP_B_SYNC_CHECKPOINT_OPERATION_CONTEXT_REQUIRED', 'History checkpoint mutation requires one frozen persisted operation context');
    }
    if (clean(context.platform).toLowerCase() !== clean(platform).toLowerCase() || clean(context.accountId) !== clean(accountId)) {
      throw syncError('WP_B_SYNC_CHECKPOINT_OPERATION_SCOPE_MISMATCH', 'History checkpoint operation context scope mismatch', {
        expectedPlatform: clean(platform).toLowerCase(), expectedAccountId: clean(accountId)
      });
    }
    if (!['HISTORY_SYNCHRONIZATION', 'SESSION_RESTORE'].includes(clean(context.operationKind))) {
      throw syncError('WP_B_SYNC_CHECKPOINT_OPERATION_KIND_INVALID', 'History checkpoint mutation requires HISTORY_SYNCHRONIZATION or SESSION_RESTORE persisted authority');
    }
    const lifecycle = this.lifecycleProvider();
    const operationId = clean(context.operationId || context.executionId);
    const operation = lifecycle?.read?.(operationId);
    if (!operation || clean(operation.state) !== 'RUNNING') {
      throw syncError('WP_B_SYNC_CHECKPOINT_OPERATION_NOT_RUNNING', 'History checkpoint mutation requires a persisted RUNNING operation', { operationId });
    }
    for (const [field, expected] of [
      ['executionId', context.executionId], ['generation', context.generation], ['ownerId', context.ownerId],
      ['claimId', context.claimId], ['hostGeneration', context.hostGeneration], ['fencingToken', context.fencingToken]
    ]) {
      if (String(operation[field] ?? '') !== String(expected ?? '')) {
        throw syncError('WP_B_SYNC_CHECKPOINT_OPERATION_CLAIM_STALE', 'History checkpoint persisted claim no longer matches the physical operation context', { field, operationId });
      }
    }
    return Object.freeze({
      executionId: clean(operation.executionId),
      stateVersion: Number(operation.stateVersion),
      generation: Number(operation.generation),
      ownerId: clean(operation.ownerId),
      claimId: clean(operation.claimId),
      hostId: clean(operation.ownerId),
      hostGeneration: Number(operation.hostGeneration),
      fencingToken: Number(operation.fencingToken),
      allowedStates: Object.freeze(['RUNNING'])
    });
  }

  canonicalRead(platform, accountId, scopeId = '') {
    const normalizedPlatform = clean(platform).toLowerCase();
    const sourceAccountId = clean(accountId);
    const externalConversationId = clean(scopeId) || 'all';
    const row = this.authority.getSyncCheckpoint?.({
      platform: normalizedPlatform,
      sourceAccountId,
      streamKind: 'messages',
      externalConversationId
    });
    if (!row || Number(row.version || 0) < 1) return null;
    return {
      platform: normalizedPlatform,
      accountId: sourceAccountId,
      scopeId: externalConversationId,
      cursor: clean(row.cursor),
      remoteMessageId: clean(row.cursor),
      remoteTimestamp: clean(row.highWatermark),
      batchId: '',
      phase: 'committed',
      payload: Object.freeze({ canonicalCheckpointId: clean(row.checkpointId), version: Number(row.version), gapClosed: row.gapClosed === true }),
      committedAt: clean(row.updatedAt),
      updatedAt: clean(row.updatedAt),
      version: Number(row.version),
      canonical: true
    };
  }

  read(platform, accountId, scopeId = '') {
    return this.canonicalRead(platform, accountId, scopeId)
      || this.repository.read(platform, accountId, scopeId);
  }

  begin({ platform, accountId, scopeId = '', cursor = '', payload = {} } = {}) {
    const claim = this.executionClaim(platform, accountId);
    const previous = this.read(platform, accountId, scopeId);
    const expectedVersion = Number(previous?.canonical === true ? previous.version : 0);
    const id = batchIdForVersion(expectedVersion);
    return Object.freeze({
      batchId: id,
      startedAt: new Date().toISOString(),
      previous,
      expectedVersion,
      checkpointId: clean(previous?.payload?.canonicalCheckpointId) || checkpointId(platform, accountId, scopeId),
      cursor: clean(cursor || previous?.cursor),
      payload: Object.freeze({ ...(payload || {}) }),
      executionId: claim.executionId
    });
  }

  commit({ platform, accountId, scopeId = '', batchId = '', cursor = '', remoteMessageId = '', remoteTimestamp = '', payload = {}, expectedVersion, checkpointId: requestedCheckpointId } = {}) {
    const claim = this.executionClaim(platform, accountId);
    const previous = this.canonicalRead(platform, accountId, scopeId);
    const version = expectedVersion == null ? batchExpectedVersion(batchId) : Number(expectedVersion);
    const id = clean(requestedCheckpointId) || clean(previous?.payload?.canonicalCheckpointId) || checkpointId(platform, accountId, scopeId);
    const cursorReference = clean(cursor || remoteMessageId || previous?.cursor);
    const observation = this.authority.applyHistoryCheckpointObservation({
      executionClaim: claim,
      checkpoint: Object.freeze({
        checkpointId: id,
        platform: clean(platform).toLowerCase(),
        sourceAccountId: clean(accountId),
        streamKind: 'messages',
        externalConversationId: clean(scopeId) || 'all',
        expectedVersion: version
      }),
      observation: Object.freeze({
        outcome: 'PAGE_OBSERVED',
        segmentReference: clean(batchId) || `segment:${claim.executionId}:${version + 1}`,
        cursorReference,
        highWatermarkReference: clean(remoteTimestamp),
        gapClosed: true,
        evidenceReference: evidenceReference(claim, batchId || `${version + 1}`, 'PAGE_OBSERVED')
      })
    });
    const row = this.canonicalRead(platform, accountId, scopeId);
    return Object.freeze({ ...(row || {}), payload: Object.freeze({ ...(row?.payload || {}), ...(payload || {}), checkpointAdvanced: observation.checkpointAdvanced === true }) });
  }

  fail({ platform, accountId, scopeId = '', batchId = '', error = '', payload = {}, expectedVersion, checkpointId: requestedCheckpointId } = {}) {
    const claim = this.executionClaim(platform, accountId);
    const previous = this.canonicalRead(platform, accountId, scopeId);
    const version = expectedVersion == null ? batchExpectedVersion(batchId) : Number(expectedVersion);
    const id = clean(requestedCheckpointId) || clean(previous?.payload?.canonicalCheckpointId) || checkpointId(platform, accountId, scopeId);
    const observation = this.authority.applyHistoryCheckpointObservation({
      executionClaim: claim,
      checkpoint: Object.freeze({
        checkpointId: id,
        platform: clean(platform).toLowerCase(),
        sourceAccountId: clean(accountId),
        streamKind: 'messages',
        externalConversationId: clean(scopeId) || 'all',
        expectedVersion: version
      }),
      observation: Object.freeze({
        outcome: 'REMOTE_RESULT_UNKNOWN',
        segmentReference: clean(batchId) || `segment:${claim.executionId}:${version + 1}`,
        cursorReference: clean(previous?.cursor),
        highWatermarkReference: clean(previous?.remoteTimestamp),
        gapClosed: false,
        evidenceReference: evidenceReference(claim, batchId || `${version + 1}`, 'REMOTE_RESULT_UNKNOWN')
      })
    });
    return Object.freeze({
      ...(this.read(platform, accountId, scopeId) || {}),
      phase: 'interrupted',
      payload: Object.freeze({ ...(payload || {}), error: clean(error), checkpointAdvanced: observation.checkpointAdvanced === true, outcome: observation.state })
    });
  }

  claimRemoteMessage(input, store) { return this.repository.claimRemoteMessage(input, store); }
  releaseRemoteMessage(input, store) { return this.repository.releaseRemoteMessage(input, store); }
  receiptRemoteKey(...args) { return this.repository.receiptRemoteKey(...args); }
  recoverInterrupted(store) { return this.repository.recoverInterrupted(store); }
}

const singleton = new SyncCheckpointService();
module.exports = singleton;
module.exports.SyncCheckpointService = SyncCheckpointService;
