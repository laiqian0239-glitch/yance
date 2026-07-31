'use strict';

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
const backgroundJobAuthority = require('./backgroundJobAuthority');

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

function eligibleModel(task, config) {
  const state = modelRegistry.read();
  const models = (state.models || []).filter(model => {
    if (model.available === false) return false;
    if (![QUALIFICATION.verified, QUALIFICATION.experimental].includes(model.qualification)) return false;
    if (!Array.isArray(model.allowedTasks) || !model.allowedTasks.includes(task)) return false;
    if (config.localOnly && model.provider !== 'ollama') return false;
    return true;
  });
  const route = state.routes?.[task] || {};
  return models.find(model => model.id === route.primary)
    || models.find(model => model.id === route.fallback)
    || models[0]
    || null;
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
  const model = eligibleModel('understanding', config);
  if (!model) {
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
      modelId: model.id,
      maxMessages: config.maxMessages,
      dedupeKey: `ai-automation:${conversationId}:${messages.at(-1)?.at || messages.length}`,
      deterministicFacts: deterministicFacts?.persisted ? deterministicFacts : undefined,
      analysisMetadata: { localOnly: config.localOnly, requiresReview: true, automatic: true },
      signal
    });
    throwIfAborted(signal);
    const current = readDocument().status;
    await persistStatus({
      processed: Number(current.processed || 0) + 1,
      lastProcessedAt: nowIso(),
      lastConversationId: conversationId,
      lastModelId: result.model?.id || model.id,
      lastModel: result.model?.name || model.name || model.id,
      lastError: '',
      lastSkipReason: ''
    });
    eventBus.publish('ai:conversation-processed', {
      conversationId,
      platform: conversation.platform,
      modelId: result.model?.id || model.id,
      model: result.model?.name || model.name || model.id,
      analysis: result.analysis,
      profile: result.profile,
      insights: result.insights
    });
    return { processed: true, ...result, modelId: result.model?.id || model.id };
  } catch (error) {
    const current = readDocument().status;
    if (signal?.aborted || ['AI_ANALYSIS_CANCELLED','JOB_CANCELLED','SUPERSEDED_BY_NEWER_INBOUND','MODEL_CANCELLED'].includes(clean(error?.code).toUpperCase())) {
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

function analysisJobIdentity(conversationId) {
  const latest = latestPeerInboundMessage(conversationId, 200);
  const entityId = clean(latest?.externalMessageId || latest?.id || latest?.dedupeKey);
  if (!entityId) return null;
  const base = {
    jobType: 'ai-conversation-analysis',
    platform: clean(latest.platform).toLowerCase() || 'unknown',
    sourceAccountId: clean(latest.accountId || latest.account_id) || 'workspace',
    conversationId: clean(conversationId),
    entityId,
    // The message repository commits this same identity in the authoritative
    // message transaction, so process death before debounce cannot lose it.
    revision: entityId,
    payload: { conversationId: clean(conversationId), messageId: entityId }
  };
  return { ...base, idempotencyKey: backgroundJobAuthority.identity(base).idempotencyKey };
}

async function runScheduledAnalysis(conversationId, identity, lease, controller) {
  const signal = controller?.signal || null;
  analysisControllers.set(conversationId, { controller, identity, lease });
  try {
    const result = await processConversation(conversationId, { signal, identity, lease });
    if (result?.cancelled === true) {
      backgroundJobAuthority.authority.cancel(identity.idempotencyKey, clean(signal?.reason?.code || signal?.reason || 'SUPERSEDED_BY_NEWER_INBOUND'));
    } else if (result?.deferred === true) {
      backgroundJobAuthority.fail(lease, { code: `AI_ANALYSIS_${clean(result.reason).toUpperCase() || 'DEFERRED'}` }, {
        retryable: true, maxAttempts: 20, retryDelayMs: 5_000, payload: { conversationId, deferred: true, reason: result.reason }
      });
    } else if (result?.reason === 'failed') {
      backgroundJobAuthority.fail(lease, { code: 'AI_ANALYSIS_FAILED', message: result.error || result.reason }, {
        retryable: true, maxAttempts: 10, retryDelayMs: 15_000, payload: { conversationId }
      });
    } else {
      backgroundJobAuthority.succeed(lease, { conversationId, processed: result?.processed === true, reason: result?.reason || '' });
    }
    return result;
  } catch (error) {
    if (signal?.aborted) {
      backgroundJobAuthority.authority.cancel(identity.idempotencyKey, clean(error?.code || signal.reason?.code || 'SUPERSEDED_BY_NEWER_INBOUND'));
      return { processed: false, cancelled: true, reason: 'cancelled-or-superseded' };
    }
    backgroundJobAuthority.fail(lease, error, { retryable: true, maxAttempts: 10, retryDelayMs: 15_000, payload: { conversationId } });
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
  const identity = analysisJobIdentity(id);
  if (!identity) return false;

  const previous = timers.get(id);
  if (previous?.timer) clearTimeout(previous.timer);
  if (previous?.identity?.idempotencyKey && previous.identity.idempotencyKey !== identity.idempotencyKey) {
    const cancelError = Object.assign(new Error('Analysis superseded by newer inbound'), { code: 'SUPERSEDED_BY_NEWER_INBOUND' });
    previous.controller?.abort?.(cancelError);
    const active = analysisControllers.get(id);
    if (active?.identity?.idempotencyKey === previous.identity.idempotencyKey) active.controller?.abort?.(cancelError);
    try {
      const cancelled = backgroundJobAuthority.authority.cancel(previous.identity.idempotencyKey, 'SUPERSEDED_BY_NEWER_INBOUND');
      if (!cancelled.updated) eventBus.publish('ai-analysis:durable-cancel-noop', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, at: nowIso() });
    } catch (error) {
      logger.error('models', 'ai-analysis-durable-cancel-failed', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, code: error.code || '', error: error.message });
      eventBus.publish('ai-analysis:durable-cancel-failed', { conversationId: id, idempotencyKey: previous.identity.idempotencyKey, code: error.code || '', at: nowIso() });
    }
  }

  const acquired = backgroundJobAuthority.begin(identity, {
    maxAttempts: 20,
    force: options.force === true,
    staleRunningMs: Math.max(10_000, Number(config.debounceMs || 2500) * 4)
  });
  if (!acquired.acquired && ['already-succeeded','failed_final','cancelled','superseded'].includes(clean(acquired.reason).toLowerCase())) {
    updateDocument(current => current).catch(() => {});
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timers.delete(id);
    updateDocument(current => current).catch(() => {});
    if (controller.signal.aborted) return;
    if (!acquired.acquired) {
      // The durable job may still be running or waiting for retry. Recheck
      // rather than losing the trigger in memory.
      setTimeout(() => schedule(id), 2_000).unref?.();
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
  const backgroundJobs = options.backgroundJobs || backgroundJobAuthority;
  const scheduleAnalysis = options.scheduleAnalysis || schedule;
  const listConversations = options.listConversations || (() => messageStore.listConversations());
  const latestInbound = options.latestPeerInbound || latestPeerInboundMessage;
  const clock = typeof options.now === 'function' ? options.now : Date.now;
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
      jobType: 'ai-conversation-analysis',
      states,
      dueBefore,
      order: 'oldest',
      limit: pageSize,
      cursor
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
    jobType: 'ai-conversation-analysis',
    states,
    order: 'oldest',
    limit: 1
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

function start() {
  if (started) return status();
  started = true;
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
  return { ...document.status, running: started, pendingConversations: timers.size, activeJobs, config: document.config };
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

module.exports = { start, stop, schedule, recoverStartupAnalyses, processConversation, status, readConfig: () => readDocument().config, updateConfig, normalizeConfig, shouldScheduleInboundMessage, translationIsPending, isSupersededAnalysisError, DEFAULTS };
