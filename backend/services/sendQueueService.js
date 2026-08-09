'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { PATHS } = require('../config');
const queueRepository = require('../repositories/sendQueueRepository');
const { stableId, parseJson } = require('../lib/r32SqliteStore');
const { sha256 } = require('./domainEventLogService');
const sendMessageService = require('./sendMessageService');
const messageStore = require('./messageStore');
const mediaPipeline = require('./mediaPipeline');
const localPersistenceRepairService = require('./localPersistenceRepairService');
const { validateStickerInput } = require('./mediaSendPolicy');
const eventBus = require('./eventBus');
const logger = require('./logger');
const outboundTranslationAuthority = require('./outboundTranslationAuthority');
const sendPolicyAuthorityModule = require('./sendPolicyAuthority');
const platformAdapterRegistry = require('./platformAdapterPorts').singleton;
const platformCoreRepository = require('../repositories/platformCoreRepository').singleton;
const sendOutcomeReconciliationRepository = require('../repositories/sendOutcomeReconciliationRepository');
const outboxRouteAuthority = require('./outboxRouteAuthority').singleton;
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

const QUEUE_MEDIA_ROOT = path.join(PATHS.tmp, 'send-queue');
const PLATFORM_ACCEPTED_JOURNAL_ROOT = path.join(QUEUE_MEDIA_ROOT, 'platform-accepted');
const PLATFORM_ACCEPTED_CORRUPT_ROOT = path.join(PLATFORM_ACCEPTED_JOURNAL_ROOT, 'corrupt');
const OUTCOME_UNKNOWN_JOURNAL_ROOT = path.join(QUEUE_MEDIA_ROOT, 'outcome-unknown');
const OUTCOME_UNKNOWN_CORRUPT_ROOT = path.join(OUTCOME_UNKNOWN_JOURNAL_ROOT, 'corrupt');
const OUTCOME_UNKNOWN_BLOCK_REASON = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
const TERMINAL = new Set(['sent', 'failed', 'cancelled']);
const PERMANENT_ERRORS = new Set([
  'MESSAGE_TEXT_EMPTY', 'MEDIA_EMPTY', 'MEDIA_TOO_LARGE', 'UNSUPPORTED_PLATFORM', 'PLATFORM_OPERATION_UNSUPPORTED',
  'INVALID_QUEUE_PAYLOAD', 'QUEUE_MEDIA_MISSING', 'QUEUE_MEDIA_HASH_MISMATCH', 'INVALID_CHAT_TARGET',
  'MEDIA_FILE_MISSING', 'MEDIA_HASH_MISMATCH', 'MEDIA_UPLOAD_TOO_LARGE', 'QUEUE_MEDIA_PATH_INVALID', 'MEDIA_STICKER_FORMAT_UNSUPPORTED',
  'SEND_QUEUE_ACTION_UNSUPPORTED', 'MESSAGE_ACTION_TARGET_REQUIRED', 'TELEGRAM_EXPRESSION_REFERENCE_REQUIRED',
  'OUTBOX_COMMAND_INCOMPLETE', 'OUTBOX_COMMAND_TEXT_EMPTY', 'OUTBOX_COMMAND_UNFROZEN', 'OUTBOX_COMMAND_CONTENT_MUTATED',
  'OUTBOX_COMMAND_ENVELOPE_MUTATED', 'EGRESS_OUTBOX_COMMAND_REQUIRED', 'EGRESS_OUTBOX_COMMAND_UNFROZEN',
  'EGRESS_PERSISTED_OUTBOX_REQUIRED', 'EGRESS_OUTBOX_NOT_CLAIMED', 'EGRESS_OUTBOX_PERSISTENCE_MISMATCH',
  'EGRESS_OUTBOX_ROUTE_REQUIRED', 'EGRESS_OUTBOX_ROUTE_SCOPE_MISMATCH', 'EGRESS_OUTBOX_ROUTE_PERSISTENCE_MISMATCH',
  'OUTBOX_ROUTE_REQUIRED', 'OUTBOX_ROUTE_NOT_FOUND', 'OUTBOX_ROUTE_INACTIVE', 'OUTBOX_ROUTE_SCOPE_MISMATCH',
  'OUTBOX_ROUTE_ACCOUNT_CONFLICT', 'OUTBOX_ROUTE_PLATFORM_CONFLICT', 'OUTBOX_ROUTE_TARGET_CONFLICT',
  'EGRESS_OUTBOX_SCOPE_MISMATCH', 'EGRESS_OPERATION_UNSUPPORTED', 'SEND_CAPABILITY_UNAVAILABLE',
  'ACCOUNT_NOT_CONFIGURED', 'ACCOUNT_PLATFORM_MISMATCH', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_IDENTITY_ALIAS',
  'CONVERSATION_ACCOUNT_ROUTE_CONFLICT', 'SEND_POLICY_VERSION_NOT_FOUND', 'SEND_POLICY_VERSION_TAMPERED',
  'SEND_QUEUE_IDEMPOTENCY_CONFLICT', 'CAPABILITY_SNAPSHOT_NOT_FOUND', 'CAPABILITY_SNAPSHOT_SCOPE_MISMATCH', 'CAPABILITY_SNAPSHOT_NOT_SENDABLE',
  'AI_QUALITY_ROUTE_RECEIPT_INVALID', 'AI_QUALITY_ROUTE_RECEIPT_REQUIRED', 'AI_QUALITY_ROUTE_RECEIPT_AUTHORITY_INVALID',
  'AI_QUALITY_ROUTE_RECEIPT_TASK_MISMATCH', 'AI_QUALITY_ROUTE_RECEIPT_MODEL_REQUIRED',
  'AI_QUALITY_ROUTE_RECEIPT_LEARNING_INELIGIBLE', 'AI_QUALITY_ROUTE_RECEIPT_TIER_INSUFFICIENT'
]);
const WAITING_CONNECTION_ERRORS = new Set([
  'WHATSAPP_NOT_CONNECTED', 'TELEGRAM_NOT_CONNECTED', 'FACEBOOK_NOT_CONNECTED',
  'ACCOUNT_NOT_CONNECTED', 'PLATFORM_NOT_CONNECTED', 'NETWORK_OFFLINE', 'ACCOUNT_LOGGED_OUT',
  'ACCOUNT_WAITING_VERIFICATION', 'ACCOUNT_CONNECTING', 'ACCOUNT_PAUSED'
]);

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function nowIso() { return new Date().toISOString(); }
function ensureRoot() {
  fs.mkdirSync(QUEUE_MEDIA_ROOT, { recursive: true });
  fs.mkdirSync(PLATFORM_ACCEPTED_JOURNAL_ROOT, { recursive: true });
  fs.mkdirSync(PLATFORM_ACCEPTED_CORRUPT_ROOT, { recursive: true });
  fs.mkdirSync(OUTCOME_UNKNOWN_JOURNAL_ROOT, { recursive: true });
  fs.mkdirSync(OUTCOME_UNKNOWN_CORRUPT_ROOT, { recursive: true });
}
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
function acceptedJournalPath(id) {
  const key = clean(id).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!key) throw Object.assign(new Error('平台已接受日志缺少队列 ID'), { code: 'PLATFORM_ACCEPTED_JOURNAL_ID_INVALID' });
  return path.join(PLATFORM_ACCEPTED_JOURNAL_ROOT, `${key}.json`);
}
function unknownJournalPath(id) {
  const key = clean(id).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!key) throw Object.assign(new Error('发送结果不确定日志缺少队列 ID'), { code: 'OUTCOME_UNKNOWN_JOURNAL_ID_INVALID' });
  return path.join(OUTCOME_UNKNOWN_JOURNAL_ROOT, `${key}.json`);
}
function writeDurableJson(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, file);
    try {
      const dir = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } catch (_) {}
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
  }
}
function rowPayload(row) { return row?.payload || parseJson(row?.payload_json, {}) || {}; }
function claimOf(row = {}) { return { claimGeneration: Number(row.claim_generation || 0), claimToken: clean(row.claim_token) }; }
function isControlOperation(payload = {}) { return ['reaction','revoke'].includes(clean(payload.operation).toLowerCase()); }
function needsMessageReceipt(payload = {}) { return !isControlOperation(payload); }
function nonReceiptPlans(plans = []) { return plans.filter(plan => clean(plan?.payload?.kind) !== 'message-receipt'); }
function publicQueueRow(row) {
  if (!row) return null; const payload = rowPayload(row);
  return {
    id: row.id, idempotencyKey: row.idempotency_key, accountId: row.account_id, sessionKey: row.session_key,
    platform: clean(payload.platform, 'whatsapp'), messageType: row.message_type, state: row.state,
    outboxId: clean(row.outbox_id), outboxRouteId: clean(row.outbox_route_id), capabilitySnapshotId: clean(row.capability_snapshot_id),
    qualityTier: clean(row.quality_tier), emergencyMode: Number(row.emergency_mode || 0) === 1,
    sendPolicy: parseJson(row.send_policy_json, {}) || {},
    attempts: Number(row.attempts || 0), nextAttemptAt: row.next_attempt_at, lastError: row.last_error,
    platformMessageId: row.platform_message_id,
    unknownScope: clean(row.unknown_scope), unknownReason: clean(row.unknown_reason),
    unknownLane: clean(row.unknown_lane), executionGeneration: clean(row.execution_generation),
    unknownRecordedAt: clean(row.unknown_recorded_at), createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function retryDelay(attempt) { return new Date(Date.now() + Math.min(300, Math.max(2, 2 ** Math.max(1, Number(attempt || 1)))) * 1000).toISOString(); }
function errorCode(error) { return clean(error?.code || error?.message || 'SEND_FAILED').split(/\s+/)[0]; }
function isCommandScopedOutcomeUnknown(value = {}) {
  const scope = clean(value.unknown_scope || value.unknownScope).toLowerCase();
  if (scope) return scope === 'command';
  const text = clean(value.last_error || value.error || value.code).toUpperCase();
  return text.includes('PLATFORM_EGRESS_DEADLINE_EXCEEDED') || text.includes('EGRESS_DEADLINE_OUTCOME_UNKNOWN');
}
function unknownScope(value = {}) {
  const scope = clean(value.unknown_scope || value.unknownScope).toLowerCase();
  return ['command','account','global'].includes(scope) ? scope : (isCommandScopedOutcomeUnknown(value) ? 'command' : 'account');
}
function retryClassForCode(codeValue) {
  const code = clean(codeValue).toUpperCase();
  if (!code) return '';
  if (code === '429' || code.includes('429') || code.includes('RATE_LIMIT')) return '429';
  if (code.includes('FLOOD_WAIT')) return 'FLOOD_WAIT';
  if (code.includes('TIMEOUT') || code.includes('ETIMEDOUT')) return 'TIMEOUT';
  if (code.includes('TOKEN') && (code.includes('EXPIRED') || code.includes('REFRESH'))) return 'TOKEN_REFRESH';
  if (code.includes('NOT_CONNECTED') || code.includes('LOGGED_OUT') || code.includes('WAITING_VERIFICATION') || code.includes('CONNECTING') || code.includes('PAUSED')) return 'NOT_CONNECTED';
  if (code.includes('NETWORK') || code.includes('ECONN') || code.includes('ENET') || code.includes('EAI_AGAIN') || code.includes('SOCKET')) return 'NETWORK';
  return code;
}
function retryDecision(row = {}, codeValue, hardMaximum = 8) {
  const code = clean(codeValue).toUpperCase();
  const policy = parseJson(row.send_policy_json, {}) || {};
  const payload = rowPayload(row);
  const command = payload.outboxCommand || {};
  const retryBudget = Number(policy.retryBudget);
  const retryable = Array.isArray(policy.retryable) ? policy.retryable.map(value => clean(value).toUpperCase()).filter(Boolean) : [];
  const attempts = Math.max(0, Number(row.attempts || 0));
  const hardMax = Math.max(1, Number(hardMaximum || 1));
  if (!Number.isInteger(retryBudget) || retryBudget < 0 || !clean(policy.policyVersion) || !retryable.length
    || !clean(command.sendPolicySha256) || sha256(policy) !== clean(command.sendPolicySha256)) {
    return { retry: false, reasonCode: 'SEND_POLICY_PERSISTED_INVALID', attempts, retryBudget: 0, maximumAttempts: 1, classifiedCode: retryClassForCode(code) };
  }
  const maximumAttempts = Math.min(hardMax, retryBudget + 1);
  const classifiedCode = retryClassForCode(code);
  const policyAllows = retryable.includes(code) || retryable.includes(classifiedCode);
  if (PERMANENT_ERRORS.has(code)) return { retry: false, reasonCode: 'PERMANENT_ERROR', attempts, retryBudget, maximumAttempts, classifiedCode };
  if (!policyAllows) return { retry: false, reasonCode: 'ERROR_NOT_RETRYABLE_BY_FROZEN_POLICY', attempts, retryBudget, maximumAttempts, classifiedCode };
  if (attempts >= maximumAttempts) return { retry: false, reasonCode: 'FROZEN_RETRY_BUDGET_EXHAUSTED', attempts, retryBudget, maximumAttempts, classifiedCode };
  return { retry: true, reasonCode: 'FROZEN_POLICY_RETRY_ALLOWED', attempts, retryBudget, maximumAttempts, classifiedCode };
}
function quarantineAcceptedJournal(file) {
  const source = path.resolve(file || '');
  const root = path.resolve(PLATFORM_ACCEPTED_JOURNAL_ROOT);
  if (!source.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('平台接受日志路径越界'), { code: 'PLATFORM_ACCEPTED_JOURNAL_PATH_INVALID' });
  fs.mkdirSync(PLATFORM_ACCEPTED_CORRUPT_ROOT, { recursive: true });
  const target = path.join(PLATFORM_ACCEPTED_CORRUPT_ROOT, `${path.basename(source)}.${Date.now()}.${process.pid}.corrupt`);
  fs.renameSync(source, target);
  return target;
}

function quarantineOutcomeUnknownJournal(file) {
  const source = path.resolve(file || '');
  const root = path.resolve(OUTCOME_UNKNOWN_JOURNAL_ROOT);
  if (!source.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('发送结果不确定日志路径越界'), { code: 'OUTCOME_UNKNOWN_JOURNAL_PATH_INVALID' });
  fs.mkdirSync(OUTCOME_UNKNOWN_CORRUPT_ROOT, { recursive: true });
  const target = path.join(OUTCOME_UNKNOWN_CORRUPT_ROOT, `${path.basename(source)}.${Date.now()}.${process.pid}.corrupt`);
  fs.renameSync(source, target);
  return target;
}

function quotedPayload(value, chatJid) {
  if (!value) return undefined; if (value.key) return value;
  const id = clean(value.quotedMessageId || value.id); if (!id) return undefined;
  return { key: { remoteJid: clean(value.chatJid || chatJid), id, fromMe: Boolean(value.quotedFromMe || value.fromMe), participant: clean(value.quotedParticipant || value.participant) || undefined }, message: value.quotedMessage || value.message || undefined };
}

class SendQueueService extends EventEmitter {
  constructor(options = {}) {
    super(); this.outboundTranslationAuthority = options.outboundTranslationAuthority || outboundTranslationAuthority;
    this.sendPolicyAuthority = options.sendPolicyAuthority || sendPolicyAuthorityModule.singleton;
    this.domainEventRepository = options.domainEventRepository || platformCoreRepository;
    this.outcomeAudit = options.outcomeAudit || sendOutcomeReconciliationRepository;
    this.outboxRouteAuthority = options.outboxRouteAuthority || outboxRouteAuthority;
    this.timer = null; this.running = false; this.started = false;
    this.blockedPlatformAcceptances = new Map();
    this.maxAttempts = Math.max(1, Number(process.env.YANCE_SEND_MAX_ATTEMPTS || 8));
    this.intervalMs = Math.max(250, Number(process.env.YANCE_SEND_QUEUE_INTERVAL_MS || 900)); this.pausedReason = '';
    this.lateEgressListener = event => this.handleLateEgressResult(event).catch(error =>
      logger.error('send-queue', 'late-egress-reconciliation-failed', { code: errorCode(error), error: error.message }));
    this.lateEgressSubscribed = false;
    this.outcomeUnknownScanCursor = null;
    ensureRoot();
  }
  start() {
    if (this.started) return;
    this.started = true;
    if (!this.lateEgressSubscribed) {
      eventBus.on('platform-egress:late-result-quarantined', this.lateEgressListener);
      this.lateEgressSubscribed = true;
    }
    const acceptedRecovered = this.recoverAcceptedJournals();
    if (acceptedRecovered) logger.warn('send-queue', 'platform-accepted-journals-recovered', { recovered: acceptedRecovered });
    const unknownRecovered = this.recoverOutcomeUnknownJournals();
    if (unknownRecovered) logger.warn('send-queue', 'outcome-unknown-journals-recovered', { recovered: unknownRecovered });
    const recovered = queueRepository.recoverInterrupted();
    if (recovered) logger.error('send-queue', 'interrupted-sends-blocked-as-outcome-unknown', { recovered });
    const unresolved = this.hydrateOutcomeUnknownBlockers();
    if (unresolved) this.pause(OUTCOME_UNKNOWN_BLOCK_REASON);
    this.timer = setInterval(() => this.tick().catch(error => logger.error('send-queue', 'tick-failed', { error: error.stack || error.message })), this.intervalMs);
    this.timer.unref?.();
    this.wake();
  }
  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.lateEgressSubscribed) {
      eventBus.off('platform-egress:late-result-quarantined', this.lateEgressListener);
      this.lateEgressSubscribed = false;
    }
    this.outcomeUnknownScanCursor = null;
  }

  async handleLateEgressResult(event = {}) {
    const payload = event?.payload || event || {};
    if (payload.platformAccepted !== true) return { handled: false, reason: 'not-platform-accepted' };
    const queueId = clean(payload.commandId);
    const platformMessageId = clean(payload.platformMessageId);
    if (!queueId || !platformMessageId) return { handled: false, reason: 'identity-incomplete' };
    let row = queueRepository.get(queueId);
    if (!row || row.state !== 'send_outcome_unknown') return { handled: false, reason: 'queue-not-unknown', state: row?.state || '' };
    const expectedGeneration = clean(row.execution_generation);
    if (expectedGeneration && clean(payload.executionGeneration) !== expectedGeneration) {
      eventBus.publish('send-queue:late-acceptance-generation-rejected', {
        queueId, expectedGeneration, actualGeneration: clean(payload.executionGeneration),
        platformMessageId, at: nowIso()
      });
      return { handled: false, reason: 'generation-stale' };
    }
    row.payload = rowPayload(row);
    const expectedPlatform = clean(row.payload.platform).toLowerCase();
    const expectedAccountId = clean(row.account_id || row.payload.accountId);
    const expectedOperation = clean(row.payload.operation || row.message_type).toLowerCase();
    const actualPlatform = clean(payload.platform).toLowerCase();
    const actualAccountId = clean(payload.accountId);
    const actualOperation = clean(payload.operation).toLowerCase();
    const mismatches = [];
    if (expectedPlatform && actualPlatform !== expectedPlatform) mismatches.push('platform');
    if (expectedAccountId && actualAccountId !== expectedAccountId) mismatches.push('accountId');
    if (expectedOperation && actualOperation !== expectedOperation) mismatches.push('operation');
    const expectedRouteId = clean(row.outbox_route_id);
    const expectedRouteVersionId = clean(row.outbox_route_version_id);
    if (clean(row.session_key) && clean(payload.sessionKey) !== clean(row.session_key)) mismatches.push('sessionKey');
    if (expectedRouteId && clean(payload.outboxRouteId) !== expectedRouteId) mismatches.push('outboxRouteId');
    if (expectedRouteVersionId && clean(payload.outboxRouteVersionId) !== expectedRouteVersionId) mismatches.push('outboxRouteVersionId');
    if (clean(row.payload.chatJid) && clean(payload.conversationTarget) !== clean(row.payload.chatJid)) mismatches.push('conversationTarget');
    let route = null;
    try { route = expectedRouteVersionId ? this.outboxRouteAuthority?.getVersion?.(expectedRouteVersionId) || null : null; } catch (_) {}
    if (!route && expectedRouteVersionId) mismatches.push('routeVersionMissing');
    if (route) {
      if (clean(route.outboxRouteId) !== expectedRouteId) mismatches.push('routeVersionRouteId');
      if (clean(route.accountId) !== expectedAccountId) mismatches.push('routeAccountId');
      if (clean(route.platform).toLowerCase() !== expectedPlatform) mismatches.push('routePlatform');
      if (clean(route.conversationId) !== clean(row.session_key)) mismatches.push('routeConversationId');
      if (clean(route.routeTarget) !== clean(row.payload.chatJid)) mismatches.push('routeTarget');
    }
    if (mismatches.length) {
      eventBus.publish('send-queue:late-acceptance-identity-rejected', {
        queueId, mismatches, expectedPlatform, actualPlatform, expectedAccountId, actualAccountId,
        expectedOperation, actualOperation, outboxRouteId: expectedRouteId,
        outboxRouteVersionId: expectedRouteVersionId, at: nowIso()
      });
      return { handled: false, reason: 'identity-mismatch', mismatches };
    }
    const receiptPlan = needsMessageReceipt(row.payload) ? this.repairPlan(row, 'receipt', {
      kind: 'message-receipt',
      receipt: { accountId: row.account_id, chatJid: row.payload.chatJid, messageId: row.id, status: 'sent' }
    }) : null;
    const plans = [receiptPlan].filter(Boolean);
    this.writeAcceptedJournal(row, platformMessageId, plans);
    try {
      row = queueRepository.markPlatformAcceptedLocalPending(queueId, {
        platformMessageId,
        platformAcceptedAt: clean(payload.at) || nowIso(),
        localPersistencePlans: plans,
        error: 'LATE_PLATFORM_ACCEPTANCE_REQUIRES_LOCAL_RECONCILIATION'
      });
      this.removeAcceptedJournal(queueId);
    } catch (error) {
      logger.error('send-queue', 'late-platform-acceptance-checkpoint-pending', {
        queueId, platformMessageId, executionGeneration: clean(payload.executionGeneration),
        code: errorCode(error), error: error.message
      });
      return { handled: true, durableJournalPending: true };
    }
    this.blockedPlatformAcceptances.delete(queueId);
    eventBus.publish('send-queue:late-platform-acceptance-recorded', {
      queue: publicQueueRow(row), platformMessageId, executionGeneration: clean(payload.executionGeneration), at: nowIso()
    });
    this.wake();
    return { handled: true, queue: publicQueueRow(row) };
  }
  wake() { if (this.started && !this.pausedReason) setImmediate(() => this.tick().catch(error => logger.error('send-queue', 'wake-failed', { error: error.stack || error.message }))); }

  assertEnqueueAllowed(operation = 'send', input = {}) {
    const accountId = clean(input.accountId || input.account_id);
    let summary;
    try { summary = queueRepository.summary({ accountId }); }
    catch (error) {
      this.pause(OUTCOME_UNKNOWN_BLOCK_REASON);
      const blocked = new Error(`发送队列状态无法确认，已阻止新增出站操作：${operation}`);
      blocked.code = 'SEND_QUEUE_STATUS_UNAVAILABLE_WRITE_BLOCKED';
      blocked.status = 423;
      blocked.reasonCode = OUTCOME_UNKNOWN_BLOCK_REASON;
      blocked.cause = error;
      throw blocked;
    }
    const globalBlocked = Number(summary.globalOutcomeUnknown || 0);
    const accountBlocked = accountId ? Number(summary.accountOutcomeUnknown || 0) : 0;
    if (globalBlocked > 0 || accountBlocked > 0 || this.pausedReason === OUTCOME_UNKNOWN_BLOCK_REASON) {
      if (globalBlocked > 0 && this.pausedReason !== OUTCOME_UNKNOWN_BLOCK_REASON) this.pause(OUTCOME_UNKNOWN_BLOCK_REASON);
      const count = Math.max(1, globalBlocked + accountBlocked);
      const error = new Error(`存在 ${count} 个发送结果不确定任务，完成对应范围对账前禁止新增出站操作：${operation}`);
      error.code = 'SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED';
      error.status = 423;
      error.reasonCode = OUTCOME_UNKNOWN_BLOCK_REASON;
      error.outcomeUnknown = count;
      error.accountId = accountId;
      throw error;
    }
    return true;
  }

  platformFor(input = {}) { return sendMessageService.resolveAccount(input.accountId, input.platform, input.chatJid).platform; }

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
    eventBus.publish('send-queue:enqueued', { queue: publicQueueRow(routedRow), translation: prepared.translationApplied === true ? { applied: true, targetLanguageCode: prepared.targetLanguageCode, model: prepared.translationModel } : { applied: false } });
    this.wake();
    return {
      ...publicQueueRow(routedRow),
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
    eventBus.publish('send-queue:enqueued', { queue: publicQueueRow(routedRow), operation });
    this.wake();
    return { ...publicQueueRow(routedRow), approvalReceiptId: frozen.queueMetadata.approvalReceiptId, finalTextSha256: frozen.queueMetadata.finalTextSha256, sendPolicyVersion: frozen.queueMetadata.sendPolicy.policyVersion, capabilitySnapshotId: frozen.queueMetadata.capabilitySnapshotId };
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
    if (TERMINAL.has(routedRow.state)) { try { fs.rmSync(input.mediaFile, { force: true }); } catch (_) {} }
    const upload = { bytes: payload.bytes, sha256: input.digest };
    eventBus.publish('send-queue:enqueued', { queue: publicQueueRow(routedRow), upload });
    this.wake();
    return {
      queue: publicQueueRow(routedRow), upload,
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

  async dispatch(row) {
    const payload = rowPayload(row);
    let command = payload.outboxCommand || null;
    if (!command) {
      const mediaReferences = payload.operation === 'media' ? [{
        path: payload.mediaFile,
        sha256: payload.sha256,
        bytes: Number(payload.bytes || 0),
        mimeType: payload.mimeType,
        filename: payload.filename,
        kind: payload.kind
      }] : [];
      const frozen = this.sendPolicyAuthority.freezeOutboxCommand({
        platform: payload.platform,
        accountId: row.account_id,
        sessionKey: row.session_key,
        chatJid: payload.chatJid,
        idempotencyKey: row.idempotency_key,
        commandId: row.id,
        operation: payload.operation,
        messageType: payload.operation === 'text' ? 'text' : payload.operation === 'media' || payload.operation === 'native_expression' ? payload.kind : payload.operation,
        actionPayload: payload.actionPayload || {},
        kind: payload.kind,
        finalText: payload.operation === 'text' ? payload.text : payload.caption,
        targetLanguage: clean(payload.translation?.targetLanguageCode || payload.translation?.targetLanguage),
        mediaReferences,
        replyReference: quotedPayload(payload.quoted, payload.chatJid),
        outboxId: clean(row.outbox_id),
        qualityTier: clean(row.quality_tier),
        emergencyMode: Number(row.emergency_mode || 0) === 1
      });
      const persisted = queueRepository.persistOutboxCommand(row.id, frozen.command, frozen.queueMetadata, claimOf(row));
      command = persisted?.payload?.outboxCommand || frozen.command;
      if (persisted) {
        Object.assign(row, persisted, {
          payload: persisted.payload || rowPayload(persisted),
          payload_json: persisted.payload_json,
          send_policy_json: persisted.send_policy_json
        });
      }
    }
    this.sendPolicyAuthority.verifyFrozenCommand(command);
    if (command.operation === 'media') {
      const media = Array.isArray(command.mediaReferences) ? command.mediaReferences[0] : null;
      const mediaFile = safeQueuePath(media?.path);
      if (!fs.existsSync(mediaFile)) throw Object.assign(new Error('队列媒体文件不存在'), { code: 'QUEUE_MEDIA_MISSING' });
      mediaPipeline.verifyFile(mediaFile);
      if (media?.sha256 && mediaPipeline.sha256File(mediaFile) !== media.sha256) {
        throw Object.assign(new Error('队列媒体校验失败'), { code: 'QUEUE_MEDIA_HASH_MISMATCH' });
      }
    }
    return platformAdapterRegistry.executeEgress(command);
  }

  repairPlan(row, suffix, payload) {
    return {
      id: `local-repair-${suffix}-${row.id}`,
      queueId: row.id,
      platform: row.payload.platform,
      accountId: row.account_id,
      conversationId: row.session_key,
      payload
    };
  }

  fallbackMessageRepairPayload(row, platformMessageId) {
    const common = {
      id: row.id,
      dedupeKey: row.id,
      externalMessageId: platformMessageId || row.id,
      accountId: row.account_id,
      conversationId: row.session_key,
      sessionKey: row.session_key,
      chatJid: row.payload.chatJid,
      platform: row.payload.platform,
      direction: 'outbound',
      fromMe: true,
      timestamp: nowIso(),
      deliveryStatus: 'sent',
      queueId: row.id,
      idempotencyKey: row.idempotency_key
    };
    if (row.payload.operation === 'reaction') {
      return { kind: 'reaction-apply', reaction: { accountId: row.account_id, chatJid: row.payload.chatJid, targetId: row.payload.actionPayload?.targetId, emoji: row.payload.actionPayload?.emoji, actor: 'me' } };
    }
    if (row.payload.operation === 'revoke') {
      return { kind: 'message-revoke', revoke: { accountId: row.account_id, chatJid: row.payload.chatJid, targetId: row.payload.actionPayload?.targetId } };
    }
    if (row.payload.operation === 'media') {
      const kind = clean(row.payload.kind, row.message_type || 'document');
      return {
        kind: 'outbound-media-upsert',
        message: { ...common, type: kind, text: clean(row.payload.caption), ...(row.payload.translation || {}) },
        source: { filePath: row.payload.mediaFile, expectedSha256: row.payload.sha256 },
        descriptor: {
          kind,
          mimeType: clean(row.payload.mimeType, 'application/octet-stream'),
          filename: clean(row.payload.filename, 'file'),
          caption: clean(row.payload.caption),
          outgoing: true
        }
      };
    }
    if (row.payload.operation === 'native_expression') {
      const kind = clean(row.payload.actionPayload?.kind || row.message_type, 'sticker');
      return {
        kind: 'message-upsert',
        message: {
          ...common,
          type: kind,
          text: clean(row.payload.caption),
          nativeExpressionReference: clean(row.payload.actionPayload?.reference),
          ...(row.payload.translation || {})
        }
      };
    }
    return { kind: 'message-upsert', message: { ...common, type: 'text', text: clean(row.payload.text), ...(row.payload.translation || {}) } };
  }

  writeAcceptedJournal(row, platformMessageId, plans) {
    ensureRoot();
    const target = acceptedJournalPath(row.id);
    const payload = rowPayload(row);
    writeDurableJson(target, {
      queueId: row.id,
      platformMessageId,
      localPersistencePlans: plans,
      acceptedAt: nowIso(),
      claimGeneration: Number(row.claim_generation || 0),
      claimToken: clean(row.claim_token),
      executionGeneration: clean(row.execution_generation),
      platform: clean(payload.platform).toLowerCase(),
      accountId: clean(row.account_id || payload.accountId),
      operation: clean(payload.operation || row.message_type).toLowerCase(),
      sessionKey: clean(row.session_key),
      outboxRouteId: clean(row.outbox_route_id),
      outboxRouteVersionId: clean(row.outbox_route_version_id),
      conversationTarget: clean(payload.chatJid)
    });
    return target;
  }

  removeAcceptedJournal(id) {
    try { fs.rmSync(acceptedJournalPath(id), { force: true }); } catch (_) {}
  }

  recoverAcceptedJournals() {
    ensureRoot();
    let recovered = 0;
    for (const name of fs.readdirSync(PLATFORM_ACCEPTED_JOURNAL_ROOT)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(PLATFORM_ACCEPTED_JOURNAL_ROOT, name);
      let journal;
      try {
        journal = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!clean(journal?.queueId) || !clean(journal?.platformMessageId) || !Array.isArray(journal?.localPersistencePlans)) {
          throw Object.assign(new Error('平台接受日志字段不完整'), { code: 'PLATFORM_ACCEPTED_JOURNAL_INVALID' });
        }
      } catch (error) {
        let quarantinedFile = '';
        let quarantineError = null;
        try { quarantinedFile = quarantineAcceptedJournal(file); }
        catch (moveError) { quarantineError = moveError; }
        logger.error('send-queue', 'platform-accepted-journal-invalid-quarantined', {
          file,
          quarantinedFile,
          code: errorCode(error),
          error: error.message,
          quarantineCode: quarantineError ? errorCode(quarantineError) : '',
          quarantineError: quarantineError?.message || ''
        });
        continue;
      }
      try {
        const row = queueRepository.get(journal.queueId);
        if (!row) {
          const quarantinedFile = quarantineAcceptedJournal(file);
          logger.error('send-queue', 'platform-accepted-journal-orphan-quarantined', { file, quarantinedFile, queueId: journal.queueId });
          continue;
        }
        if (row.state === 'sent') {
          fs.rmSync(file, { force: true });
          continue;
        }
        if (TERMINAL.has(row.state)) {
          const quarantinedFile = quarantineAcceptedJournal(file);
          logger.error('send-queue', 'platform-accepted-journal-terminal-conflict-quarantined', { file, quarantinedFile, queueId: journal.queueId, state: row.state });
          continue;
        }
        const rowData = rowPayload(row);
        const journalMismatches = [];
        for (const [name, expected, actual] of [
          ['platform', clean(rowData.platform).toLowerCase(), clean(journal.platform).toLowerCase()],
          ['accountId', clean(row.account_id || rowData.accountId), clean(journal.accountId)],
          ['operation', clean(rowData.operation || row.message_type).toLowerCase(), clean(journal.operation).toLowerCase()],
          ['sessionKey', clean(row.session_key), clean(journal.sessionKey)],
          ['outboxRouteId', clean(row.outbox_route_id), clean(journal.outboxRouteId)],
          ['outboxRouteVersionId', clean(row.outbox_route_version_id), clean(journal.outboxRouteVersionId)],
          ['conversationTarget', clean(rowData.chatJid), clean(journal.conversationTarget)],
          ['executionGeneration', clean(row.execution_generation), clean(journal.executionGeneration)]
        ]) if (expected && actual !== expected) journalMismatches.push(name);
        if (journalMismatches.length) {
          const quarantinedFile = quarantineAcceptedJournal(file);
          logger.error('send-queue', 'platform-accepted-journal-identity-conflict-quarantined', { file, quarantinedFile, queueId: journal.queueId, mismatches: journalMismatches });
          continue;
        }
        queueRepository.markPlatformAcceptedLocalPending(journal.queueId, {
          platformMessageId: journal.platformMessageId,
          localPersistencePlans: journal.localPersistencePlans,
          platformAcceptedAt: journal.acceptedAt,
          error: 'PLATFORM_ACCEPTED_LOCAL_RECOVERY: 平台已接受，正在恢复本地投影'
        }, { claimGeneration: journal.claimGeneration, claimToken: journal.claimToken });
        fs.rmSync(file, { force: true });
        recovered += 1;
      } catch (error) {
        logger.error('send-queue', 'platform-accepted-journal-recovery-retryable-failed', {
          file,
          code: errorCode(error),
          error: error.message
        });
      }
    }
    return recovered;
  }

  persistOutcomeUnknownJournal(row, detail = {}) {
    ensureRoot();
    const file = unknownJournalPath(row.id);
    const payload = rowPayload(row);
    writeDurableJson(file, {
      queueId: row.id,
      platform: clean(detail.platform || payload.platform),
      accountId: clean(detail.accountId || row.account_id),
      operation: clean(detail.operation || payload.operation || row.message_type).toLowerCase(),
      sessionKey: clean(detail.sessionKey || row.session_key),
      conversationTarget: clean(detail.conversationTarget || payload.chatJid),
      outboxRouteId: clean(detail.outboxRouteId || row.outbox_route_id),
      outboxRouteVersionId: clean(detail.outboxRouteVersionId || row.outbox_route_version_id),
      unknownScope: unknownScope(detail),
      unknownReason: clean(detail.unknownReason || detail.error || detail.code || 'SEND_OUTCOME_UNKNOWN'),
      unknownLane: clean(detail.unknownLane) || `${clean(detail.platform || payload.platform, 'unknown').toLowerCase()}:${clean(detail.accountId || row.account_id, 'unknown')}`,
      executionGeneration: clean(detail.executionGeneration || row.execution_generation),
      platformMessageId: clean(detail.platformMessageId),
      claimGeneration: Number(row.claim_generation || 0),
      claimToken: clean(row.claim_token),
      recordedAt: nowIso()
    });
    return file;
  }

  removeOutcomeUnknownJournal(id) {
    try { fs.rmSync(unknownJournalPath(id), { force: true }); } catch (_) {}
  }

  recoverOutcomeUnknownJournals() {
    ensureRoot();
    let recovered = 0;
    for (const name of fs.readdirSync(OUTCOME_UNKNOWN_JOURNAL_ROOT)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(OUTCOME_UNKNOWN_JOURNAL_ROOT, name);
      let journal = null;
      try {
        journal = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!clean(journal.queueId) || !['command','account','global'].includes(clean(journal.unknownScope).toLowerCase())) {
          throw Object.assign(new Error('发送结果不确定日志字段不完整'), { code: 'OUTCOME_UNKNOWN_JOURNAL_INVALID' });
        }
      } catch (error) {
        try { quarantineOutcomeUnknownJournal(file); } catch (_) {}
        logger.error('send-queue', 'outcome-unknown-journal-invalid-quarantined', { file, code: errorCode(error), error: error.message });
        continue;
      }
      try {
        const row = queueRepository.get(journal.queueId);
        if (!row || TERMINAL.has(row.state) || row.state === 'platform_accepted_local_pending') {
          fs.rmSync(file, { force: true });
          continue;
        }
        const rowData = rowPayload(row);
        const journalMismatches = [];
        for (const [name, expected, actual] of [
          ['platform', clean(rowData.platform).toLowerCase(), clean(journal.platform).toLowerCase()],
          ['accountId', clean(row.account_id || rowData.accountId), clean(journal.accountId)],
          ['operation', clean(rowData.operation || row.message_type).toLowerCase(), clean(journal.operation).toLowerCase()],
          ['sessionKey', clean(row.session_key), clean(journal.sessionKey)],
          ['conversationTarget', clean(rowData.chatJid), clean(journal.conversationTarget)],
          ['outboxRouteId', clean(row.outbox_route_id), clean(journal.outboxRouteId)],
          ['outboxRouteVersionId', clean(row.outbox_route_version_id), clean(journal.outboxRouteVersionId)],
          ['executionGeneration', clean(row.execution_generation), clean(journal.executionGeneration)]
        ]) if (expected && actual !== expected) journalMismatches.push(name);
        if (journalMismatches.length) {
          const quarantinedFile = quarantineOutcomeUnknownJournal(file);
          logger.error('send-queue', 'outcome-unknown-journal-identity-conflict-quarantined', {
            file, quarantinedFile, queueId: journal.queueId, mismatches: journalMismatches
          });
          continue;
        }
        queueRepository.markOutcomeUnknown(journal.queueId, {
          platformMessageId: journal.platformMessageId,
          error: journal.unknownReason,
          unknownScope: journal.unknownScope,
          unknownReason: journal.unknownReason,
          unknownLane: journal.unknownLane,
          executionGeneration: journal.executionGeneration
        }, { claimGeneration: journal.claimGeneration, claimToken: journal.claimToken });
        fs.rmSync(file, { force: true });
        recovered += 1;
      } catch (error) {
        logger.error('send-queue', 'outcome-unknown-journal-recovery-retryable-failed', { file, code: errorCode(error), error: error.message });
      }
    }
    return recovered;
  }

  enqueueRepairPlans(plans = []) {
    const enqueued = [];
    const failed = [];
    for (const plan of plans) {
      try {
        enqueued.push(localPersistenceRepairService.enqueue(plan));
      } catch (error) {
        failed.push({ plan, code: errorCode(error), message: error.message || String(error) });
      }
    }
    return { enqueued, failed };
  }

  plansRequireMediaSource(plans = []) {
    return plans.some(plan => clean(plan?.payload?.kind) === 'outbound-media-upsert' && clean(plan?.payload?.source?.filePath));
  }

  cleanupQueueMedia(row, plans = []) {
    if (!row?.payload?.mediaFile || this.plansRequireMediaSource(plans)) return;
    try { fs.rmSync(safeQueuePath(row.payload.mediaFile), { force: true }); } catch (_) {}
  }

  currentQueueOrRow(row) {
    try { return queueRepository.get(row.id) || row; }
    catch (error) {
      logger.error('send-queue', 'queue-state-read-failed-after-platform-acceptance', { id: row.id, code: errorCode(error), error: error.message });
      return row;
    }
  }

  blockEgressDeadlineOutcome(row, error) {
    const code = errorCode(error) || 'PLATFORM_EGRESS_DEADLINE_EXCEEDED';
    const detail = {
      id: row.id, platform: clean(row.payload?.platform), accountId: row.account_id,
      platformMessageId: '', code, error: error?.message || '平台发送执行超过期限',
      executionGeneration: clean(error?.executionGeneration || row.execution_generation), at: nowIso(), persisted: false,
      scope: 'command', commandScoped: true,
      unknownLane: `${clean(row.payload?.platform, 'unknown').toLowerCase()}:${clean(row.account_id, 'unknown')}`
    };
    let saved = null;
    try { this.persistOutcomeUnknownJournal(row, detail); detail.journalPersisted = true; }
    catch (journalError) { detail.journalCode = errorCode(journalError); detail.journalError = journalError.message; }
    try {
      saved = queueRepository.markOutcomeUnknown(row.id, {
        platformMessageId: '',
        error: `PLATFORM_EGRESS_DEADLINE_EXCEEDED: SDK 调用超过期限，远端结果不确定；该命令已隔离且禁止自动重发`,
        unknownScope: 'command', unknownReason: code, unknownLane: detail.unknownLane,
        executionGeneration: detail.executionGeneration
      }, claimOf(row));
      detail.persisted = saved?.state === 'send_outcome_unknown';
      if (detail.persisted) this.removeOutcomeUnknownJournal(row.id);
    } catch (stateError) {
      detail.statePersistenceCode = errorCode(stateError);
      detail.statePersistenceError = stateError.message || String(stateError);
    }
    this.blockedPlatformAcceptances.set(row.id, detail);
    const output = {
      queue: publicQueueRow(saved || this.currentQueueOrRow(row)),
      result: {
        platformMessageId: '', outcomeUnknown: true, automaticRetryBlocked: true,
        localPersistencePending: false, localPersistenceErrorCode: code,
        executionGeneration: clean(error?.executionGeneration), commandScopedIsolation: true
      }
    };
    this.emit(`terminal:${row.id}`, output);
    eventBus.publish('send-queue:egress-deadline-outcome-unknown', { ...detail, queue: output.queue });
    logger.error('send-queue', 'egress-deadline-command-isolated', detail);
    return output;
  }

  blockUncertainPlatformAcceptance(row, platformMessageId, error) {
    const reason = OUTCOME_UNKNOWN_BLOCK_REASON;
    const detail = {
      id: row.id,
      platform: row.payload?.platform || '',
      accountId: row.account_id,
      platformMessageId: clean(platformMessageId),
      code: errorCode(error),
      error: error?.message || String(error || reason),
      at: nowIso(), scope: 'account', commandScoped: false,
      executionGeneration: clean(error?.executionGeneration || row.execution_generation),
      unknownLane: `${clean(row.payload?.platform, 'unknown').toLowerCase()}:${clean(row.account_id, 'unknown')}`
    };
    this.blockedPlatformAcceptances.set(row.id, detail);
    let saved = null;
    try { this.persistOutcomeUnknownJournal(row, detail); detail.journalPersisted = true; }
    catch (journalError) { detail.journalCode = errorCode(journalError); detail.journalError = journalError.message; }
    try {
      saved = queueRepository.markOutcomeUnknown(row.id, {
        platformMessageId,
        error: `${reason}: 平台可能已发送，但本地接受日志与 SQLite 检查点均未持久化，已禁止自动重发`,
        unknownScope: 'account', unknownReason: detail.code, unknownLane: detail.unknownLane,
        executionGeneration: detail.executionGeneration
      }, claimOf(row));
      detail.persisted = saved?.state === 'send_outcome_unknown';
      if (detail.persisted) this.removeOutcomeUnknownJournal(row.id);
    } catch (stateError) {
      detail.statePersistenceCode = errorCode(stateError);
      detail.statePersistenceError = stateError.message || String(stateError);
    }
    const output = {
      queue: publicQueueRow(saved || this.currentQueueOrRow(row)),
      result: {
        platformMessageId,
        localPersistencePending: true,
        localPersistenceErrorCode: detail.code,
        platformAcceptedCheckpointPending: true,
        automaticRetryBlocked: true
      }
    };
    eventBus.publish('send-queue:platform-acceptance-uncertain', { ...detail, queue: output.queue });
    logger.error('send-queue', 'platform-acceptance-uncertain-account-lane-isolated', detail);
    return output;
  }

  hydrateOutcomeUnknownBlockers() {
    for (const [id, detail] of this.blockedPlatformAcceptances.entries()) {
      if (id === '__scan_failed__' || detail?.persisted) continue;
      try {
        const saved = queueRepository.markOutcomeUnknown(id, {
          platformMessageId: detail.platformMessageId,
          error: detail.error || 'SEND_OUTCOME_UNKNOWN: 发送结果不确定，已禁止自动重发',
          unknownScope: detail.scope || (detail.commandScoped === true ? 'command' : 'account'),
          unknownReason: detail.code || detail.error,
          unknownLane: detail.unknownLane,
          executionGeneration: detail.executionGeneration
        }, claimOf(queueRepository.get(id) || {}));
        if (saved?.state === 'send_outcome_unknown') detail.persisted = true;
        else if (saved && ['sent', 'cancelled', 'platform_accepted_local_pending'].includes(saved.state)) this.blockedPlatformAcceptances.delete(id);
      } catch (error) {
        detail.statePersistenceCode = errorCode(error);
        detail.statePersistenceError = error.message || String(error);
      }
    }
    let rows = [];
    let summary;
    try {
      summary = queueRepository.summary();
      rows = queueRepository.list({ state: 'send_outcome_unknown', limit: 1000 });
    } catch (error) {
      this.blockedPlatformAcceptances.set('__scan_failed__', {
        id: '__scan_failed__', code: errorCode(error), error: error.message || String(error), at: nowIso(), scanFailed: true
      });
      logger.error('send-queue', 'outcome-unknown-scan-failed', { code: errorCode(error), error: error.message });
      return 1;
    }
    const persistedIds = new Set();
    for (const row of rows) {
      persistedIds.add(row.id);
      const payload = rowPayload(row);
      this.blockedPlatformAcceptances.set(row.id, {
        id: row.id, platform: clean(payload.platform), accountId: row.account_id,
        platformMessageId: clean(row.platform_message_id), code: 'SEND_OUTCOME_UNKNOWN',
        error: clean(row.last_error), at: clean(row.updated_at, nowIso()), persisted: true,
        scope: unknownScope(row), commandScoped: unknownScope(row) === 'command',
        unknownLane: clean(row.unknown_lane), executionGeneration: clean(row.execution_generation)
      });
    }
    const completeDetailScan = Number(summary.outcomeUnknown || 0) <= rows.length;
    for (const [id, detail] of this.blockedPlatformAcceptances.entries()) {
      if (id === '__scan_failed__') this.blockedPlatformAcceptances.delete(id);
      else if (completeDetailScan && detail?.persisted && !persistedIds.has(id)) this.blockedPlatformAcceptances.delete(id);
    }
    return Number(summary.globalOutcomeUnknown || 0);
  }

  unresolvedOutcomeUnknownCount() {
    // Hydration uses the exact SQL aggregate and fails closed (returns 1) when
    // the queue ledger cannot be read. Resume must never open writes on an
    // indeterminate authority state.
    return this.hydrateOutcomeUnknownBlockers();
  }

  clearOutcomeUnknownPauseIfResolved() {
    const unresolved = this.unresolvedOutcomeUnknownCount();
    if (unresolved || this.pausedReason !== OUTCOME_UNKNOWN_BLOCK_REASON) return this.status();
    const previous = this.pausedReason;
    this.pausedReason = '';
    eventBus.publish('send-queue:resumed', { reason: 'manual-outcome-reconciliation', previous, at: nowIso() });
    this.wake();
    return this.status();
  }

  sentEvidenceForRow(row = {}) {
    const payload = rowPayload(row);
    const platform = clean(payload.platform).toLowerCase();
    const accountId = clean(row.account_id || payload.accountId);
    const queueId = clean(row.id);
    if (!platform || !accountId || !queueId || !this.domainEventRepository?.getDomainEventByIdempotency) return null;
    const idempotencyKey = `message-sent:${platform}:${accountId}:${queueId}`;
    const event = this.domainEventRepository.getDomainEventByIdempotency(idempotencyKey);
    if (!event || clean(event.event_type) !== 'message.sent') return null;
    const evidence = event.payload || parseJson(event.payload_json, {}) || {};
    const platformMessageId = clean(
      evidence.platformMessageId || evidence.messageId || event.external_event_id || row.platform_message_id
    );
    return {
      eventId: clean(event.event_id),
      idempotencyKey,
      platformMessageId,
      occurredAt: clean(event.occurred_at),
      receivedAt: clean(event.received_at),
      payloadSha256: clean(event.payload_sha256),
      evidence
    };
  }

  recordOutcomeAudit(input = {}) {
    try { return this.outcomeAudit?.record?.(input) || null; }
    catch (error) {
      logger.error('send-queue', 'outcome-reconciliation-audit-failed', {
        id: input.queueId || '', resolution: input.resolution || '', code: errorCode(error), error: error.message
      });
      throw Object.assign(new Error('发送结果已处理，但对账审计写入失败，系统保持安全阻断'), {
        code: 'SEND_OUTCOME_AUDIT_PERSIST_FAILED', status: 503, cause: error
      });
    }
  }

  async reconcileOutcomeUnknownFromDurableEvidence(limit = 100) {
    let rows = [];
    try { rows = queueRepository.list({ state: 'send_outcome_unknown', order: 'oldest', cursor: this.outcomeUnknownScanCursor, limit: Math.max(1, Math.min(1000, Number(limit || 100))) }); }
    catch (error) {
      logger.error('send-queue', 'outcome-reconciliation-scan-failed', { code: errorCode(error), error: error.message });
      return { checked: 0, reconciled: 0, unresolved: 1, failures: [{ code: errorCode(error), error: error.message }] };
    }
    const pageLimit = Math.max(1, Math.min(1000, Number(limit || 100)));
    if (rows.length) {
      const last = rows[rows.length - 1];
      this.outcomeUnknownScanCursor = rows.length >= pageLimit ? { createdAt: last.created_at, id: last.id } : null;
    } else {
      this.outcomeUnknownScanCursor = null;
    }
    const results = [];
    const failures = [];
    for (const row of rows) {
      try {
        const evidence = this.sentEvidenceForRow(row);
        if (!evidence) continue;
        const result = await this.resolveOutcomeUnknown(row.id, 'confirmed_sent', {
          actor: 'system-domain-event-evidence',
          reason: '发现平台发送成功后持久化的 message.sent 权威域事件；仅完成本地对账，禁止再次调用平台发送。',
          evidenceType: 'domain-event',
          evidenceId: evidence.eventId || evidence.idempotencyKey,
          evidence,
          platformMessageId: evidence.platformMessageId
        });
        results.push(result);
      } catch (error) {
        failures.push({ id: row.id, code: errorCode(error), error: error.message || String(error) });
        logger.error('send-queue', 'outcome-reconciliation-evidence-failed', failures[failures.length - 1]);
      }
    }
    const unresolved = this.hydrateOutcomeUnknownBlockers();
    return { checked: rows.length, reconciled: results.length, unresolved, results, failures };
  }

  async resolveOutcomeUnknown(id, resolution, options = {}) {
    const row = queueRepository.get(id);
    if (!row) throw Object.assign(new Error('发送队列任务不存在'), { code: 'SEND_QUEUE_ITEM_NOT_FOUND', status: 404 });
    if (row.state !== 'send_outcome_unknown') {
      throw Object.assign(new Error('该任务当前不是发送结果不确定状态'), { code: 'SEND_OUTCOME_NOT_UNKNOWN', status: 409 });
    }
    row.payload = rowPayload(row);
    try { this.outcomeAudit?.ensure?.(); }
    catch (error) {
      throw Object.assign(new Error('发送结果对账审计存储不可用，已保持任务阻断状态'), {
        code: 'SEND_OUTCOME_AUDIT_UNAVAILABLE', status: 503, cause: error
      });
    }
    const normalized = clean(resolution).toLowerCase();
    if (normalized === 'confirmed_sent') {
      const platformMessageId = clean(options.platformMessageId || row.platform_message_id);
      const plans = [
        this.repairPlan(row, 'message', {
          ...this.fallbackMessageRepairPayload(row, platformMessageId),
          cleanupFile: Boolean(row.payload.mediaFile)
        }),
        needsMessageReceipt(row.payload) ? this.repairPlan(row, 'receipt', {
          kind: 'message-receipt',
          receipt: { accountId: row.account_id, chatJid: row.payload.chatJid, messageId: row.id, status: 'sent' }
        }) : null
      ].filter(Boolean);
      const pending = queueRepository.markPlatformAcceptedLocalPending(row.id, {
        platformMessageId,
        localPersistencePlans: plans,
        platformAcceptedAt: nowIso(),
        error: `SEND_OUTCOME_RECONCILED_CONFIRMED_SENT: ${clean(options.reason, '已确认平台发送成功，正在修复本地记录')}`
      });
      const durable = this.enqueueRepairPlans(nonReceiptPlans(plans));
      if (durable.failed.length) {
        const first = durable.failed[0];
        const savedPending = queueRepository.markPlatformAcceptedLocalPending(row.id, {
          platformMessageId,
          localPersistencePlans: plans,
          platformAcceptedAt: nowIso(),
          error: `${first.code}: ${first.message}`
        }, claimOf(pending));
        const audit = this.recordOutcomeAudit({
          queueId: row.id,
          resolution: normalized,
          actor: clean(options.actor, 'desktop-user'),
          reason: clean(options.reason, '已确认平台发送成功，但本地持久化修复仍在等待'),
          evidenceType: clean(options.evidenceType, 'manual-platform-check'),
          evidenceId: clean(options.evidenceId),
          evidence: options.evidence || {},
          previousState: 'send_outcome_unknown',
          resultingState: savedPending?.state || 'platform_accepted_local_pending',
          platformMessageId
        });
        this.blockedPlatformAcceptances.delete(row.id);
        this.clearOutcomeUnknownPauseIfResolved();
        return { queue: publicQueueRow(savedPending), resolution: normalized, localPersistencePending: true, audit };
      }
      const checkpoint = queueRepository.checkpointDelivery({ queueId: row.id, expectedQueueState: 'platform_accepted_local_pending', queueState: 'sent',
        messageDeliveryStatus: 'sent', platformMessageId, requireMessage: needsMessageReceipt(row.payload), ...claimOf(pending) });
      const saved = checkpoint.queue;
      this.cleanupQueueMedia(row, plans);
      const audit = this.recordOutcomeAudit({
        queueId: row.id,
        resolution: normalized,
        actor: clean(options.actor, 'desktop-user'),
        reason: clean(options.reason, '用户在对应平台人工确认该消息已发送'),
        evidenceType: clean(options.evidenceType, 'manual-platform-check'),
        evidenceId: clean(options.evidenceId),
        evidence: options.evidence || {},
        previousState: 'send_outcome_unknown',
        resultingState: saved?.state || 'sent',
        platformMessageId
      });
      this.blockedPlatformAcceptances.delete(row.id);
      this.clearOutcomeUnknownPauseIfResolved();
      const output = { queue: publicQueueRow(saved), resolution: normalized, repairIds: durable.enqueued.map(item => item?.id).filter(Boolean), audit };
      this.emit(`terminal:${row.id}`, output);
      eventBus.publish('send-queue:sent', output);
      eventBus.publish('send-queue:outcome-reconciled', output);
      return output;
    }
    if (!['confirmed_not_sent', 'cancelled'].includes(normalized)) {
      throw Object.assign(new Error('发送结果不确定任务的对账结论无效'), { code: 'SEND_OUTCOME_RESOLUTION_INVALID', status: 400 });
    }
    const receiptStatus = normalized === 'confirmed_not_sent' ? 'queued' : 'cancelled';
    const saved = queueRepository.resolveOutcomeUnknown(row.id, normalized, {
      requireMessage: needsMessageReceipt(row.payload),
      messageId: row.id,
      messageDeliveryStatus: receiptStatus,
      platformMessageId: clean(options.platformMessageId || row.platform_message_id)
    });
    const audit = this.recordOutcomeAudit({
      queueId: row.id,
      resolution: normalized,
      actor: clean(options.actor, 'desktop-user'),
      reason: clean(options.reason, normalized === 'confirmed_not_sent' ? '用户在对应平台人工确认该消息未发送' : '用户取消该不确定发送任务'),
      evidenceType: clean(options.evidenceType, 'manual-platform-check'),
      evidenceId: clean(options.evidenceId),
      evidence: options.evidence || {},
      previousState: 'send_outcome_unknown',
      resultingState: saved?.state || (normalized === 'confirmed_not_sent' ? 'retry' : 'cancelled'),
      platformMessageId: clean(options.platformMessageId || row.platform_message_id)
    });
    this.blockedPlatformAcceptances.delete(row.id);
    this.clearOutcomeUnknownPauseIfResolved();
    const output = { queue: publicQueueRow(saved), resolution: normalized, audit };
    eventBus.publish('send-queue:outcome-reconciled', output);
    if (normalized === 'confirmed_not_sent') this.wake();
    else {
      this.cleanupQueueMedia(row, []);
      this.emit(`terminal:${row.id}`, output);
    }
    return output;
  }

  async recoverPlatformAcceptedLocalPending(limit = 20) {
    const rows = queueRepository.list({ state: 'platform_accepted_local_pending', limit });
    for (const row of rows) {
      row.payload = rowPayload(row);
      const plans = Array.isArray(row.payload._localPersistencePlans) ? row.payload._localPersistencePlans : [];
      if (!plans.length) {
        logger.error('send-queue', 'platform-accepted-repair-plan-missing', { id: row.id, platform: row.payload.platform, accountId: row.account_id });
        continue;
      }
      const durable = this.enqueueRepairPlans(nonReceiptPlans(plans));
      if (durable.failed.length) {
        const failure = durable.failed[0];
        queueRepository.markPlatformAcceptedLocalPending(row.id, {
          platformMessageId: row.platform_message_id,
          localPersistencePlans: plans,
          platformAcceptedAt: row.payload._platformAcceptedAt,
          error: `${failure.code}: ${failure.message}`
        }, claimOf(row));
        continue;
      }
      const checkpoint = queueRepository.checkpointDelivery({ queueId: row.id, expectedQueueState: 'platform_accepted_local_pending', queueState: 'sent',
        messageDeliveryStatus: 'sent', platformMessageId: row.platform_message_id, requireMessage: needsMessageReceipt(row.payload), ...claimOf(row) });
      const saved = checkpoint.queue;
      this.cleanupQueueMedia(row, plans);
      const output = {
        queue: publicQueueRow(saved),
        result: {
          platformMessageId: row.platform_message_id,
          localPersistencePending: true,
          localPersistenceErrorCode: '',
          repairIds: durable.enqueued.map(item => item?.id).filter(Boolean),
          recoveredFromPlatformAcceptedPending: true
        }
      };
      this.emit(`terminal:${row.id}`, output);
      eventBus.publish('send-queue:sent', output);
      eventBus.publish('send-queue:local-persistence-pending', output);
    }
  }

  async processRow(row) {
    row.payload = rowPayload(row);
    let platformAccepted = false;
    let platformMessageId = '';
    try {
      const result = await this.dispatch(row);
      platformAccepted = true;
      platformMessageId = clean(result?.key?.id || result?.messageId || result?.message_id || result?.id) || `accepted:${clean(row.payload.platform) || 'platform'}:${row.id}`;
      let localPersistencePending = result?.localPersistencePending === true;
      let localPersistenceErrorCode = clean(result?.localPersistenceErrorCode);
      const messagePlan = localPersistencePending
        ? this.repairPlan(row, 'message', {
          ...(result?.localPersistenceRepair || this.fallbackMessageRepairPayload(row, platformMessageId)),
          cleanupFile: Boolean(row.payload.mediaFile)
        })
        : null;
      const receiptPlan = needsMessageReceipt(row.payload) ? this.repairPlan(row, 'receipt', {
        kind: 'message-receipt',
        receipt: { accountId: row.account_id, chatJid: row.payload.chatJid, messageId: row.id, status: 'sent' }
      }) : null;
      const recoveryPlans = [messagePlan, receiptPlan].filter(Boolean);

      // The platform response is authoritative. Persist an acceptance journal
      // and a non-network-retry queue state before any subsequent local work.
      // A crash or local database failure after this point must never resend the
      // same text/media to the remote platform.
      let journalWritten = false;
      try {
        this.writeAcceptedJournal(row, platformMessageId, recoveryPlans);
        journalWritten = true;
      } catch (journalError) {
        logger.error('send-queue', 'platform-accepted-journal-write-failed', { id: row.id, platform: row.payload.platform, accountId: row.account_id, code: errorCode(journalError), error: journalError.message });
      }
      try {
        row = queueRepository.markPlatformAcceptedLocalPending(row.id, {
          platformMessageId,
          localPersistencePlans: recoveryPlans,
          error: localPersistencePending ? `${localPersistenceErrorCode || 'LOCAL_PERSISTENCE_PENDING'}: 平台已接受，等待本地投影持久化` : 'PLATFORM_ACCEPTED_LOCAL_FINALIZING: 平台已接受，正在完成本地回执'
        }, claimOf(row));
        row.payload = rowPayload(row);
        if (journalWritten) this.removeAcceptedJournal(row.id);
      } catch (checkpointError) {
        localPersistencePending = true;
        localPersistenceErrorCode = localPersistenceErrorCode || errorCode(checkpointError);
        logger.error('send-queue', 'platform-accepted-checkpoint-failed', { id: row.id, platform: row.payload.platform, accountId: row.account_id, platformMessageId, code: localPersistenceErrorCode, error: checkpointError.message, journalWritten });
        if (!journalWritten) return this.blockUncertainPlatformAcceptance(row, platformMessageId, checkpointError);
        return {
          queue: publicQueueRow(this.currentQueueOrRow(row)),
          result: { platformMessageId, localPersistencePending: true, localPersistenceErrorCode, repairIds: [], platformAcceptedCheckpointPending: true, automaticRetryBlocked: true }
        };
      }

      // Adapter-owned local repairs may be scheduled independently, but the
      // authoritative queue state and outbound message receipt are checkpointed
      // together below in one SQLite transaction. Never update the receipt in a
      // separate transaction after a remote platform acceptance.
      const requiredPlans = [];
      if (messagePlan) requiredPlans.push(messagePlan);

      const durable = this.enqueueRepairPlans(requiredPlans);
      if (durable.failed.length) {
        localPersistencePending = true;
        const first = durable.failed[0];
        localPersistenceErrorCode = localPersistenceErrorCode || first.code;
        const saved = queueRepository.markPlatformAcceptedLocalPending(row.id, {
          platformMessageId,
          localPersistencePlans: recoveryPlans,
          error: `${first.code}: ${first.message}`
        }, claimOf(row));
        for (const failure of durable.failed) {
          logger.error('send-queue', 'local-repair-enqueue-failed', { id: row.id, platform: row.payload.platform, accountId: row.account_id, repairId: failure.plan.id, code: failure.code, error: failure.message });
        }
        const output = {
          queue: publicQueueRow(saved),
          result: {
            platformMessageId,
            localPersistencePending: true,
            localPersistenceErrorCode,
            repairIds: durable.enqueued.map(item => item?.id).filter(Boolean)
          }
        };
        eventBus.publish('send-queue:local-persistence-pending', output);
        return output;
      }

      const checkpoint = queueRepository.checkpointDelivery({ queueId: row.id, expectedQueueState: 'platform_accepted_local_pending', queueState: 'sent',
        messageDeliveryStatus: 'sent', platformMessageId, requireMessage: needsMessageReceipt(row.payload), ...claimOf(row) });
      const saved = checkpoint.queue;
      this.cleanupQueueMedia(row, recoveryPlans);
      const output = {
        queue: publicQueueRow(saved),
        result: {
          platformMessageId,
          localPersistencePending,
          localPersistenceErrorCode,
          repairIds: durable.enqueued.map(item => item?.id).filter(Boolean)
        }
      };
      this.emit(`terminal:${row.id}`, output);
      eventBus.publish('send-queue:sent', output);
      if (localPersistencePending) eventBus.publish('send-queue:local-persistence-pending', output);
      return output;
    } catch (error) {
      const code = errorCode(error);
      if (!platformAccepted && (error?.outcomeUnknown === true || code === 'PLATFORM_EGRESS_DEADLINE_EXCEEDED')) {
        return this.blockEgressDeadlineOutcome(row, error);
      }
      if (!platformAccepted && error?.platformAccepted === true) {
        platformAccepted = true;
        platformMessageId = clean(error.platformMessageId);
        logger.error('send-queue', 'platform-accepted-before-ack-evidence-persisted', {
          id: row.id, platform: row.payload.platform, accountId: row.account_id,
          platformMessageId, code, error: error.message
        });
        return this.blockUncertainPlatformAcceptance(row, platformMessageId, error);
      }
      if (platformAccepted) {
        // Do not fall through to retry/failed after a platform acceptance. The
        // durable checkpoint or journal will recover local state without a
        // second network send.
        logger.error('send-queue', 'platform-accepted-local-finalization-failed', { id: row.id, platform: row.payload.platform, accountId: row.account_id, platformMessageId, code, error: error.message });
        return {
          queue: publicQueueRow(this.currentQueueOrRow(row)),
          result: { platformMessageId, localPersistencePending: true, localPersistenceErrorCode: code, localFinalizationFailed: true }
        };
      }
      const decision = retryDecision(row, code, this.maxAttempts);
      const waitingForConnection = WAITING_CONNECTION_ERRORS.has(code);
      const permanent = !decision.retry;
      const failurePayload = {
        success: false,
        retry: decision.retry,
        error: `${code}: ${error.message || error}`,
        nextAttemptAt: waitingForConnection ? new Date(Date.now() + 5000).toISOString() : retryDelay(row.attempts)
      };
      // A disconnected account is a liveness condition, not a network send
      // attempt. Keep the frozen retry budget intact while waiting for the
      // account to reconnect; other retryable errors still consume attempts.
      let saved;
      if (needsMessageReceipt(row.payload)) {
        const checkpoint = queueRepository.checkpointDelivery({
          queueId: row.id,
          expectedQueueState: 'sending',
          queueState: permanent ? 'failed' : 'retry',
          messageDeliveryStatus: permanent ? 'failed' : waitingForConnection ? 'queued' : 'retry',
          error: failurePayload.error,
          nextAttemptAt: failurePayload.nextAttemptAt,
          decrementAttempt: waitingForConnection && decision.retry,
          ...claimOf(row)
        });
        saved = checkpoint.queue;
      } else {
        saved = waitingForConnection && decision.retry
          ? queueRepository.defer(row.id, failurePayload, claimOf(row))
          : queueRepository.markResult(row.id, { ...failurePayload, expectedState: 'sending' }, claimOf(row));
      }
      const output = {
        queue: publicQueueRow(saved),
        error: { code, message: error.message || String(error) },
        waitingForConnection: waitingForConnection && decision.retry,
        retryDecision: decision
      };
      eventBus.publish(permanent ? 'send-queue:failed' : waitingForConnection ? 'send-queue:waiting-connection' : 'send-queue:retry', output);
      if (permanent) this.emit(`terminal:${row.id}`, output);
      logger.warn('send-queue', permanent ? 'send-failed' : waitingForConnection ? 'send-waiting-for-connection' : 'send-retry-scheduled', {
        id: row.id, platform: row.payload.platform, accountId: row.account_id, attempts: row.attempts, code,
        retryReason: decision.reasonCode, retryBudget: decision.retryBudget, maximumAttempts: decision.maximumAttempts,
        error: error.message
      });
      return output;
    }
  }

  pause(reason = 'paused') {
    const requested = clean(reason, 'paused');
    this.pausedReason = requested;
    eventBus.publish('send-queue:paused', { reason: this.pausedReason, at: nowIso() });
    return this.status();
  }
  resume(reason = 'resumed') {
    const unresolvedOutcomeUnknown = this.unresolvedOutcomeUnknownCount();
    if (unresolvedOutcomeUnknown) {
      const previous = this.pausedReason;
      this.pausedReason = OUTCOME_UNKNOWN_BLOCK_REASON;
      const status = this.status();
      eventBus.publish('send-queue:resume-blocked', { reason, previous, unresolvedOutcomeUnknown, at: nowIso() });
      return status;
    }
    const previous = this.pausedReason;
    this.pausedReason = '';
    eventBus.publish('send-queue:resumed', { reason, previous, at: nowIso() });
    this.wake();
    return this.status();
  }
  status() {
    let unknownRows = [];
    let summary = null;
    let statusError = null;
    try {
      summary = queueRepository.summary();
      unknownRows = queueRepository.list({ state: 'send_outcome_unknown', limit: 1000 });
    } catch (error) {
      statusError = { code: errorCode(error), message: error.message || String(error) };
    }
    const outcomeUnknown = statusError ? 1 : Number(summary.outcomeUnknown || 0);
    const globalOutcomeUnknown = statusError ? 1 : Number(summary.globalOutcomeUnknown || 0);
    const outcomeUnknownItems = unknownRows.map(row => ({
      ...publicQueueRow(row),
      latestAudit: (() => { try { return this.outcomeAudit?.latest?.(row.id) || null; } catch (_) { return null; } })(),
      durableSentEvidence: (() => { try { const evidence = this.sentEvidenceForRow(row); return evidence ? { eventId: evidence.eventId, idempotencyKey: evidence.idempotencyKey, platformMessageId: evidence.platformMessageId, occurredAt: evidence.occurredAt, payloadSha256: evidence.payloadSha256 } : null; } catch (_) { return null; } })()
    }));
    return {
      started: this.started, running: this.running, paused: Boolean(this.pausedReason),
      pausedReason: statusError ? 'SEND_QUEUE_STATUS_UNAVAILABLE' : this.pausedReason,
      outcomeUnknown, globalOutcomeUnknown,
      accountOutcomeUnknown: statusError ? 0 : Number(summary.allAccountOutcomeUnknown || 0),
      commandOutcomeUnknown: statusError ? 0 : Number(summary.commandOutcomeUnknown || 0),
      outcomeUnknownItems,
      outcomeUnknownItemsTruncated: !statusError && outcomeUnknown > outcomeUnknownItems.length,
      resumeBlocked: globalOutcomeUnknown > 0,
      writeBlocked: globalOutcomeUnknown > 0 || Number(summary?.allAccountOutcomeUnknown || 0) > 0 || Boolean(this.pausedReason) || Boolean(statusError),
      scopedWriteBlocked: !statusError && Number(summary?.allAccountOutcomeUnknown || 0) > 0,
      statusError,
      pending: statusError ? 0 : Number(summary.active || 0)
    };
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      this.recoverAcceptedJournals();
      await this.recoverPlatformAcceptedLocalPending(20);
      await this.reconcileOutcomeUnknownFromDurableEvidence(100);
      const unresolvedOutcomeUnknown = this.hydrateOutcomeUnknownBlockers();
      if (unresolvedOutcomeUnknown && !this.pausedReason) {
        this.pause(OUTCOME_UNKNOWN_BLOCK_REASON);
      } else if (!unresolvedOutcomeUnknown && this.pausedReason === OUTCOME_UNKNOWN_BLOCK_REASON) {
        const previous = this.pausedReason;
        this.pausedReason = '';
        eventBus.publish('send-queue:resumed', { reason: 'local-recovery-completed', previous, at: nowIso() });
      }
      if (this.pausedReason) return;
      const claimed = [];
      for (let index = 0; index < 20; index += 1) {
        const row = queueRepository.claimNext();
        if (!row) break;
        row.payload = rowPayload(row);
        claimed.push(row);
      }
      const lanes = new Map();
      for (const row of claimed) {
        const lane = `${clean(row.payload.platform, 'unknown')}:${clean(row.account_id, 'unknown')}`;
        if (!lanes.has(lane)) lanes.set(lane, []);
        lanes.get(lane).push(row);
      }
      await Promise.all([...lanes.values()].map(async rows => {
        for (const row of rows) {
          if (this.pausedReason) {
            try {
              const deferred = queueRepository.defer(row.id, {
                error: `${this.pausedReason}: 已领取但尚未开始网络发送，已安全退回重试队列`,
                nextAttemptAt: nowIso()
              }, claimOf(row));
              eventBus.publish('send-queue:dispatch-deferred', {
                reason: this.pausedReason,
                queue: publicQueueRow(deferred),
                at: nowIso()
              });
            } catch (error) {
              logger.error('send-queue', 'claimed-row-defer-failed-while-paused', {
                id: row.id,
                reason: this.pausedReason,
                code: errorCode(error),
                error: error.message
              });
            }
            continue;
          }
          await this.processRow(row);
        }
      }));
    } finally {
      this.running = false;
    }
  }
  waitForTerminal(id, timeoutMs = 7000) { const current = queueRepository.get(id); if (!current || TERMINAL.has(current.state)) return Promise.resolve({ queue: publicQueueRow(current) }); return new Promise(resolve => { const event = `terminal:${id}`; const timer = setTimeout(() => { this.removeListener(event, done); resolve({ queue: publicQueueRow(queueRepository.get(id)) }); }, Math.max(100, timeoutMs)); const done = value => { clearTimeout(timer); resolve(value); }; this.once(event, done); }); }
  list(options = {}) { return queueRepository.list(options).map(publicQueueRow); }
  async retry(id) {
    const current = queueRepository.get(id);
    const payload = rowPayload(current || {});
    const row = queueRepository.retry(id, {
      requireMessage: Boolean(current && needsMessageReceipt(payload)),
      messageId: current?.id || id,
      messageDeliveryStatus: 'queued'
    });
    if (row) {
      this.wake();
      eventBus.publish('send-queue:retry-requested', { queue: publicQueueRow(row) });
    }
    return publicQueueRow(row);
  }
  async cancel(id) {
    const current = queueRepository.get(id);
    const payload = rowPayload(current || {});
    const row = queueRepository.cancel(id, {
      requireMessage: Boolean(current && needsMessageReceipt(payload)),
      messageId: current?.id || id,
      messageDeliveryStatus: 'cancelled'
    });
    if (!row) return null;
    if (payload.mediaFile) { try { fs.rmSync(safeQueuePath(payload.mediaFile), { force: true }); } catch (_) {} }
    eventBus.publish('send-queue:cancelled', { queue: publicQueueRow(row) });
    return publicQueueRow(row);
  }
}

const singleton = new SendQueueService();
module.exports = singleton;
module.exports.SendQueueService = SendQueueService;
module.exports.retryDecision = retryDecision;
module.exports.retryClassForCode = retryClassForCode;
module.exports.publicQueueRow = publicQueueRow;
module.exports.QUEUE_MEDIA_ROOT = QUEUE_MEDIA_ROOT;
module.exports.PLATFORM_ACCEPTED_JOURNAL_ROOT = PLATFORM_ACCEPTED_JOURNAL_ROOT;
module.exports.PLATFORM_ACCEPTED_CORRUPT_ROOT = PLATFORM_ACCEPTED_CORRUPT_ROOT;
module.exports.quarantineAcceptedJournal = quarantineAcceptedJournal;
