'use strict';

const crypto = require('node:crypto');
const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const eventBus = require('./eventBus');
const messageStore = require('./messageStore');
const modelRegistry = require('./modelRegistry');
const aiGateway = require('./aiGateway');
const workspace = require('./workspaceService');
const workspaceData = require('./workspaceDataService');
const logger = require('./logger');
const { QUALIFICATION } = require('../../shared/constants');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');
const { currentRuntimeRecoveryAuthority } = require('./durableExecutionRecoveryAuthority');
const { getRuntimeDomainIsolationAuthority } = require('./runtimeDomainIsolationAuthority');
const modelBrainProjection = require('./modelBrainProjection');
const { getStoreManager } = require('../store/storeManagerSingleton');
const { ensureCustomerContext } = require('./storeManagerService');
const { createContextAwareReplyBrain } = require('./contextAwareReplyBrain');
const { readConversationAutomationState } = require('../store/commands/registerRuntimeStateCommands');

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  localOnly: false,
  analyzeInbound: true,
  extractFactCandidates: true,
  debounceMs: 2500,
  maxMessages: 36,
  updatedAt: ''
});

const store = new SqliteDocumentStore('ai-automation', {
  config: DEFAULTS,
  status: {
    running: false,
    pendingConversations: 0,
    processed: 0,
    skipped: 0,
    superseded: 0,
    failed: 0,
    lastProcessedAt: '',
    lastConversationId: '',
    lastModelId: '',
    lastModel: '',
    lastFactCount: 0,
    lastFactKeys: [],
    lastFactUpdatedAt: '',
    lastError: '',
    lastSkipReason: ''
  }
});

const timers = new Map();
const analysisControllers = new Map();
let started = false;
let listener = null;
let translationListener = null;
let revokeListener = null;
let activeJobs = 0;
let isolationUnsubscribe = null;
const runtimeDomainIsolationAuthority = getRuntimeDomainIsolationAuthority();

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function throwIfAborted(signal, reason = 'AI_ANALYSIS_CANCELLED') {
  if (!signal?.aborted) return;
  const source = signal.reason instanceof Error ? signal.reason : new Error(reason);
  if (!source.code) source.code = reason;
  throw source;
}
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function readDocument() {
  const document = store.read() || {};
  return {
    config: normalizeConfig(document.config || {}),
    status: { ...(document.status || {}) }
  };
}

function normalizeConfig(input = {}) {
  const localOnlyExplicit = input.localOnlyUserConfigured === true;
  return {
    ...DEFAULTS,
    ...input,
    enabled: input.enabled !== false,
    localOnly: localOnlyExplicit ? input.localOnly === true : false,
    localOnlyUserConfigured: localOnlyExplicit,
    analyzeInbound: input.analyzeInbound !== false,
    extractFactCandidates: input.extractFactCandidates === true,
    debounceMs: clamp(input.debounceMs, 500, 30000, DEFAULTS.debounceMs),
    maxMessages: clamp(input.maxMessages, 8, 120, DEFAULTS.maxMessages)
  };
}

async function updateDocument(mutator) {
  return store.update(current => {
    const document = current || {};
    const next = mutator({
      config: normalizeConfig(document.config || {}),
      status: { ...(document.status || {}) }
    }) || document;
    next.config = normalizeConfig(next.config || {});
    next.status = { ...(next.status || {}), running: started, pendingConversations: timers.size, activeJobs };
    return next;
  });
}

function eligibleModel(task, config, registryState = null) {
  const state = registryState && typeof registryState === 'object' ? registryState : modelRegistry.read();
  const constraints = {
    localOnly: config.localOnly === true,
    privacy: config.localOnly === true ? 'local' : ''
  };
  const projection = modelBrainProjection.project(state, { task, constraints });
  return projection.candidates.length ? {
    modelBrain: true,
    logicalModel: projection.logicalModel,
    candidateCount: projection.candidates.length,
    constraints
  } : null;
}
function compactMessages(conversationId, limit) {
  return messageStore.listMessages(conversationId, { limit })
    .filter(message => !message.revoked && messageSpeakerAuthority.isAnalysisMessage(message))
    .filter(message => ['text', 'image', 'gif', 'video', 'voice', 'audio', 'sticker', 'document'].includes(clean(message.type || message.messageType).toLowerCase()))
    .map(message => {
      const identity = messageSpeakerAuthority.classify(message);
      return {
        role: identity.speaker === 'self' ? '我方' : '对方',
        type: clean(message.type || message.messageType || 'text'),
        text: clean(message.translatedZh || message.text || message.transcript || message.translation || (message.type ? `[${message.type}]` : '')),
        sourceText: clean(message.sourceText || message.text || message.transcript),
        translatedZh: clean(message.translatedZh || message.translationZh),
        translationStatus: clean(message.translationStatus),
        at: clean(message.timestamp || message.sentAt)
      };
    })
    .slice(-limit);
}

