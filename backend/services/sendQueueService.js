'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config');
const queueRepository = require('../repositories/sendQueueRepository');
const { getAuthorityReadSnapshot } = require('../repositories/storeProvider');
const { stableId, parseJson } = require('../lib/r32SqliteStore');
const { deepFreeze } = require('../lib/deepFreeze');
const sendMessageService = require('./sendMessageService');
const mediaPipeline = require('./mediaPipeline');
const { validateStickerInput } = require('./mediaSendPolicy');
const eventBus = require('./eventBus');
const outboundTranslationAuthority = require('./outboundTranslationAuthority');
const sendPolicyAuthorityModule = require('./sendPolicyAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const communicationAuthority = require('./communicationAuthority');
const { ExternalActionDispatcher } = require('./externalActionDispatcher');
const { OPERATION_KINDS } = require('./durableOperationRegistry');

const QUEUE_MEDIA_ROOT = path.join(PATHS.tmp, 'send-queue');
const DURABLE_TERMINAL = new Set(['sent', 'failed', 'cancelled', 'send_outcome_unknown']);
const OUTCOME_UNKNOWN_BLOCK_REASON = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function nowIso() { return new Date().toISOString(); }
function leaseExpiry(start, milliseconds = 120_000) { return new Date(Date.parse(start) + milliseconds).toISOString(); }
function ensureRoot() { fs.mkdirSync(QUEUE_MEDIA_ROOT, { recursive: true }); }
function safeQueuePath(file) {
  const resolved = path.resolve(file || ''); const base = path.resolve(QUEUE_MEDIA_ROOT) + path.sep;
  if (!resolved.startsWith(base)) throw Object.assign(new Error('发送队列媒体路径无效'), { code: 'QUEUE_MEDIA_PATH_INVALID' });
  return resolved;
}
function safeIncomingMediaPath(file) {
  const resolved = path.resolve(file || ''); const base = path.resolve(PATHS.tmp) + path.sep;
  if (!resolved.startsWith(base)) throw Object.assign(new Error('上传媒体临时路径无效'), { code: 'QUEUE_MEDIA_PATH_INVALID' });
  return resolved;
}
function rowPayload(row) { return row?.payload || parseJson(row?.payload_json, {}) || {}; }
function durableState(claimState, fallback = 'queued') {
  switch (clean(claimState).toUpperCase()) {
    case 'COMPLETED': return 'sent';
    case 'FAILED': return 'failed';
    case 'UNCERTAIN': return 'send_outcome_unknown';
    case 'CLAIMED':
    case 'ATTEMPTED': return 'sending';
    case 'READY': return 'queued';
    default: return fallback || 'queued';
  }
}
function publicQueueRow(row, intent = null) {
  if (!row) return null; const payload = rowPayload(row); const state = durableState(intent?.claim?.state, row.state);
  return {
    id: row.id, idempotencyKey: row.idempotency_key, accountId: row.account_id, sessionKey: row.session_key,
    platform: clean(payload.platform, 'whatsapp'), messageType: row.message_type, state,
    outboxId: clean(row.outbox_id), outboxRouteId: clean(row.outbox_route_id), capabilitySnapshotId: clean(row.capability_snapshot_id),
    qualityTier: clean(row.quality_tier), emergencyMode: Number(row.emergency_mode || 0) === 1,
    sendPolicy: parseJson(row.send_policy_json, {}) || {}, attempts: Number(row.attempts || 0),
    nextAttemptAt: '', lastError: clean(row.last_error), platformMessageId: clean(row.platform_message_id),
    unknownScope: state === 'send_outcome_unknown' ? 'command' : '', unknownReason: state === 'send_outcome_unknown' ? 'DURABLE_OUTBOX_UNCERTAIN' : '',
    unknownLane: '', executionGeneration: '', unknownRecordedAt: '', createdAt: row.created_at, updatedAt: row.updated_at,
    durableIntentId: clean(intent?.intentId), durableExecutionId: clean(intent?.executionId), durableState: clean(intent?.claim?.state)
  };
}
function retiredOperation(name) {
  const error = new Error(`Legacy send-queue ${name} is retired; durable recovery/reconciliation authority owns this transition`);
  error.code = 'SEND_QUEUE_LEGACY_MUTATION_RETIRED';
  error.reasonCode = 'WP_B_DURABLE_RECOVERY_AUTHORITY_REQUIRED';
  error.operation = name;
  error.status = 409;
  return error;
}

class SendQueueService {
  constructor(options = {}) {
    this.outboundTranslationAuthority = options.outboundTranslationAuthority || outboundTranslationAuthority;
    this.sendPolicyAuthority = options.sendPolicyAuthority || sendPolicyAuthorityModule.singleton;
    this.communicationAuthority = options.communicationAuthority || communicationAuthority;
    this.authorityTokenProvider = options.authorityTokenProvider || (() => getAuthorityReadSnapshot().authorityWriteHost || null);
    this.durableRuntimeFactory = options.durableRuntimeFactory || null;
    this.durableRuntimeInstance = options.durableRuntime || null;
    this.started = false;
    this.pausedReason = '';
    ensureRoot();
  }

  start() {
    if (this.started) return { started: true };
    this.started = true;
    eventBus.publish('send-queue:started', { authority: 'DurableExecutionAuthorityV2', at: nowIso() });
    return { started: true };
  }

  stop() {
    if (!this.started) return { started: false };
    this.started = false;
    eventBus.publish('send-queue:stopped', { authority: 'DurableExecutionAuthorityV2', at: nowIso() });
    return { started: false };
  }

  durableRuntime() {
    if (this.durableRuntimeInstance) return this.durableRuntimeInstance;
    if (this.durableRuntimeFactory) {
      this.durableRuntimeInstance = this.durableRuntimeFactory();
      return this.durableRuntimeInstance;
    }
    // Lazy to avoid the AppRuntimeComposition -> sendQueueService module cycle.
    const { createProductionDurableOperationRuntime } = require('../runtime/AppRuntimeComposition');
    const { getSecurityGuard } = require('../core/securityGuardSingleton');
    this.durableRuntimeInstance = createProductionDurableOperationRuntime({ securityGuard: getSecurityGuard() });
    return this.durableRuntimeInstance;
  }

  authorityToken() {
    const token = this.authorityTokenProvider();
    if (!token?.instanceId || !Number(token.hostGeneration) || !Number(token.fencingToken)) {
      const error = new Error('Outbound durable execution requires the current AuthorityWriteHost token');
      error.code = 'SEND_QUEUE_AUTHORITY_WRITE_HOST_REQUIRED';
      error.status = 503;
      throw error;
    }
    return token;
  }

  intentFor(row) {
    const intentId = clean(row?.outbox_id || row?.id);
    if (!intentId) return null;
    try { return this.communicationAuthority.outboxAuthority.intent(intentId); }
    catch (_) { return null; }
  }

  projectRow(row) { return publicQueueRow(row, this.intentFor(row)); }

  status(options = {}) {
    let rows = [];
    let statusError = null;
    try { rows = queueRepository.list({ limit: 1000 }); }
    catch (error) { statusError = { code: clean(error?.code || error?.name), message: error?.message || String(error) }; }
    const projected = rows.map(row => this.projectRow(row));
    const unknown = projected.filter(row => row?.state === 'send_outcome_unknown');
    const globalUnknown = unknown.filter(row => !clean(row?.accountId));
    const accountUnknown = unknown.filter(row => clean(row?.accountId));
    const requestedAccountId = clean(options.accountId || options.account_id);
    const scopedUnknown = requestedAccountId
      ? accountUnknown.filter(row => clean(row.accountId) === requestedAccountId)
      : accountUnknown;
    const pending = projected.filter(row => row && !DURABLE_TERMINAL.has(row.state));
    return {
      started: this.started,
      running: false,
      paused: Boolean(this.pausedReason),
      pausedReason: this.pausedReason,
      outcomeUnknown: unknown.length,
      globalOutcomeUnknown: globalUnknown.length,
      accountOutcomeUnknown: scopedUnknown.length,
      commandOutcomeUnknown: unknown.length,
      outcomeUnknownItems: unknown,
      outcomeUnknownItemsTruncated: false,
      resumeBlocked: globalUnknown.length > 0,
      writeBlocked: Boolean(this.pausedReason) || globalUnknown.length > 0 || Boolean(statusError),
      scopedWriteBlocked: scopedUnknown.length > 0,
      statusError,
      pending: pending.length
    };
  }

  pause(reason = 'paused') {
    this.pausedReason = clean(reason, 'paused');
    eventBus.publish('send-queue:paused', { reason: this.pausedReason, at: nowIso() });
    return this.status();
  }

  resume(reason = 'resumed') {
    const snapshot = this.status();
    if (snapshot.globalOutcomeUnknown > 0) {
      this.pausedReason = OUTCOME_UNKNOWN_BLOCK_REASON;
      eventBus.publish('send-queue:resume-blocked', { reason, unresolvedOutcomeUnknown: snapshot.globalOutcomeUnknown, at: nowIso() });
      return this.status();
    }
    const previous = this.pausedReason;
    this.pausedReason = '';
    eventBus.publish('send-queue:resumed', { reason, previous, at: nowIso() });
    return this.status();
  }

  assertEnqueueAllowed(operation = 'send', input = {}) {
    const accountId = clean(input.accountId || input.account_id);
    const snapshot = this.status({ accountId });
    if (!snapshot.writeBlocked && !snapshot.scopedWriteBlocked) return true;
    const outcomeBlocked = snapshot.globalOutcomeUnknown > 0 || snapshot.accountOutcomeUnknown > 0;
    const error = new Error(`Durable outbound authority is not accepting new commands: ${operation}`);
    error.code = outcomeBlocked ? 'SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED' : 'SEND_QUEUE_STATUS_UNAVAILABLE_WRITE_BLOCKED';
    error.status = 423;
    error.reasonCode = outcomeBlocked ? OUTCOME_UNKNOWN_BLOCK_REASON : clean(this.pausedReason, 'SEND_QUEUE_STATUS_UNAVAILABLE');
    error.accountId = accountId;
    error.outcomeUnknown = snapshot.globalOutcomeUnknown + snapshot.accountOutcomeUnknown;
    throw error;
  }

  platformFor(input = {}) { return sendMessageService.resolveAccount(input.accountId, input.platform, input.chatJid).platform; }

  durableRequest(row, command) {
    const payload = rowPayload(row);
    const resolved = sendMessageService.resolveAccount(row.account_id, payload.platform, payload.chatJid);
    const credentialReference = clean(resolved?.account?.credentialRef);
    if (!credentialReference) {
      const error = new Error('Outbound durable operation requires an account credential reference');
      error.code = 'SEND_QUEUE_CREDENTIAL_REFERENCE_REQUIRED';
      error.status = 409;
      throw error;
    }
    return deepFreeze({
      platform: clean(payload.platform || resolved.platform).toLowerCase(),
      accountReference: clean(row.account_id || resolved.accountId),
      commandReference: clean(row.id),
      credentialReference,
      requestContentSha256: clean(command?.commandSha256)
    });
  }

  async dispatchDurableQueueItem(row) {
    const payload = rowPayload(row);
    const command = payload.outboxCommand || null;
    this.sendPolicyAuthority.verifyFrozenCommand(command);
    const request = this.durableRequest(row, command);
    const authority = this.communicationAuthority.durableExecutionAuthority;
    const outbox = this.communicationAuthority.outboxAuthority;
    const operationKind = OPERATION_KINDS.OUTBOUND_MESSAGE_SEND;
    const token = this.authorityToken();
    const ownerId = `outbound-dispatch:${process.pid}`;
    const hostId = token.instanceId;
    const executionId = stableId('wpb-outbound-execution', [row.id]);
    const intentId = clean(row.outbox_id || row.id);
    const idempotencyKey = clean(row.idempotency_key || row.id);
    let execution = authority.createExecution({
      executionId,
      operationKind,
      idempotencyKey,
      command: request,
      maxAttempts: 1,
      authorityTimestamp: nowIso()
    });
    let intent = outbox.createIntent({
      intentId,
      executionId,
      actionKind: operationKind,
      idempotencyKey,
      payload: request,
      authorityTimestamp: nowIso()
    });
    const existingState = clean(intent?.claim?.state).toUpperCase();
    if (['COMPLETED', 'FAILED', 'UNCERTAIN'].includes(existingState)) return this.projectRow(row);
    if (existingState !== 'READY') return this.projectRow(row);
    if (execution.state === 'CREATED') {
      execution = authority.schedule({
        executionId,
        expectedStateVersion: execution.stateVersion,
        generation: execution.generation,
        hostId,
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken,
        operationKind,
        authorityTimestamp: nowIso()
      });
    }
    if (execution.state !== 'SCHEDULED') return this.projectRow(row);
    const claimId = `outbound-claim-${crypto.randomUUID()}`;
    const leaseStartedAt = nowIso();
    const leaseExpiresAt = leaseExpiry(leaseStartedAt);
    execution = authority.claim({
      executionId,
      expectedStateVersion: execution.stateVersion,
      generation: execution.generation,
      ownerId,
      claimId,
      hostId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      leaseStartedAt,
      leaseExpiresAt,
      reasonCode: 'OUTBOUND_COMMAND_READY'
    });
    intent = outbox.claimIntent({
      intentId,
      stateVersion: intent.claim.stateVersion,
      generation: intent.claim.generation,
      ownerId,
      claimId,
      hostId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      leaseStartedAt,
      leaseExpiresAt
    });
    const adapter = this.durableRuntime().registry.require(operationKind);
    const dispatcher = new ExternalActionDispatcher({ outboxAuthority: outbox, adapter, issueTimestamp: () => nowIso() });
    const receipt = await dispatcher.dispatch({
      executionId,
      intentId,
      idempotencyKey,
      ownerId,
      claimId,
      hostId,
      stateVersion: intent.claim.stateVersion,
      generation: intent.claim.generation,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      leaseExpiresAt,
      request
    });
    const receiptType = clean(receipt?.receiptType).toUpperCase();
    const targetState = receiptType === 'SUCCESS' ? 'SUCCEEDED' : receiptType === 'UNKNOWN' ? 'UNCERTAIN' : 'FAILED';
    authority.transition({
      executionId,
      allowedStates: ['CLAIMED'],
      targetState,
      expectedStateVersion: execution.stateVersion,
      generation: execution.generation,
      ownerId,
      claimId,
      hostId,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      authorityTimestamp: nowIso(),
      eventType: 'external_action_receipt',
      reasonCode: `OUTBOX_${receiptType || 'FAILURE'}`,
      payload: { intentId, receiptId: clean(receipt?.receiptId), receiptType }
    });
    const projected = this.projectRow(row);
    const event = receiptType === 'SUCCESS' ? 'send-queue:sent' : receiptType === 'UNKNOWN' ? 'send-queue:outcome-unknown' : 'send-queue:failed';
    eventBus.publish(event, { queue: projected, receipt });
    return projected;
  }

  async enqueueText(input = {}) {
    this.assertEnqueueAllowed('text', input);
    const accountId = clean(input.accountId), chatJid = clean(input.chatJid), rawText = clean(input.text);
    if (!accountId || !chatJid) throw Object.assign(new Error('发送账号或目标会话缺失'), { code: 'INVALID_CHAT_TARGET', status: 400 });
    if (!rawText) throw Object.assign(new Error('消息内容为空'), { code: 'MESSAGE_TEXT_EMPTY', status: 400 });
    const platform = this.platformFor(input), idempotencyKey = clean(input.idempotencyKey) || crypto.randomUUID(), id = stableId('send', [idempotencyKey]);
    const sessionKey = clean(input.sessionKey) || `${accountId}:${chatJid}`;
    const prepared = await this.outboundTranslationAuthority.prepare({ ...input, platform, accountId, chatJid, sessionKey, text: rawText, idempotencyKey });
    const text = clean(prepared.text);
    if (!text) throw Object.assign(new Error('外发内容为空'), { code: 'MESSAGE_TEXT_EMPTY', status: 400 });
    const translation = prepared.translationApplied === true ? {
      originalComposerText: clean(prepared.originalComposerText), translatedZh: clean(prepared.translatedZh),
      sourceText: clean(prepared.sourceText || text), sourceLanguage: clean(prepared.sourceLanguage),
      translationStatus: clean(prepared.translationStatus), translationModel: clean(prepared.translationModel),
      translatedAt: clean(prepared.translatedAt), translationSourceHash: clean(prepared.translationSourceHash),
      translationTargetLanguage: clean(prepared.translationTargetLanguage || prepared.targetLanguageCode),
      targetLanguage: clean(prepared.targetLanguage), targetLanguageCode: clean(prepared.targetLanguageCode),
      languageAuthority: prepared.languageAuthority || {}, languageValidation: prepared.languageValidation || {}
    } : {};
    const frozen = this.sendPolicyAuthority.freezeOutboxCommand({
      ...input, platform, accountId, sessionKey, chatJid, idempotencyKey, commandId: id, operation: 'text', messageType: 'text', finalText: text,
      targetLanguage: clean(prepared.targetLanguageCode || prepared.targetLanguage),
      replyReference: input.quoted || null,
      replySource: clean(input.replySource),
      replyTask: clean(input.replyTask),
      modelId: clean(input.modelId),
      modelBrainExecutionEvidence: input.modelBrainExecutionEvidence || {},
      qualityTier: clean(input.qualityTier || input.qualityRouteReceipt?.qualityTier),
      emergencyMode: input.emergencyMode === true || input.qualityRouteReceipt?.emergencyMode === true,
      learningEligible: input.learningEligible !== false && input.qualityRouteReceipt?.learningEligible !== false,
      qualityRouteReceipt: input.qualityRouteReceipt || {}
    });
    const payload = { platform, operation: 'text', accountId, chatJid, text, quoted: input.quoted || null, translation, outboxCommand: frozen.command };
    const created = outboundCommandRepository.createAtomic({
      route: { platform, accountId, conversationId: sessionKey, routeTarget: chatJid, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, source: 'send-queue-enqueue' },
      queue: { id, idempotencyKey, accountId, sessionKey, messageType: 'text', payload, outboxId: frozen.queueMetadata.outboxId, sendPolicy: frozen.queueMetadata.sendPolicy, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, qualityTier: frozen.queueMetadata.qualityTier, emergencyMode: frozen.queueMetadata.emergencyMode },
      message: { id, dedupeKey: id, externalMessageId: id, accountId, conversationId: sessionKey, sessionKey, chatJid, platform, direction: 'outbound', fromMe: true, type: 'text', text, ...translation, quotedMessageId: clean(input.quoted?.key?.id || input.quoted?.quotedMessageId) }
    });
    const routedRow = created.queue;
    if (created.message) eventBus.publish('message:inserted', { message: created.message, conversation: created.conversation });
    eventBus.publish('send-queue:enqueued', { queue: this.projectRow(routedRow), translation: prepared.translationApplied === true ? { applied: true, targetLanguageCode: prepared.targetLanguageCode, model: prepared.translationModel } : { applied: false } });
    await this.dispatchDurableQueueItem(routedRow);
    return {
      ...this.projectRow(routedRow),
      translationApplied: prepared.translationApplied === true,
      targetLanguageCode: clean(prepared.targetLanguageCode),
      approvalReceiptId: frozen.queueMetadata.approvalReceiptId,
      finalTextSha256: frozen.queueMetadata.finalTextSha256,
      sendPolicyVersion: frozen.queueMetadata.sendPolicy.policyVersion,
      capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId,
      qualityTier: frozen.queueMetadata.qualityTier,
      emergencyMode: frozen.queueMetadata.emergencyMode,
      learningEligible: frozen.queueMetadata.learningEligible,
      qualityRouteReceipt: frozen.queueMetadata.qualityRouteReceipt,
      modelBrainExecutionEvidence: frozen.queueMetadata.modelBrainExecutionEvidence || {},
      modelBrainEvidenceValid: frozen.queueMetadata.modelBrainEvidenceValid === true,
      modelBrainEvidenceReasonCode: clean(frozen.queueMetadata.modelBrainEvidenceReasonCode),
      modelBrainEvidenceSha256: clean(frozen.queueMetadata.modelBrainEvidenceSha256)
    };
  }

  async enqueueAction(input = {}) {
    this.assertEnqueueAllowed(clean(input.operation, 'action'), input);
    const operation = clean(input.operation).toLowerCase();
    if (!['reaction', 'revoke', 'native_expression'].includes(operation)) {
      throw Object.assign(new Error('不支持的发送队列动作'), { code: 'SEND_QUEUE_ACTION_UNSUPPORTED', status: 400 });
    }
    const accountId = clean(input.accountId), chatJid = clean(input.chatJid || input.recipientId);
    if (!accountId || !chatJid) throw Object.assign(new Error('发送账号或目标会话缺失'), { code: 'INVALID_CHAT_TARGET', status: 400 });
    if (['reaction', 'revoke'].includes(operation) && !clean(input.targetId)) throw Object.assign(new Error('消息动作缺少目标消息'), { code: 'MESSAGE_ACTION_TARGET_REQUIRED', status: 400 });
    if (operation === 'native_expression' && !clean(input.reference || input.sendReference)) throw Object.assign(new Error('Telegram 原生素材缺少发送引用'), { code: 'TELEGRAM_EXPRESSION_REFERENCE_REQUIRED', status: 400 });
    const platform = this.platformFor({ ...input, accountId, chatJid });
    if (operation === 'native_expression' && platform !== 'telegram') throw Object.assign(new Error('原生素材当前只支持 Telegram'), { code: 'PLATFORM_OPERATION_UNSUPPORTED', status: 409 });
    const idempotencyKey = clean(input.idempotencyKey) || crypto.randomUUID();
    const id = stableId('send', [idempotencyKey]);
    const sessionKey = clean(input.sessionKey) || `${accountId}:${chatJid}`;
    let finalText = clean(input.caption);
    let translation = {};
    if (operation === 'native_expression' && finalText) {
      const prepared = await this.outboundTranslationAuthority.prepare({ ...input, platform, accountId, chatJid, sessionKey, text: finalText, idempotencyKey });
      finalText = clean(prepared.text);
      if (prepared.translationApplied === true) translation = {
        originalComposerText: clean(prepared.originalComposerText), translatedZh: clean(prepared.translatedZh),
        sourceText: clean(prepared.sourceText || finalText), sourceLanguage: clean(prepared.sourceLanguage),
        translationStatus: clean(prepared.translationStatus), translationModel: clean(prepared.translationModel),
        targetLanguage: clean(prepared.targetLanguage), targetLanguageCode: clean(prepared.targetLanguageCode)
      };
    }
    const actionPayload = operation === 'reaction'
      ? { targetId: clean(input.targetId), emoji: clean(input.emoji), targetFromMe: input.targetFromMe === true, participant: clean(input.participant) }
      : operation === 'revoke'
        ? { targetId: clean(input.targetId), targetFromMe: input.targetFromMe !== false, participant: clean(input.participant) }
        : { reference: clean(input.reference || input.sendReference), kind: clean(input.kind), caption: finalText };
    const frozen = this.sendPolicyAuthority.freezeOutboxCommand({
      ...input, platform, accountId, sessionKey, chatJid, idempotencyKey, commandId: id, operation,
      messageType: operation === 'native_expression' ? clean(input.kind) : operation, kind: clean(input.kind), finalText,
      targetLanguage: clean(translation.targetLanguageCode || translation.targetLanguage), replyReference: input.quoted || null,
      actionPayload, qualityTier: clean(input.qualityTier || input.qualityRouteReceipt?.qualityTier),
      emergencyMode: input.emergencyMode === true || input.qualityRouteReceipt?.emergencyMode === true,
      learningEligible: input.learningEligible !== false && input.qualityRouteReceipt?.learningEligible !== false,
      qualityRouteReceipt: input.qualityRouteReceipt || {}
    });
    const payload = { platform, operation, accountId, chatJid, actionPayload, caption: finalText, translation, quoted: input.quoted || null, outboxCommand: frozen.command };
    const created = outboundCommandRepository.createAtomic({
      route: { platform, accountId, conversationId: sessionKey, routeTarget: chatJid, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, source: 'send-queue-enqueue' },
      queue: { id, idempotencyKey, accountId, sessionKey, messageType: operation === 'native_expression' ? clean(input.kind) : operation, payload, outboxId: frozen.queueMetadata.outboxId, sendPolicy: frozen.queueMetadata.sendPolicy, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, qualityTier: frozen.queueMetadata.qualityTier, emergencyMode: frozen.queueMetadata.emergencyMode },
      message: operation === 'native_expression' ? { id, dedupeKey: id, externalMessageId: id, accountId, conversationId: sessionKey, sessionKey, chatJid, platform, direction: 'outbound', fromMe: true, type: clean(input.kind) || 'native_expression', text: finalText, ...translation } : null
    });
    const routedRow = created.queue;
    if (created.message) eventBus.publish('message:inserted', { message: created.message, conversation: created.conversation });
    eventBus.publish('send-queue:enqueued', { queue: this.projectRow(routedRow), operation });
    await this.dispatchDurableQueueItem(routedRow);
    return { ...this.projectRow(routedRow), approvalReceiptId: frozen.queueMetadata.approvalReceiptId, finalTextSha256: frozen.queueMetadata.finalTextSha256, sendPolicyVersion: frozen.queueMetadata.sendPolicy.policyVersion, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId };
  }

  async enqueueMedia(input = {}) {
    this.assertEnqueueAllowed('media', input);
    const accountId = clean(input.accountId), chatJid = clean(input.chatJid), buffer = input.buffer;
    if (!accountId || !chatJid) throw Object.assign(new Error('发送账号或目标会话缺失'), { code: 'INVALID_CHAT_TARGET', status: 400 });
    mediaPipeline.verifyBuffer(buffer);
    const idempotencyKey = clean(input.idempotencyKey) || crypto.randomUUID(), id = stableId('send', [idempotencyKey]);
    const platform = this.platformFor({ ...input, accountId, chatJid });
    const sessionKey = clean(input.sessionKey) || `${accountId}:${chatJid}`;
    const rawCaption = clean(input.caption);
    const preparedCaption = rawCaption
      ? await this.outboundTranslationAuthority.prepare({ ...input, platform, accountId, chatJid, sessionKey, text: rawCaption, idempotencyKey })
      : { text: '', translationApplied: false };
    ensureRoot();
    const mediaFile = safeQueuePath(path.join(QUEUE_MEDIA_ROOT, `${id}.bin`)); const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    let createdMediaFile = false;
    if (!fs.existsSync(mediaFile)) { const tmp = `${mediaFile}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, buffer, { flag: 'wx' }); fs.renameSync(tmp, mediaFile); createdMediaFile = true; }
    try {
      return await this.commitMediaQueue({ ...input, platform, sessionKey, preparedCaption, accountId, chatJid, idempotencyKey, id, mediaFile, bytes: buffer.length, digest });
    } catch (error) {
      if (createdMediaFile) { try { fs.rmSync(mediaFile, { force: true }); } catch (_) {} }
      throw error;
    }
  }

  async enqueueMediaFile(input = {}) {
    this.assertEnqueueAllowed('media-file', input);
    const accountId = clean(input.accountId), chatJid = clean(input.chatJid);
    if (!accountId || !chatJid) throw Object.assign(new Error('发送账号或目标会话缺失'), { code: 'INVALID_CHAT_TARGET', status: 400 });
    const sourceFile = safeIncomingMediaPath(input.filePath), verified = mediaPipeline.verifyFile(sourceFile), actualDigest = mediaPipeline.sha256File(sourceFile), digest = clean(input.sha256) || actualDigest;
    if (input.sha256 && digest !== actualDigest) throw Object.assign(new Error('上传媒体校验失败'), { code: 'MEDIA_HASH_MISMATCH', status: 400 });
    const idempotencyKey = clean(input.idempotencyKey) || crypto.randomUUID(), id = stableId('send', [idempotencyKey]);
    const platform = this.platformFor({ ...input, accountId, chatJid });
    const sessionKey = clean(input.sessionKey) || `${accountId}:${chatJid}`;
    const rawCaption = clean(input.caption);
    const preparedCaption = rawCaption
      ? await this.outboundTranslationAuthority.prepare({ ...input, platform, accountId, chatJid, sessionKey, text: rawCaption, idempotencyKey })
      : { text: '', translationApplied: false };
    ensureRoot();
    const mediaFile = safeQueuePath(path.join(QUEUE_MEDIA_ROOT, `${id}.bin`));
    let createdMediaFile = false;
    if (!fs.existsSync(mediaFile)) { try { fs.renameSync(sourceFile, mediaFile); createdMediaFile = true; } catch (error) { if (error.code !== 'EXDEV') throw error; fs.copyFileSync(sourceFile, mediaFile, fs.constants.COPYFILE_EXCL); fs.rmSync(sourceFile, { force: true }); createdMediaFile = true; } }
    else if (path.resolve(sourceFile) !== path.resolve(mediaFile)) fs.rmSync(sourceFile, { force: true });
    try {
      return await this.commitMediaQueue({ ...input, platform, sessionKey, preparedCaption, accountId, chatJid, idempotencyKey, id, mediaFile, bytes: verified.bytes, digest });
    } catch (error) {
      if (createdMediaFile) { try { fs.rmSync(mediaFile, { force: true }); } catch (_) {} }
      throw error;
    }
  }

  async commitMediaQueue(input = {}) {
    const sessionKey = clean(input.sessionKey) || `${input.accountId}:${input.chatJid}`, kind = clean(input.kind, 'document').toLowerCase(), platform = clean(input.platform) || this.platformFor(input);
    const mimeType = clean(input.mimeType, 'application/octet-stream');
    const filename = clean(input.filename, 'file');
    validateStickerInput({ platform, kind, mimeType, filename, filePath: input.mediaFile });
    const rawCaption = clean(input.caption);
    const preparedCaption = input.preparedCaption || (rawCaption ? await this.outboundTranslationAuthority.prepare({ ...input, platform, accountId: input.accountId, chatJid: input.chatJid, sessionKey, text: rawCaption, idempotencyKey: input.idempotencyKey }) : { text: '', translationApplied: false });
    const caption = clean(preparedCaption.text);
    const translation = preparedCaption.translationApplied === true ? {
      originalComposerText: clean(preparedCaption.originalComposerText), translatedZh: clean(preparedCaption.translatedZh),
      sourceText: clean(preparedCaption.sourceText || caption), sourceLanguage: clean(preparedCaption.sourceLanguage),
      translationStatus: clean(preparedCaption.translationStatus), translationModel: clean(preparedCaption.translationModel),
      translatedAt: clean(preparedCaption.translatedAt), translationSourceHash: clean(preparedCaption.translationSourceHash),
      translationTargetLanguage: clean(preparedCaption.translationTargetLanguage || preparedCaption.targetLanguageCode),
      targetLanguage: clean(preparedCaption.targetLanguage), targetLanguageCode: clean(preparedCaption.targetLanguageCode),
      languageAuthority: preparedCaption.languageAuthority || {}, languageValidation: preparedCaption.languageValidation || {}
    } : {};
    const frozen = this.sendPolicyAuthority.freezeOutboxCommand({
      ...input, platform, accountId: input.accountId, sessionKey, chatJid: input.chatJid, idempotencyKey: input.idempotencyKey, commandId: input.id,
      operation: 'media', messageType: kind, kind, finalText: caption,
      targetLanguage: clean(preparedCaption.targetLanguageCode || preparedCaption.targetLanguage),
      mediaReferences: [{ path: input.mediaFile, sha256: input.digest, bytes: Number(input.bytes || 0), mimeType, filename, kind }],
      replyReference: input.quoted || null,
      qualityTier: clean(input.qualityTier || input.qualityRouteReceipt?.qualityTier),
      emergencyMode: input.emergencyMode === true || input.qualityRouteReceipt?.emergencyMode === true,
      learningEligible: input.learningEligible !== false && input.qualityRouteReceipt?.learningEligible !== false,
      qualityRouteReceipt: input.qualityRouteReceipt || {}
    });
    const payload = { platform, operation: 'media', accountId: input.accountId, chatJid: input.chatJid, kind, mediaFile: input.mediaFile, mimeType, filename, caption, quoted: input.quoted || null, bytes: Number(input.bytes || 0), sha256: input.digest, translation, outboxCommand: frozen.command };
    const created = outboundCommandRepository.createAtomic({
      route: { platform, accountId: input.accountId, conversationId: sessionKey, routeTarget: input.chatJid, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, source: 'send-queue-enqueue' },
      queue: { id: input.id, idempotencyKey: input.idempotencyKey, accountId: input.accountId, sessionKey, messageType: kind, payload, outboxId: frozen.queueMetadata.outboxId, sendPolicy: frozen.queueMetadata.sendPolicy, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId, qualityTier: frozen.queueMetadata.qualityTier, emergencyMode: frozen.queueMetadata.emergencyMode },
      message: { id: input.id, dedupeKey: input.id, externalMessageId: input.id, accountId: input.accountId, conversationId: sessionKey, sessionKey, chatJid: input.chatJid, platform, direction: 'outbound', fromMe: true, type: kind, text: caption, ...translation, quotedMessageId: clean(input.quoted?.key?.id || input.quoted?.quotedMessageId), pendingAttachment: { kind, mimeType: payload.mimeType, filename: payload.filename, size: payload.bytes, fileHash: input.digest } }
    });
    const routedRow = created.queue;
    if (created.message) eventBus.publish('message:inserted', { message: created.message, conversation: created.conversation });
    const upload = { bytes: payload.bytes, sha256: input.digest };
    eventBus.publish('send-queue:enqueued', { queue: this.projectRow(routedRow), upload });
    await this.dispatchDurableQueueItem(routedRow);
    return {
      queue: this.projectRow(routedRow), upload,
      approvalReceiptId: frozen.queueMetadata.approvalReceiptId,
      finalTextSha256: frozen.queueMetadata.finalTextSha256,
      sendPolicyVersion: frozen.queueMetadata.sendPolicy.policyVersion,
      capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId,
      qualityTier: frozen.queueMetadata.qualityTier,
      emergencyMode: frozen.queueMetadata.emergencyMode,
      learningEligible: frozen.queueMetadata.learningEligible,
      qualityRouteReceipt: frozen.queueMetadata.qualityRouteReceipt
    };
  }


  list(options = {}) { return queueRepository.list(options).map(row => this.projectRow(row)); }

  waitForTerminal(id, timeoutMs = 7000) {
    const deadline = Date.now() + Math.max(100, Number(timeoutMs || 7000));
    return new Promise(resolve => {
      const observe = () => {
        const row = queueRepository.get(id);
        const projected = this.projectRow(row);
        if (!projected || DURABLE_TERMINAL.has(projected.state) || Date.now() >= deadline) {
          resolve({ queue: projected });
          return;
        }
        setTimeout(observe, 50);
      };
      observe();
    });
  }

  async retry(id) { throw retiredOperation(`retry:${clean(id)}`); }
  async cancel(id) { throw retiredOperation(`cancel:${clean(id)}`); }
  async resolveOutcomeUnknown(id, resolution) { throw retiredOperation(`resolve-outcome-unknown:${clean(id)}:${clean(resolution)}`); }
}

const singleton = new SendQueueService();
module.exports = singleton;
module.exports.SendQueueService = SendQueueService;
module.exports.publicQueueRow = publicQueueRow;
module.exports.QUEUE_MEDIA_ROOT = QUEUE_MEDIA_ROOT;