function latestPeerInboundMessage(conversationId, limit = 40) {
  return messageStore.listMessages(conversationId, { limit })
    .filter(message => !message.revoked && messageSpeakerAuthority.isPeerInbound(message))
    .at(-1) || null;
}

function translationIsPending(message = {}) {
  const status = clean(message.translationStatus).toLowerCase();
  return ['queued', 'pending', 'running', 'retry_wait'].includes(status);
}

function shouldScheduleInboundMessage(message = {}) {
  return messageSpeakerAuthority.isPeerInbound(message)
    && ['whatsapp', 'telegram', 'facebook'].includes(clean(message.platform).toLowerCase());
}

function isSupersededAnalysisError(error) {
  return clean(error?.code).toUpperCase() === 'AI_STALE_RESULT';
}

function automationIsolationDecision(snapshot = runtimeDomainIsolationAuthority.snapshot()) {
  const reasons = [...new Set((Array.isArray(snapshot?.aiIsolationReasons) ? snapshot.aiIsolationReasons : []).map(clean).filter(Boolean))];
  const blocked = snapshot?.aiAutomationBlocked === true;
  return { blocked, reasons, reason: blocked ? 'ai-domain-isolated' : '' };
}

async function pauseAutomationForIsolation(snapshot = runtimeDomainIsolationAuthority.snapshot()) {
  const isolation = automationIsolationDecision(snapshot);
  if (!isolation.blocked) return { paused: false, reasons: [] };
  const error = Object.assign(new Error('AI automation paused by domain isolation authority'), {
    code: 'AI_DOMAIN_ISOLATED',
    reasons: isolation.reasons
  });
  let deferred = 0;
  for (const [conversationId, entry] of timers.entries()) {
    clearTimeout(entry?.timer || entry);
    entry?.controller?.abort?.(error);
    if (entry?.lease) {
      try {
        failCanonicalAnalysis(entry.lease, error, {
          retryable: true,
          retryDelayMs: 15_000,
          reasonCode: 'AI_DOMAIN_ISOLATED'
        });
        deferred += 1;
      } catch (failure) {
        logger.error('models', 'ai-domain-isolation-defer-failed', { conversationId, code: failure.code || '', error: failure.message });
      }
    }
  }
  timers.clear();
  for (const entry of analysisControllers.values()) entry?.controller?.abort?.(error);
  await persistStatus({ lastSkipReason: isolation.reason, lastError: '' });
  eventBus.publish('ai:automation-isolated', { reasons: isolation.reasons, deferred, activeJobs, at: nowIso() });
  return { paused: true, reasons: isolation.reasons, deferred, activeJobs };
}

function extractJson(text) {
  const raw = clean(text);
  if (!raw) return null;
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (_) {}
  }
  return null;
}

async function maybeGenerateAutomaticReplyCandidate(conversationId, conversation, latestInbound, options = {}) {
  const storeManager = getStoreManager();
  const contactId = await ensureCustomerContext(
    storeManager,
    conversationId,
    clean(conversation?.contactId || conversation?.contact_id || conversation?.customerId)
  );
  const automation = storeManager.select(state => readConversationAutomationState(state, conversationId, contactId));
  if (automation.mode !== 'AI_AUTO' || !automation.receipt?.id) {
    return { generated: false, automationMode: automation.mode, automationModeReceipt: automation.receipt || null };
  }
  if (automation.policy?.blocked === true || automation.policy?.allowReplies === false) {
    return {
      generated: false,
      reason: 'interaction-policy-blocked',
      automationMode: automation.mode,
      automationModeReceipt: { ...automation.receipt }
    };
  }

  const brain = createContextAwareReplyBrain({
    storeManager,
    aiGateway,
    resolveContactId: (nextConversationId, hint) => ensureCustomerContext(storeManager, nextConversationId, hint)
  });
  const candidate = await brain.generateCandidate({
    contactId,
    conversationId,
    incomingMessage: {
      id: clean(latestInbound?.id || latestInbound?.messageId),
      text: clean(latestInbound?.text || latestInbound?.transcript || latestInbound?.translation || latestInbound?.translatedZh),
      type: clean(latestInbound?.type || latestInbound?.messageType || 'text'),
      sentAt: clean(latestInbound?.timestamp || latestInbound?.sentAt)
    },
    platform: clean(conversation?.platform || latestInbound?.platform),
    sourceAccountId: clean(conversation?.accountId || conversation?.sourceAccountId || latestInbound?.accountId),
    source: 'ai_auto',
    signal: options.signal || null,
    aggregateIncoming: true
  });
  return {
    generated: true,
    automationMode: 'AI_AUTO',
    automationModeReceipt: { ...automation.receipt },
    candidateId: clean(candidate?.candidateId),
    taskId: clean(candidate?.taskId)
  };
}

function analysisPrompt(conversation, messages) {
  return [
    '你是言策的本地会话理解引擎。只根据提供的真实消息做审慎分析，不编造事实。',
    '输出严格JSON，字段为 summary、tone、relationshipStage、openLoops、risks、suggestedFocus、evidence。',
    'evidence必须是简短证据数组；不确定内容明确写“未知”。不要输出可直接自动发送的消息。',
    `平台：${clean(conversation?.platform) || 'unknown'}`,
    `联系人：${clean(conversation?.title) || clean(conversation?.contactName) || 'unknown'}`,
    `消息：${JSON.stringify(messages)}`
  ].join('\n');
}

async function persistStatus(patch) {
  const document = await updateDocument(current => ({
    ...current,
    status: { ...current.status, ...patch, updatedAt: nowIso() }
  }));
  eventBus.publish('ai:automation-status', document.status);
  return document.status;
}

async function processConversation(conversationId, options = {}) {
  const { config } = readDocument();
  const signal = options.signal || null;
  throwIfAborted(signal);
  if (!config.enabled || !config.analyzeInbound) {
    await persistStatus({ skipped: Number(readDocument().status.skipped || 0) + 1, lastSkipReason: 'disabled', lastConversationId: conversationId });
    return { processed: false, reason: 'disabled' };
  }
  const isolation = automationIsolationDecision();
  if (isolation.blocked) {
    const current = readDocument().status;
    await persistStatus({
      skipped: Number(current.skipped || 0) + 1,
      lastSkipReason: isolation.reason,
      lastConversationId: conversationId,
      lastError: ''
    });
    return { processed: false, reason: isolation.reason, isolationReasons: isolation.reasons };
  }
  let deterministicFacts = null;
  if (config.extractFactCandidates) {
    try {
      deterministicFacts = await workspaceData.persistDeterministicFactsForConversation(conversationId, {
        maxMessages: config.maxMessages,
        onlyLatestPeerInbound: true,
        source: 'ai-automation-inbound'
      });
      throwIfAborted(signal);
      if (deterministicFacts.persisted) {
        await persistStatus({
          lastConversationId: conversationId,
          lastFactCount: Number(deterministicFacts.facts?.length || 0),
          lastFactKeys: (deterministicFacts.facts || []).map(row => clean(row.key)).filter(Boolean),
          lastFactUpdatedAt: nowIso(),
          lastError: ''
        });
      }
    } catch (error) {
      logger.warn('models', 'ai-automation-deterministic-facts-failed', {
        conversationId,
        error: error.message,
        code: error.code || ''
      });
      await persistStatus({
        lastConversationId: conversationId,
        lastError: `事实提取失败：${clean(error.message || error)}`
      });
    }
  }
  throwIfAborted(signal);
  const latestInbound = latestPeerInboundMessage(conversationId, config.maxMessages);
  if (translationIsPending(latestInbound)) {
    schedule(conversationId);
    await persistStatus({ lastConversationId: conversationId, lastSkipReason: 'translation-pending', lastError: '' });
    return { processed: false, deferred: true, reason: 'translation-pending' };
  }
  const analysisTask = 'understanding';
  const modelBrainAvailability = eligibleModel(analysisTask, config);
  if (!modelBrainAvailability) {
    const current = readDocument().status;
    await persistStatus({ skipped: Number(current.skipped || 0) + 1, lastSkipReason: config.localOnly ? 'no-qualified-local-model' : 'no-qualified-model', lastConversationId: conversationId, lastError: '' });
    return { processed: false, reason: config.localOnly ? 'no-qualified-local-model' : 'no-qualified-model' };
  }
  const conversation = messageStore.getConversation(conversationId);
  const messages = compactMessages(conversationId, config.maxMessages);
  if (!conversation || !messages.length) {
    const current = readDocument().status;
    await persistStatus({ skipped: Number(current.skipped || 0) + 1, lastSkipReason: 'no-conversation-content', lastConversationId: conversationId });
    return { processed: false, reason: 'no-conversation-content' };
  }

  activeJobs += 1;
  await persistStatus({ lastConversationId: conversationId, lastError: '', lastSkipReason: '' });
  try {
    const result = await workspaceData.analyzeConversation(conversationId, {
      maxMessages: config.maxMessages,
      dedupeKey: `ai-automation:${conversationId}:${messages.at(-1)?.at || messages.length}`,
      deterministicFacts: deterministicFacts?.persisted ? deterministicFacts : undefined,
      analysisMetadata: { localOnly: config.localOnly, requiresReview: true, automatic: true },
      signal
    });
    throwIfAborted(signal);
    // The existing durable ai.conversation-analysis operation may succeed only after
    // an AI_AUTO reply candidate has itself reached the authoritative Store. This
    // keeps restart recovery on one orchestrator instead of an ephemeral event bridge.
    const automaticReply = await maybeGenerateAutomaticReplyCandidate(conversationId, conversation, latestInbound, { signal });
    throwIfAborted(signal);
    const current = readDocument().status;
    await persistStatus({
      processed: Number(current.processed || 0) + 1,
      lastProcessedAt: nowIso(),
      lastConversationId: conversationId,
      lastModelId: clean(result.evidence?.selectedModel || result.modelId || result.model?.id),
      lastModel: clean(result.evidence?.selectedModel || result.model || result.model?.name),
      lastError: '',
      lastSkipReason: ''
    });
    eventBus.publish('ai:conversation-processed', {
      conversationId,
      platform: conversation.platform,
      modelId: clean(result.evidence?.selectedModel || result.modelId || result.model?.id),
      model: clean(result.evidence?.selectedModel || result.model || result.model?.name),
      analysis: result.analysis,
      profile: result.profile,
      insights: result.insights,
      automaticReply
    });
    return {
      processed: true,
      ...result,
      automaticReply,
      modelId: clean(result.evidence?.selectedModel || result.modelId || result.model?.id)
    };
  } catch (error) {
    const current = readDocument().status;
    const cancellationCode = clean(error?.code || signal?.reason?.code).toUpperCase();
    if (cancellationCode === 'AI_DOMAIN_ISOLATED') {
      const isolation = automationIsolationDecision();
      await persistStatus({
        skipped: Number(current.skipped || 0) + 1,
        lastConversationId: conversationId,
        lastError: '',
        lastSkipReason: 'ai-domain-isolated'
      });
      return { processed: false, deferred: true, reason: 'ai-domain-isolated', isolationReasons: isolation.reasons };
    }
    if (signal?.aborted || ['AI_ANALYSIS_CANCELLED','JOB_CANCELLED','SUPERSEDED_BY_NEWER_INBOUND','MODEL_CANCELLED'].includes(cancellationCode)) {
      await persistStatus({
        skipped: Number(current.skipped || 0) + 1,
        superseded: Number(current.superseded || 0) + 1,
        lastConversationId: conversationId,
        lastError: '',
        lastSkipReason: 'cancelled-or-superseded'
      });
      eventBus.publish('ai:conversation-analysis-cancelled', {
        conversationId, reason: clean(error?.code || error?.message || signal?.reason || 'cancelled'), at: nowIso()
      });
      return { processed: false, cancelled: true, reason: 'cancelled-or-superseded' };
    }
    if (isSupersededAnalysisError(error)) {
      schedule(conversationId);
      await persistStatus({
        skipped: Number(current.skipped || 0) + 1,
        superseded: Number(current.superseded || 0) + 1,
        lastConversationId: conversationId,
        lastError: '',
        lastSkipReason: 'superseded'
      });
      logger.info('models', 'ai-automation-superseded', {
        conversationId,
        reason: clean(error.reason || 'SOURCE_CHANGED')
      });
      eventBus.publish('ai:conversation-superseded', {
        conversationId,
        reason: clean(error.reason || 'SOURCE_CHANGED'),
        retryScheduled: true
      });
      return {
        processed: false,
        deferred: true,
        reason: 'superseded',
        staleReason: clean(error.reason || 'SOURCE_CHANGED')
      };
    }
    await persistStatus({ failed: Number(current.failed || 0) + 1, lastConversationId: conversationId, lastError: clean(error.message || error), lastSkipReason: '' });
    logger.warn('models', 'ai-automation-failed', { conversationId, error: error.message, code: error.code || '' });
    return { processed: false, reason: 'failed', error: error.message };
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
    await updateDocument(current => current);
  }
}

function durableAnalysisIdentity(base = {}) {
  const parts = [
    base.jobType,
    base.platform,
    base.sourceAccountId,
    base.conversationId,
    base.entityId,
    base.revision
  ].map(value => clean(value));
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function analysisOperationSpec(identity = {}, maxAttempts = 20) {
  return {
    operationType: 'ai.conversation-analysis',
    scopeKey: clean(identity.conversationId),
    objectFingerprint: clean(identity.idempotencyKey),
    maxAttempts: Math.max(1, Number(maxAttempts || 20)),
    metadata: {
      accountId: clean(identity.sourceAccountId),
      messageId: clean(identity.entityId),
      resultReference: clean(identity.conversationId)
    }
  };
}

function canonicalAnalysisLease(operation = {}) {
  return Object.freeze({
    operationId: clean(operation.operationId),
    generation: Number(operation.generation || 0),
    objectFingerprint: clean(operation.objectFingerprint)
  });
}

function maybeRecoverCanonicalAnalysis(authority, operation) {
  const now = Date.now();
  const retryDue = operation?.state === 'RETRY_SCHEDULED'
    && (!operation.nextAttemptAt || Date.parse(operation.nextAttemptAt) <= now);
  const leaseExpired = operation?.state === 'RUNNING'
    && operation.leaseExpiresAt
    && Date.parse(operation.leaseExpiresAt) <= now;
  if (!retryDue && !leaseExpired) return operation;
  currentRuntimeRecoveryAuthority().recoverExecution(operation.operationId, {
    authorityTimestamp: new Date(now).toISOString()
  });
  return authority.read(operation.operationId);
}

function acquireCanonicalAnalysis(identity, options = {}) {
  const authority = currentRuntimeInternalOperationAuthority();
  const created = authority.create(analysisOperationSpec(identity, options.maxAttempts || 20));
  let operation = maybeRecoverCanonicalAnalysis(authority, created.operation);
  if (operation.state === 'SCHEDULED') {
    operation = authority.start(operation.operationId, { progress: 1 }).operation;
    return { acquired: true, reason: created.created ? 'created' : 'scheduled', operation, lease: canonicalAnalysisLease(operation) };
  }
  const reason = operation.state === 'SUCCEEDED'
    ? 'already-succeeded'
    : operation.state === 'RETRY_SCHEDULED'
      ? 'retry-wait'
      : operation.state === 'RUNNING'
        ? 'already-running'
        : ['FAILED', 'DEAD_LETTERED'].includes(operation.state)
          ? 'failed_final'
          : operation.state === 'CANCELLED'
            ? 'cancelled'
            : clean(operation.state).toLowerCase();
  return { acquired: false, reason, operation, job: operation, lease: null };
}

function failCanonicalAnalysis(lease, error, options = {}) {
  if (!lease?.operationId) return { updated: false, reason: 'missing-lease' };
  const authority = currentRuntimeInternalOperationAuthority();
  const errorCode = clean(error?.errorCode || error?.code || options.reasonCode || 'AI_ANALYSIS_FAILED').toUpperCase();
  return authority.fail(lease.operationId, { errorCode }, {
    retryable: options.retryable === true,
    retryDelayMs: Math.max(0, Number(options.retryDelayMs || 0)),
    generation: lease.generation,
    objectFingerprint: lease.objectFingerprint,
    reasonCode: errorCode
  });
}

function succeedCanonicalAnalysis(lease, result = {}) {
  if (!lease?.operationId) return { updated: false, reason: 'missing-lease' };
  return currentRuntimeInternalOperationAuthority().succeed(lease.operationId, {
    status: result?.processed === true ? 'processed' : clean(result?.status || 'completed'),
    reasonCode: clean(result?.reason || '')
  }, {
    generation: lease.generation,
    objectFingerprint: lease.objectFingerprint
  });
}

function cancelCanonicalAnalysis(identityOrLease, reason = 'CANCELLED') {
  const authority = currentRuntimeInternalOperationAuthority();
  let current = null;
  const operationId = clean(identityOrLease?.operationId);
  if (operationId) current = authority.read(operationId);
  if (!current && identityOrLease?.conversationId) {
    const candidate = authority.latest({
      operationType: 'ai.conversation-analysis',
      scopeKey: clean(identityOrLease.conversationId)
    });
    if (candidate?.objectFingerprint === clean(identityOrLease.idempotencyKey)) current = candidate;
  }
  if (!current || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].includes(current.state)) {
    return { updated: false, reason: current ? 'already-terminal' : 'not-found', operation: current };
  }
  return authority.cancel(current.operationId, { reasonCode: clean(reason).toUpperCase() || 'CANCELLED' }, {
    generation: current.generation,
    objectFingerprint: current.objectFingerprint
  });
}

function forcedAnalysisRevision(latest = {}, entityId = '') {
  const state = [
    entityId,
    clean(latest.text || latest.sourceText || latest.transcript),
    clean(latest.translatedZh || latest.translationZh || latest.translation),
    clean(latest.translationStatus).toLowerCase(),
    latest.revoked === true ? 'revoked' : 'active',
    clean(latest.revokedAt || latest.revoked_at)
  ];
  return `${entityId}:force:${crypto.createHash('sha256').update(state.join('\\u001f')).digest('hex')}`;
}

function analysisJobIdentity(conversationId, options = {}) {
  const latest = latestPeerInboundMessage(conversationId, 200);
  const entityId = clean(latest?.externalMessageId || latest?.id || latest?.dedupeKey);
  if (!entityId) return null;
  const base = {
    jobType: 'ai-conversation-analysis',
    platform: clean(latest.platform).toLowerCase() || 'unknown',
    sourceAccountId: clean(latest.accountId || latest.account_id) || 'workspace',
    conversationId: clean(conversationId),
    entityId,
    // Normal inbound acquisition must exactly match the operation committed by
    // messageRepository inside the authoritative message transaction. Forced
    // re-analysis derives a deterministic revision from persisted message
    // state instead of creating a timestamp/random duplicate execution.
    revision: options.force === true ? forcedAnalysisRevision(latest, entityId) : entityId,
    payload: { conversationId: clean(conversationId), messageId: entityId }
  };
  return { ...base, idempotencyKey: durableAnalysisIdentity(base) };
}

async function runScheduledAnalysis(conversationId, identity, lease, controller) {
  const signal = controller?.signal || null;
  analysisControllers.set(conversationId, { controller, identity, lease });
  try {
    const result = await processConversation(conversationId, { signal, identity, lease });
    if (result?.cancelled === true) {
      cancelCanonicalAnalysis(lease || identity, clean(signal?.reason?.code || signal?.reason || 'SUPERSEDED_BY_NEWER_INBOUND'));
    } else if (result?.deferred === true) {
      failCanonicalAnalysis(lease, { code: `AI_ANALYSIS_${clean(result.reason).toUpperCase() || 'DEFERRED'}` }, {
        retryable: true,
        retryDelayMs: 5_000
      });
    } else if (result?.reason === 'failed') {
      failCanonicalAnalysis(lease, { code: 'AI_ANALYSIS_FAILED' }, {
        retryable: true,
        retryDelayMs: 15_000
      });
    } else {
      succeedCanonicalAnalysis(lease, { processed: result?.processed === true, reason: result?.reason || '' });
    }
    return result;
  } catch (error) {
    const abortCode = clean(error?.code || signal?.reason?.code).toUpperCase();
    if (abortCode === 'AI_DOMAIN_ISOLATED') {
      failCanonicalAnalysis(lease, error, { retryable: true, retryDelayMs: 15_000, reasonCode: 'AI_DOMAIN_ISOLATED' });
      return { processed: false, deferred: true, reason: 'ai-domain-isolated' };
    }
    if (signal?.aborted) {
      cancelCanonicalAnalysis(lease || identity, clean(error?.code || signal.reason?.code || 'SUPERSEDED_BY_NEWER_INBOUND'));
      return { processed: false, cancelled: true, reason: 'cancelled-or-superseded' };
    }
    failCanonicalAnalysis(lease, error, { retryable: true, retryDelayMs: 15_000 });
    throw error;
  } finally {
    const current = analysisControllers.get(conversationId);
    if (current?.controller === controller) analysisControllers.delete(conversationId);
  }
}

function schedule(conversationId, options = {}) {
  const id = clean(conversationId);
  if (!id) return false;
  const { config } = readDocument();
  if (!config.enabled || !config.analyzeInbound) return false;
  const isolation = automationIsolationDecision();
  if (isolation.blocked) {
    persistStatus({ lastConversationId: id, lastSkipReason: isolation.reason, lastError: '' }).catch(() => {});
    eventBus.publish('ai:automation-isolated', { conversationId: id, reasons: isolation.reasons, at: nowIso() });
    return false;
  }
  const identity = analysisJobIdentity(id, options);
  if (!identity) return false;

  const previous = timers.get(id);
  if (previous?.timer) clearTimeout(previous.timer);
  if (previous?.identity?.idempotencyKey && previous.identity.idempotencyKey !== identity.idempotencyKey) {
    const cancelError = Object.assign(new Error('Analysis superseded by newer inbound'), { code: 'SUPERSEDED_BY_NEWER_INBOUND' });
    previous.controller?.abort?.(cancelError);
    const active = analysisControllers.get(id);
    if (active?.identity?.idempotencyKey === previous.identity.idempotencyKey) active.controller?.abort?.(cancelError);
    try {
      const cancelled = cancelCanonicalAnalysis(previous.lease || previous.identity, 'SUPERSEDED_BY_NEWER_INBOUND');
      if (!cancelled.updated) eventBus.publish('ai-analysis:durable-cancel-noop', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, at: nowIso() });
    } catch (error) {
      logger.error('models', 'ai-analysis-durable-cancel-failed', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, code: error.code || '', error: error.message });
      eventBus.publish('ai-analysis:durable-cancel-failed', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, code: error.code || '', at: nowIso() });
    }
  }

  const acquired = acquireCanonicalAnalysis(identity, { maxAttempts: 20 });
  if (!acquired.acquired && ['already-succeeded','failed_final','cancelled'].includes(clean(acquired.reason).toLowerCase())) {
    updateDocument(current => current).catch(() => {});
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timers.delete(id);
    updateDocument(current => current).catch(() => {});
    if (controller.signal.aborted) return;
    if (!acquired.acquired) {
      // The durable operation is still owned or waiting for its persisted
      // retry time. Re-acquire from Schema 23 instead of losing the trigger in
      // an in-memory debounce queue.
      setTimeout(() => schedule(id, options), 2_000).unref?.();
      return;
    }
    runScheduledAnalysis(id, identity, acquired.lease, controller).catch(error => logger.warn('models', 'ai-automation-unhandled', { conversationId: id, error: error.message }));
  }, config.debounceMs);
  timer.unref?.();
  timers.set(id, { timer, identity, lease: acquired.lease || null, controller });
  updateDocument(current => current).catch(() => {});
  return true;
}

function recoverStartupAnalyses(options = {}) {
  const isolation = automationIsolationDecision(options.domainIsolationSnapshot);
  if (isolation.blocked) {
    return { scanned: 0, recovered: 0, remaining: 0, oldestPendingAt: '', pages: 0, budgetExhausted: false, conversationsScanned: 0, blocked: true, reason: isolation.reason, isolationReasons: isolation.reasons };
  }
  const scheduleAnalysis = options.scheduleAnalysis || schedule;
  const listConversations = options.listConversations || (() => messageStore.listConversations());
  const latestInbound = options.latestPeerInbound || latestPeerInboundMessage;
  const clock = typeof options.now === 'function' ? options.now : Date.now;

  // Non-production compatibility for historical unit fixtures. Production has
  // no import or fallback to BackgroundJobAuthority; AppRuntime recovery owns
  // durable mutation before this scan executes.
  if (options.backgroundJobs) {
    const backgroundJobs = options.backgroundJobs;
    const pageSize = Math.max(1, Math.min(5000, Number(options.pageSize || 500)));
    const maxPages = Math.max(1, Number(options.maxPages || 1000));
    const timeBudgetMs = Math.max(1, Number(options.timeBudgetMs || 5000));
    const startedAt = Number(clock());
    const dueBefore = new Date(startedAt).toISOString();
    const states = ['PENDING', 'RUNNING', 'RETRY_WAIT'];
    backgroundJobs.recoverInterrupted({
      jobType: 'ai-conversation-analysis',
      staleRunningMs: 1_000,
      retryDelayMs: 1_000,
      now: startedAt
    });
    let cursor = null;
    let hasMore = true;
    let scanned = 0;
    let recovered = 0;
    let pages = 0;
    let oldestPendingAt = '';
    while (hasMore && pages < maxPages && Number(clock()) - startedAt <= timeBudgetMs) {
      const snapshot = backgroundJobs.snapshot({
        jobType: 'ai-conversation-analysis', states, dueBefore, order: 'oldest', limit: pageSize, cursor
      });
      if (!oldestPendingAt) oldestPendingAt = snapshot.oldestPendingAt || '';
      scanned += snapshot.jobs.length;
      pages += 1;
      for (const job of snapshot.jobs) {
        const conversationId = clean(job.conversationId || job.payload?.conversationId);
        if (conversationId && scheduleAnalysis(conversationId, { startupRecovery: true }) === true) recovered += 1;
      }
      hasMore = snapshot.hasMore === true;
      cursor = snapshot.nextCursor;
      if (!snapshot.jobs.length) break;
    }
    const conversations = listConversations();
    for (const conversation of conversations) {
      const id = clean(conversation.id || conversation.sessionKey);
      if (id && latestInbound(id, 1)) scheduleAnalysis(id, { startupRecovery: true });
    }
    const remainingSnapshot = backgroundJobs.snapshot({
      jobType: 'ai-conversation-analysis', states, order: 'oldest', limit: 1
    });
    return {
      scanned,
      recovered,
      remaining: Number(remainingSnapshot.total || 0),
      oldestPendingAt: remainingSnapshot.oldestPendingAt || oldestPendingAt,
      pages,
      budgetExhausted: hasMore,
      conversationsScanned: conversations.length
    };
  }

  const conversations = listConversations();
  let scanned = 0;
  let recovered = 0;
  for (const conversation of conversations) {
    const id = clean(conversation.id || conversation.sessionKey);
    if (!id || !latestInbound(id, 1)) continue;
    scanned += 1;
    if (scheduleAnalysis(id, { startupRecovery: true }) === true) recovered += 1;
  }
  const authority = currentRuntimeInternalOperationAuthority();
  const unresolved = authority.snapshot({ operationType: 'ai.conversation-analysis', limit: 1000 })
    .filter(operation => !['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].includes(operation.state));
  return {
    scanned,
    recovered,
    remaining: unresolved.length,
    oldestPendingAt: unresolved.map(operation => operation.createdAt).filter(Boolean).sort()[0] || '',
    pages: 1,
    budgetExhausted: unresolved.length >= 1000,
    conversationsScanned: conversations.length
  };
}

function start() {
  if (started) return status();
  started = true;
  isolationUnsubscribe = runtimeDomainIsolationAuthority.subscribe(snapshot => {
    const isolation = automationIsolationDecision(snapshot);
    if (isolation.blocked) {
      pauseAutomationForIsolation(snapshot).catch(error => logger.error('models', 'ai-domain-isolation-pause-failed', { code: error.code || '', error: error.message }));
    } else {
      setTimeout(() => {
        if (!started) return;
        try { recoverStartupAnalyses({ domainIsolationSnapshot: snapshot }); }
        catch (error) { logger.warn('models', 'ai-domain-isolation-resume-failed', { code: error.code || '', error: error.message }); }
      }, 0).unref?.();
    }
  });
  listener = event => {
    const message = event?.payload?.message || {};
    if (!shouldScheduleInboundMessage(message)) return;
    schedule(message.conversationId || message.sessionKey);
  };
  translationListener = event => {
    const message = event?.payload?.message || {};
    if (!shouldScheduleInboundMessage(message)) return;
    const statusValue = clean(message.translationStatus || event?.payload?.translation?.translationStatus).toLowerCase();
    if (!['success', 'failed', 'cancelled'].includes(statusValue)) return;
    schedule(message.conversationId || message.sessionKey, { force: true });
  };
  revokeListener = event => {
    const conversationId = clean(event?.payload?.conversationId || event?.payload?.sessionKey);
    if (conversationId) schedule(conversationId, { force: true });
  };
  eventBus.on('message:inserted', listener);
  eventBus.on('message:translation-updated', translationListener);
  eventBus.on('message:revoked', revokeListener);

  // Recreate durable triggers that were running when the process stopped and
  // scan persisted inbound messages so a crash between commit and debounce
  // cannot permanently skip understanding/fact extraction.
  try {
    const metrics = recoverStartupAnalyses();
    eventBus.publish('ai-analysis:startup-recovery-progress', {
      ...metrics,
      at: new Date().toISOString()
    });
  } catch (error) {
    logger.warn('models', 'ai-automation-startup-recovery-failed', { code: error.code || '', error: error.message });
  }
  updateDocument(current => current).catch(() => {});
  return status();
}

function stop() {
  if (listener) eventBus.off('message:inserted', listener);
  if (translationListener) eventBus.off('message:translation-updated', translationListener);
  if (revokeListener) eventBus.off('message:revoked', revokeListener);
  listener = null;
  translationListener = null;
  revokeListener = null;
  isolationUnsubscribe?.();
  isolationUnsubscribe = null;
  for (const entry of timers.values()) {
    clearTimeout(entry?.timer || entry);
    entry?.controller?.abort?.(Object.assign(new Error('AI automation stopped'), { code: 'AI_ANALYSIS_CANCELLED' }));
  }
  for (const entry of analysisControllers.values()) entry?.controller?.abort?.(Object.assign(new Error('AI automation stopped'), { code: 'AI_ANALYSIS_CANCELLED' }));
  timers.clear();
  analysisControllers.clear();
  started = false;
  updateDocument(current => current).catch(() => {});
  return status();
}

function status() {
  const document = readDocument();
  const isolation = automationIsolationDecision();
  return {
    ...document.status,
    running: started,
    pendingConversations: timers.size,
    activeJobs,
    config: document.config,
    aiAutomationBlocked: isolation.blocked,
    aiIsolationReasons: isolation.reasons
  };
}

async function updateConfig(patch = {}) {
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'localOnly')) normalizedPatch.localOnlyUserConfigured = true;
  const document = await updateDocument(current => ({
    ...current,
    config: normalizeConfig({ ...current.config, ...normalizedPatch, updatedAt: nowIso() })
  }));
  eventBus.publish('ai:automation-config-updated', document.config);
  return document.config;
}

module.exports = { start, stop, schedule, recoverStartupAnalyses, processConversation, status, readConfig: () => readDocument().config, updateConfig, normalizeConfig, shouldScheduleInboundMessage, translationIsPending, isSupersededAnalysisError, automationIsolationDecision, pauseAutomationForIsolation, eligibleModel, DEFAULTS };
