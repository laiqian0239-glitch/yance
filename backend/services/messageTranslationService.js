'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const eventBus = require('./eventBus');
const logger = require('./logger');
const aiGateway = require('./aiGateway');
const bilingualUnderstandingService = require('./bilingualUnderstandingService');
const contactLanguageAuthority = require('./contactLanguageAuthority');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');
const { AsyncOperationLifecycleAuthority } = require('./asyncOperationLifecycleAuthority');

const TRANSLATION_MODEL_TIMEOUT_MS = 180000;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

const MEDIA_PLACEHOLDER_PATTERN = /^\[(?:image|photo|video|audio|voice|file|document|attachment|sticker|gif|media|图片|照片|视频|音频|语音|文件|文档|附件|贴纸|动图)\]$/iu;

function translationEligibleMessage(message = {}) {
  if (!message || typeof message !== 'object') return false;
  if (message.revoked === true || message.deleted === true || String(message.deliveryStatus || message.status || '').toLowerCase() === 'revoked') return false;
  const authority = messageSpeakerAuthority.classify(message);
  if (authority.peerInbound || authority.selfOutbound) return true;

  // Historical rows created before direction normalization may not contain
  // direction/fromMe. They are still safe to translate for display when they
  // are ordinary content messages. This fallback is deliberately limited to
  // translation; facts, relationship analysis and profile projection continue
  // to require an authoritative peer/self identity.
  return authority.speaker === 'unknown' && authority.content === true;
}

function translatableText(message = {}) {
  const text = clean(message.text || message.transcript || message.caption);
  if (!text || MEDIA_PLACEHOLDER_PATTERN.test(text)) return '';
  return text;
}

function translationSourceHash(text) {
  return crypto.createHash('sha256').update(clean(text)).digest('hex');
}

function translationWorkKey(message = {}, text = translatableText(message), targetLanguage = 'zh') {
  const identity = clean(message.externalMessageId || message.platformMessageId || message.id);
  return [
    clean(message.accountId || message.sourceAccountId),
    clean(message.sessionKey || message.conversationId),
    identity,
    translationSourceHash(text),
    clean(targetLanguage || 'zh').toLowerCase()
  ].join(':');
}

function translationIsFresh(message = {}, text = translatableText(message)) {
  const current = currentTranslation(message);
  if (current.translationStatus !== 'success' || !current.translatedZh) return false;
  const expectedHash = translationSourceHash(text);
  return current.translationSourceHash
    ? current.translationSourceHash === expectedHash
    : current.sourceText === text;
}

function currentTranslation(message = {}) {
  return {
    sourceText: clean(message.sourceText || message.text),
    sourceLanguage: clean(message.sourceLanguage || message.language),
    translatedZh: clean(message.translatedZh || message.chineseTranslation || message.translationZh),
    translationStatus: clean(message.translationStatus),
    translationModel: clean(message.translationModel),
    translatedAt: clean(message.translatedAt),
    translationErrorCode: clean(message.translationErrorCode),
    translationError: clean(message.translationError),
    translationSourceHash: clean(message.translationSourceHash),
    translationTargetLanguage: clean(message.translationTargetLanguage || 'zh')
  };
}

function normalizedTranslationResult(result = {}) {
  const status = clean(result.translationStatus).toLowerCase();
  if (status === 'success') return { ...result, translationStatus: 'success' };
  if (status === 'cancelled') return { ...result, translationStatus: 'cancelled' };
  return {
    ...result,
    translatedZh: clean(result.translatedZh),
    translationStatus: 'failed',
    translationErrorCode: clean(result.translationErrorCode || (status === 'unavailable' ? 'TRANSLATION_MODEL_UNAVAILABLE' : 'TRANSLATION_FAILED')),
    translationError: clean(result.translationError || (status === 'unavailable'
      ? '当前没有可用的翻译模型，请检查本地或云端模型状态后重试。'
      : '中文翻译失败，请稍后重试。')),
    translatedAt: clean(result.translatedAt)
  };
}

function stripDatabaseHelpers(message = {}) {
  const output = { ...message };
  delete output.payload;
  delete output.payloadJson;
  return output;
}

class MessageTranslationService {
  constructor(options = {}) {
    this.storeProvider = options.storeProvider || getStore;
    this.aiGateway = options.aiGateway || aiGateway;
    this.bilingual = options.bilingualUnderstandingService || bilingualUnderstandingService;
    this.languageAuthority = options.contactLanguageAuthority || contactLanguageAuthority;
    this.logger = options.logger || logger;
    this.maxConcurrency = Math.max(1, Math.min(3, Number(options.maxConcurrency || 1)));
    this.pending = [];
    // Maps a translation work key to the currently authoritative in-memory
    // job. A simple Set is insufficient when a forced retry supersedes a
    // running job with the same source fingerprint: the old job's finally
    // handler could otherwise delete the new job's dedupe fence.
    this.pendingIds = new Map();
    this.jobs = new Map();
    this.jobRetentionLimit = Math.max(50, Number(options.jobRetentionLimit || process.env.YANCE_TRANSLATION_JOB_RETENTION || 500));
    this.jobSequence = 0;
    this.active = 0;
    this.installed = false;
    this.listeners = [];
    this.lifecycleAuthority = options.lifecycleAuthority || new AsyncOperationLifecycleAuthority();
  }

  lifecycleStore() {
    try {
      const store = this.storeProvider();
      return store?.db && typeof store.db.exec === 'function' && typeof store.db.prepare === 'function' && typeof store.transaction === 'function'
        ? store
        : null;
    } catch (_) { return null; }
  }

  fallbackLifecycleState(job) {
    const mapping = { queued: 'CREATED', running: 'RUNNING', success: 'SUCCEEDED', skipped: 'SUCCEEDED', failed: 'FAILED', cancelled: 'CANCELLED' };
    return mapping[job?.status] || '';
  }

  ensureLifecycle(job) {
    if (!job || job.operationId) return job;
    const store = this.lifecycleStore();
    if (!store) {
      // Legacy unit stores are not authoritative persistence. Production always supplies R32SqliteStore.
      job.operationId = job.id;
      job.generation = 1;
      job.objectFingerprint = job.translationKey || `${job.messageId}:${job.sourceHash}`;
      job.lifecyclePersisted = false;
      return job;
    }
    const created = this.lifecycleAuthority.create({
      operationId: job.id,
      operationType: 'translation.message',
      scopeKey: job.messageId,
      objectFingerprint: job.translationKey || `${job.messageId}:${job.sourceHash}`,
      metadata: { conversationId: job.conversationId || '', contactId: job.contactId || '', retryOf: job.retryOf || '' }
    }, store).operation;
    job.operationId = created.operationId;
    job.generation = created.generation;
    job.objectFingerprint = created.objectFingerprint;
    job.lifecyclePersisted = true;
    return job;
  }

  syncLifecycle(job) {
    if (!job) return null;
    this.ensureLifecycle(job);
    const store = this.lifecycleStore();
    if (!store || job.lifecyclePersisted === false) return { state: this.fallbackLifecycleState(job), persisted: false };
    const options = { generation: job.generation, objectFingerprint: job.objectFingerprint };
    if (job.status === 'running') {
      this.lifecycleAuthority.start(job.operationId, { progress: Math.max(1, Number(job.progress || 1)) }, store);
      this.lifecycleAuthority.progress(job.operationId, Math.max(1, Number(job.progress || 1)), store);
    } else if (job.status === 'success' || job.status === 'skipped') {
      this.lifecycleAuthority.succeed(job.operationId, { status: job.status, messageId: job.messageId }, options, store);
    } else if (job.status === 'failed') {
      this.lifecycleAuthority.fail(job.operationId, { code: job.errorCode || 'TRANSLATION_FAILED', message: job.error || '翻译失败' }, options, store);
    } else if (job.status === 'cancelled') {
      this.lifecycleAuthority.cancel(job.operationId, job.errorCode || 'TRANSLATION_CANCELLED', { ...options, message: job.error || '翻译已取消' }, store);
    }
    return this.lifecycleAuthority.read(job.operationId, store);
  }

  assertTranslationAuthority(job, store, allowedStates = ['RUNNING']) {
    if (!job || job.lifecyclePersisted === false) return null;
    const current = store.db.prepare(`SELECT operation_id,operation_type,scope_key,object_fingerprint,generation,state
      FROM async_operation_state WHERE operation_id=?`).get(clean(job.operationId));
    const latest = current ? store.db.prepare(`SELECT operation_id,generation,object_fingerprint,state
      FROM async_operation_state WHERE operation_type=? AND scope_key=? ORDER BY generation DESC LIMIT 1`)
      .get(current.operation_type, current.scope_key) : null;
    const allowed = new Set(allowedStates.map(value => clean(value).toUpperCase()));
    const valid = current
      && latest?.operation_id === current.operation_id
      && Number(current.generation || 0) === Number(job.generation || 0)
      && clean(current.object_fingerprint) === clean(job.objectFingerprint)
      && allowed.has(clean(current.state).toUpperCase());
    if (!valid) {
      throw Object.assign(new Error('Translation runtime generation changed before message commit'), {
        code: 'STALE_TRANSLATION_RUNTIME_AT_COMMIT',
        messageId: clean(job.messageId), operationId: clean(job.operationId),
        expectedGeneration: Number(job.generation || 0), actualGeneration: Number(current?.generation || 0),
        expectedFingerprint: clean(job.objectFingerprint), actualFingerprint: clean(current?.object_fingerprint),
        actualState: clean(current?.state), latestOperationId: clean(latest?.operation_id)
      });
    }
    return current;
  }

  settleLifecycleInTransaction(job, terminalState, error, store) {
    if (!job || job.lifecyclePersisted === false || !terminalState) return null;
    const options = { generation: job.generation, objectFingerprint: job.objectFingerprint };
    const target = clean(terminalState).toUpperCase();
    const result = target === 'SUCCEEDED'
      ? this.lifecycleAuthority.succeed(job.operationId, { status: 'success', messageId: job.messageId }, options, store)
      : target === 'CANCELLED'
        ? this.lifecycleAuthority.cancel(job.operationId, clean(error?.code || 'TRANSLATION_CANCELLED'), { ...options, message: clean(error?.message || '翻译已取消') }, store)
        : this.lifecycleAuthority.fail(job.operationId, { code: clean(error?.code || 'TRANSLATION_FAILED'), message: clean(error?.message || '翻译失败') }, options, store);
    if (result?.updated === false) {
      throw Object.assign(new Error('Translation lifecycle terminal CAS was rejected'), {
        code: 'STALE_TRANSLATION_RUNTIME_AT_COMMIT', operationId: clean(job.operationId),
        terminalState: target, reason: clean(result.reason), actualState: clean(result.operation?.state)
      });
    }
    return result;
  }

  jobSnapshot(job) {
    if (!job) return null;
    return {
      id: job.id,
      messageId: job.messageId,
      conversationId: job.conversationId || '',
      contactId: job.contactId || '',
      status: job.status,
      progress: Number(job.progress || 0),
      createdAt: job.createdAt,
      startedAt: job.startedAt || '',
      finishedAt: job.finishedAt || '',
      errorCode: job.errorCode || '',
      error: job.error || '',
      retryOf: job.retryOf || '',
      translationKey: job.translationKey || '',
      sourceHash: job.sourceHash || '',
      operationId: job.operationId || job.id,
      generation: Number(job.generation || 0),
      objectFingerprint: job.objectFingerprint || job.translationKey || '',
      durableState: (() => {
        if (!job.operationId) return '';
        const store = this.lifecycleStore();
        if (!store || job.lifecyclePersisted === false) return this.fallbackLifecycleState(job);
        try { return this.lifecycleAuthority.read(job.operationId, store)?.state || ''; } catch (_) { return this.fallbackLifecycleState(job); }
      })(),
      lifecyclePersisted: job.lifecyclePersisted !== false,
      cancellable: ['queued', 'running'].includes(job.status)
    };
  }

  publishJob(job) {
    try { this.syncLifecycle(job); }
    catch (error) {
      this.logger.warn('translation', 'translation-lifecycle-writeback-failed', {
        messageId: job?.messageId || '', operationId: job?.id || '', code: error.code || 'TRANSLATION_LIFECYCLE_WRITEBACK_FAILED', error: error.message
      });
    }
    const snapshot = this.jobSnapshot(job);
    if (snapshot) eventBus.publish('translation:job-updated', snapshot);
    return snapshot;
  }

  pruneJobs(limit = this.jobRetentionLimit) {
    const maximum = Math.max(1, Number(limit || this.jobRetentionLimit));
    if (this.jobs.size < maximum) return;
    const terminal = new Set(['success', 'failed', 'cancelled', 'skipped']);
    for (const [jobId, row] of this.jobs) {
      if (this.jobs.size < maximum) break;
      if (!terminal.has(row?.status)) continue;
      this.jobs.delete(jobId);
    }
  }

  createJob(input, options = {}) {
    this.pruneJobs();
    const message = typeof input === 'string' ? this.getMessage(input) : input;
    const messageId = clean(message?.id || input);
    if (!message?.id || !messageId) {
      const error = new Error('消息不存在');
      error.code = 'MESSAGE_NOT_FOUND';
      throw error;
    }
    const text = translationEligibleMessage(message) ? translatableText(message) : '';
    const translationKey = translationWorkKey(message, text);
    const activeForMessage = [...this.jobs.values()].filter(job => job.messageId === messageId && ['queued', 'running'].includes(job.status));
    const duplicate = activeForMessage.find(job => job.translationKey === translationKey);
    if (duplicate && options.forceNew !== true) return this.jobSnapshot(duplicate);
    for (const active of activeForMessage) {
      this.cancelJob(active.id, { code: 'TRANSLATION_SUPERSEDED', message: '较新的翻译任务已接管该消息' });
    }
    const createdAt = new Date().toISOString();
    if (options.force !== true && text && translationIsFresh(message, text)) {
      const completed = {
        id: `translation-${Date.now()}-${++this.jobSequence}-${Math.random().toString(16).slice(2)}`,
        messageId, conversationId: clean(message?.sessionKey || message?.conversationId), contactId: clean(message?.contactId),
        translationKey, sourceHash: translationSourceHash(text), status: 'success', progress: 100, createdAt, startedAt: createdAt, finishedAt: createdAt,
        errorCode: '', error: '', retryOf: clean(options.retryOf), options: {}, controller: new AbortController()
      };
      this.ensureLifecycle(completed);
      this.jobs.set(completed.id, completed);
      this.publishJob(completed);
      return this.jobSnapshot(completed);
    }
    const job = {
      id: `translation-${Date.now()}-${++this.jobSequence}-${Math.random().toString(16).slice(2)}`,
      messageId,
      conversationId: clean(message?.sessionKey || message?.conversationId),
      contactId: clean(message?.contactId),
      translationKey,
      sourceHash: translationSourceHash(text),
      status: 'queued',
      progress: 0,
      createdAt,
      startedAt: '',
      finishedAt: '',
      errorCode: '',
      error: '',
      retryOf: clean(options.retryOf),
      options: { force: options.force === true, timeoutMs: options.timeoutMs, background: options.background === true },
      controller: new AbortController()
    };
    this.ensureLifecycle(job);
    this.jobs.set(job.id, job);
    this.pendingIds.set(translationKey, job.id);
    this.pending.push({ messageId, translationKey, options: job.options, jobId: job.id });
    this.publishJob(job);
    queueMicrotask(() => this.drain());
    return this.jobSnapshot(job);
  }

  getJob(jobId) {
    return this.jobSnapshot(this.jobs.get(clean(jobId)));
  }

  listJobs(options = {}) {
    const messageId = clean(options.messageId);
    const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
    return [...this.jobs.values()]
      .filter(job => !messageId || job.messageId === messageId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map(job => this.jobSnapshot(job));
  }

  cancelJob(jobId, options = {}) {
    const job = this.jobs.get(clean(jobId));
    if (!job) return null;
    if (!['queued', 'running'].includes(job.status)) return this.jobSnapshot(job);
    job.status = 'cancelled';
    job.progress = Number(job.progress || 0);
    job.finishedAt = new Date().toISOString();
    job.errorCode = clean(options.code || 'TRANSLATION_CANCELLED').toUpperCase();
    job.error = clean(options.message || (job.errorCode === 'TRANSLATION_SUPERSEDED' ? '较新的翻译任务已接管该消息' : '用户已取消翻译'));
    try { job.controller.abort(Object.assign(new Error(job.error), { code: job.errorCode })); } catch (_) {}
    this.publishJob(job);
    return this.jobSnapshot(job);
  }

  retryJob(jobId, options = {}) {
    const previous = this.jobs.get(clean(jobId));
    if (!previous) {
      const error = new Error('翻译任务不存在');
      error.code = 'TRANSLATION_JOB_NOT_FOUND';
      throw error;
    }
    return this.createJob(previous.messageId, {
      force: true,
      timeoutMs: options.timeoutMs || previous.options?.timeoutMs,
      background: options.background === true || previous.options?.background === true,
      retryOf: previous.id,
      forceNew: true
    });
  }

  getMessage(messageId) {
    return this.storeProvider().getMessage(clean(messageId));
  }

  persist(message, translation, options = {}) {
    const store = this.storeProvider();
    const job = options.job || null;
    const expectedSourceHash = clean(options.expectedSourceHash || job?.sourceHash || translation.translationSourceHash);
    const allowedStates = Array.isArray(options.allowedStates) && options.allowedStates.length ? options.allowedStates : ['RUNNING'];
    const requireMarker = options.requireMarker === true;
    const commit = () => {
      const authoritative = store.getMessage(message.id) || message;
      const authoritativeText = translationEligibleMessage(authoritative) ? translatableText(authoritative) : '';
      if (expectedSourceHash && translationSourceHash(authoritativeText) !== expectedSourceHash) {
        throw Object.assign(new Error('Translation source changed before message commit'), {
          code: 'STALE_TRANSLATION_SOURCE_AT_COMMIT', messageId: clean(message.id), expectedSourceHash,
          actualSourceHash: translationSourceHash(authoritativeText)
        });
      }
      if (job) this.assertTranslationAuthority(job, store, allowedStates);
      if (job && requireMarker) {
        const markerMatches = clean(authoritative.translationOperationId) === clean(job.operationId)
          && Number(authoritative.translationGeneration || 0) === Number(job.generation || 0)
          && clean(authoritative.translationObjectFingerprint) === clean(job.objectFingerprint);
        if (!markerMatches) {
          throw Object.assign(new Error('Translation message marker changed before result commit'), {
            code: 'STALE_TRANSLATION_MARKER_AT_COMMIT', messageId: clean(message.id), operationId: clean(job.operationId)
          });
        }
      }
      const next = {
        ...stripDatabaseHelpers(authoritative),
        ...translation,
        sourceText: clean(translation.sourceText || authoritative.text),
        translationUpdatedAt: new Date().toISOString(),
        ...(job ? {
          translationOperationId: clean(job.operationId),
          translationGeneration: Number(job.generation || 0),
          translationObjectFingerprint: clean(job.objectFingerprint)
        } : {})
      };
      store.upsertMessage(next);
      if (job && options.terminalState) this.settleLifecycleInTransaction(job, options.terminalState, options.terminalError, store);
      return store.getMessage(message.id) || next;
    };
    const saved = typeof store.transaction === 'function' ? store.transaction(commit) : commit();
    eventBus.publish('message:translation-updated', {
      messageId: saved.id,
      conversationId: saved.sessionKey || saved.conversationId,
      contactId: clean(saved.contactId),
      translation: currentTranslation(saved),
      message: saved
    });
    return saved;
  }

  settleUnexpectedFailure(messageId, error = {}, job = null) {
    const code = clean(error.code || 'TRANSLATION_JOB_FAILED').toUpperCase();
    if (['TRANSLATION_CANCELLED', 'TRANSLATION_SUPERSEDED', 'MODEL_CANCELLED', 'JOB_CANCELLED',
      'STALE_TRANSLATION_RUNTIME_AT_COMMIT', 'STALE_TRANSLATION_SOURCE_AT_COMMIT', 'STALE_TRANSLATION_MARKER_AT_COMMIT'].includes(code)) return null;
    const message = this.getMessage(messageId);
    const text = translationEligibleMessage(message || {}) ? translatableText(message || {}) : '';
    if (!message?.id || !text) return null;
    const existing = currentTranslation(message);
    return this.persist(message, {
      sourceText: text,
      sourceLanguage: clean(message.sourceLanguage || message.language || existing.sourceLanguage),
      translatedZh: clean(existing.translatedZh || message.lastSuccessfulTranslatedZh),
      translationStatus: 'failed',
      translationModel: clean(existing.translationModel || message.lastSuccessfulTranslationModel),
      translatedAt: clean(existing.translatedAt || message.lastSuccessfulTranslatedAt),
      translationErrorCode: code,
      translationError: clean(error.message || '中文翻译失败，请稍后重试。'),
      translationSourceHash: translationSourceHash(text),
      translationTargetLanguage: 'zh',
      lastSuccessfulTranslatedZh: clean(message.lastSuccessfulTranslatedZh || existing.translatedZh),
      lastSuccessfulTranslationModel: clean(message.lastSuccessfulTranslationModel || existing.translationModel),
      lastSuccessfulTranslatedAt: clean(message.lastSuccessfulTranslatedAt || existing.translatedAt)
    }, {
      job,
      expectedSourceHash: job?.sourceHash || translationSourceHash(text),
      allowedStates: ['RUNNING'],
      terminalState: job ? 'FAILED' : '',
      terminalError: error
    });
  }

  async translateMessage(input, options = {}) {
    const message = typeof input === 'string' ? this.getMessage(input) : input;
    const job = options.jobId ? this.jobs.get(clean(options.jobId)) : null;
    if (job?.status === 'cancelled') return { status: 'cancelled', message };
    if (job) {
      job.status = 'running';
      job.progress = 12;
      job.startedAt = job.startedAt || new Date().toISOString();
      this.publishJob(job);
    }
    if (!message?.id) { if (job) { job.status='failed'; job.errorCode='MESSAGE_NOT_FOUND'; job.error='消息不存在'; job.finishedAt=new Date().toISOString(); this.publishJob(job); } return { status: 'not-found', message: null }; }
    const eligible = translationEligibleMessage(message);
    const text = eligible ? translatableText(message) : '';
    if (eligible) this.languageAuthority.observeMessage(message, { store: this.storeProvider() });
    else if (job) { job.status='skipped'; job.progress=100; job.finishedAt=new Date().toISOString(); job.errorCode='TRANSLATION_MESSAGE_NOT_ELIGIBLE'; job.error='系统、草稿或已撤回消息不进入自动翻译'; this.publishJob(job); }
    if (!eligible) return { status: 'skipped', message };
    if (!text) { if (job) { job.status='skipped'; job.progress=100; job.finishedAt=new Date().toISOString(); this.publishJob(job); } return { status: 'skipped', message }; }
    const currentKey = translationWorkKey(message, text);
    if (job?.translationKey && job.translationKey !== currentKey) {
      job.status = 'skipped';
      job.progress = 100;
      job.finishedAt = new Date().toISOString();
      job.errorCode = 'TRANSLATION_SOURCE_CHANGED_BEFORE_START';
      job.error = '消息内容在翻译开始前已变化，旧任务未执行';
      this.publishJob(job);
      this.enqueue(message, { background: options.background === true, timeoutMs: options.timeoutMs, force: options.force === true });
      return { status: 'stale', message };
    }
    const existing = currentTranslation(message);
    const sourceHash = translationSourceHash(text);
    if (options.force !== true && translationIsFresh(message, text)) {
      if (job) { job.status='success'; job.progress=100; job.finishedAt=new Date().toISOString(); this.publishJob(job); }
      return { status: 'cached', message };
    }
    const pendingMessage = this.persist(message, {
      sourceText: text,
      sourceLanguage: clean(message.sourceLanguage || message.language),
      translatedZh: '',
      translationStatus: 'pending',
      translationModel: '',
      translatedAt: '',
      translationErrorCode: '',
      translationError: '',
      translationSourceHash: sourceHash,
      translationTargetLanguage: 'zh',
      lastSuccessfulTranslatedZh: clean(existing.translatedZh || message.lastSuccessfulTranslatedZh),
      lastSuccessfulTranslationModel: clean(existing.translationModel || message.lastSuccessfulTranslationModel),
      lastSuccessfulTranslatedAt: clean(existing.translatedAt || message.lastSuccessfulTranslatedAt)
    }, { job, expectedSourceHash: sourceHash, allowedStates: ['RUNNING'] });
    if (job) { job.progress = 35; this.publishJob(job); }
    const rawResult = await this.bilingual.translateToChinese({
      text,
      sourceLanguage: message.sourceLanguage || message.language,
      timeoutMs: options.timeoutMs || TRANSLATION_MODEL_TIMEOUT_MS,
      background: options.background === true,
      translationProfile: options.background === true ? 'history' : 'realtime',
      signal: job?.controller?.signal || options.signal,
      dedupeKey: `message-zh:${translationWorkKey(message, text)}`,
      fingerprint: translationWorkKey(message, text)
    }, { aiGateway: this.aiGateway });
    const result = normalizedTranslationResult(rawResult);
    if (job?.controller?.signal?.aborted || job?.status === 'cancelled' || result.translationStatus === 'cancelled') {
      try {
        const cancellationCode = clean(job?.errorCode || 'TRANSLATION_CANCELLED').toUpperCase();
        const cancelled = this.persist(pendingMessage, {
          sourceText: text,
          sourceLanguage: clean(message.sourceLanguage || message.language),
          translatedZh: clean(existing.translatedZh),
          translationStatus: 'cancelled',
          translationModel: clean(existing.translationModel),
          translatedAt: clean(existing.translatedAt),
          translationErrorCode: cancellationCode,
          translationError: clean(job?.error || '翻译已取消')
        }, {
          job, expectedSourceHash: sourceHash, requireMarker: true,
          allowedStates: job ? ['CANCELLED'] : ['RUNNING'],
          terminalState: !job && result.translationStatus === 'cancelled' ? 'CANCELLED' : '',
          terminalError: { code: cancellationCode, message: clean(job?.error || '翻译已取消') }
        });
        return { status: 'cancelled', message: cancelled };
      } catch (error) {
        if (!['STALE_TRANSLATION_RUNTIME_AT_COMMIT','STALE_TRANSLATION_SOURCE_AT_COMMIT','STALE_TRANSLATION_MARKER_AT_COMMIT'].includes(clean(error.code).toUpperCase())) throw error;
        return { status: 'stale', message: this.getMessage(message.id) || pendingMessage };
      }
    }
    if (job) { job.progress = 88; this.publishJob(job); }
    const latestMessage = this.getMessage(message.id) || pendingMessage;
    const latestText = translatableText(latestMessage);
    if (latestText && translationSourceHash(latestText) !== sourceHash) {
      if (job) {
        job.status = 'skipped'; job.progress = 100; job.finishedAt = new Date().toISOString();
        job.errorCode = 'TRANSLATION_SOURCE_CHANGED'; job.error = '消息内容已变化，旧翻译结果未写入'; this.publishJob(job);
      }
      this.enqueue(latestMessage, { background: options.background === true, timeoutMs: options.timeoutMs });
      return { status: 'stale', message: latestMessage };
    }
    const saved = this.persist(latestMessage, {
      ...result,
      translationSourceHash: sourceHash,
      translationTargetLanguage: 'zh',
      lastSuccessfulTranslatedZh: result.translationStatus === 'success'
        ? clean(result.translatedZh)
        : clean(existing.translatedZh || message.lastSuccessfulTranslatedZh),
      lastSuccessfulTranslationModel: result.translationStatus === 'success'
        ? clean(result.translationModel)
        : clean(existing.translationModel || message.lastSuccessfulTranslationModel),
      lastSuccessfulTranslatedAt: result.translationStatus === 'success'
        ? clean(result.translatedAt)
        : clean(existing.translatedAt || message.lastSuccessfulTranslatedAt)
    }, {
      job, expectedSourceHash: sourceHash, requireMarker: Boolean(job), allowedStates: ['RUNNING'],
      terminalState: job ? (result.translationStatus === 'failed' ? 'FAILED' : 'SUCCEEDED') : '',
      terminalError: result.translationStatus === 'failed'
        ? { code: result.translationErrorCode || 'TRANSLATION_FAILED', message: result.translationError || '翻译失败' }
        : null
    });
    if (job) {
      job.status = result.translationStatus === 'failed' ? 'failed' : 'success';
      job.progress = result.translationStatus === 'failed' ? 88 : 100;
      job.finishedAt = new Date().toISOString();
      job.errorCode = clean(result.translationErrorCode);
      job.error = clean(result.translationError);
      this.publishJob(job);
    }
    if (result.translationStatus === 'failed') {
      this.logger.warn('translation', 'message-translation-failed', {
        messageId: message.id,
        conversationId: message.sessionKey || message.conversationId,
        code: result.translationErrorCode || 'TRANSLATION_FAILED'
      });
    }
    return { status: result.translationStatus, message: saved, translation: result };
  }

  enqueue(input, options = {}) {
    const message = typeof input === 'string' ? this.getMessage(input) : input;
    const messageId = clean(message?.id || input);
    const text = translationEligibleMessage(message || {}) ? translatableText(message || {}) : '';
    if (!messageId || !text || (options.force !== true && translationIsFresh(message, text))) return false;
    const translationKey = translationWorkKey(message, text);
    const pendingJobId = this.pendingIds.get(translationKey);
    const pendingJob = pendingJobId ? this.jobs.get(pendingJobId) : null;
    if (pendingJob && ['queued', 'running'].includes(pendingJob.status)) return false;
    if (pendingJobId) this.pendingIds.delete(translationKey);
    this.createJob(message, { ...options, forceNew: false });
    return true;
  }

  async drain() {
    while (this.active < this.maxConcurrency && this.pending.length) {
      const item = this.pending.shift();
      const job = item.jobId ? this.jobs.get(item.jobId) : null;
      if (job?.status === 'cancelled') {
        if (this.pendingIds.get(item.translationKey) === item.jobId) this.pendingIds.delete(item.translationKey);
        continue;
      }
      this.active += 1;
      Promise.resolve()
        .then(() => this.translateMessage(item.messageId, { ...item.options, jobId: item.jobId }))
        .catch(error => {
          const code = clean(error.code || 'TRANSLATION_JOB_FAILED').toUpperCase();
          const stale = ['STALE_TRANSLATION_RUNTIME_AT_COMMIT','STALE_TRANSLATION_SOURCE_AT_COMMIT','STALE_TRANSLATION_MARKER_AT_COMMIT','TRANSLATION_SUPERSEDED'].includes(code);
          try { this.settleUnexpectedFailure(item.messageId, error, job); } catch (settleError) {
            this.logger.warn('translation', 'message-translation-failure-settlement-failed', {
              messageId: item.messageId,
              code: settleError.code || 'TRANSLATION_FAILURE_SETTLEMENT_FAILED',
              error: settleError.message
            });
          }
          if (job && job.status !== 'cancelled') {
            job.status = stale ? 'skipped' : 'failed';
            job.progress = stale ? 100 : Number(job.progress || 0);
            job.errorCode = code;
            job.error = clean(error.message);
            job.finishedAt = new Date().toISOString();
            this.publishJob(job);
          }
          this.logger.warn('translation', stale ? 'message-translation-stale-result-rejected' : 'message-translation-job-failed', {
            messageId: item.messageId,
            code,
            error: error.message
          });
        })
        .finally(() => {
          if (this.pendingIds.get(item.translationKey) === item.jobId) this.pendingIds.delete(item.translationKey);
          this.active -= 1;
          this.drain();
        });
    }
  }

  enqueueRecent(options = {}) {
    const store = this.storeProvider();
    const limit = Math.max(1, Math.min(500, Number(options.limit || 120)));
    const rows = store.db.prepare(`
      SELECT id FROM r32_messages
      WHERE TRIM(text) <> ''
        AND (json_extract(payload_json, '$.translationStatus') IS NULL
          OR json_extract(payload_json, '$.translationStatus') <> 'success'
          OR COALESCE(json_extract(payload_json, '$.sourceText'), '') <> text)
      ORDER BY COALESCE(NULLIF(sent_at,''), created_at) DESC
      LIMIT ?
    `).all(limit);
    rows.reverse().forEach(row => this.enqueue(row.id, { background: true, timeoutMs: Number(options.timeoutMs || TRANSLATION_MODEL_TIMEOUT_MS) }));
    return rows.length;
  }

  recoverInterruptedTranslations(options = {}) {
    const store = this.lifecycleStore();
    const report = { scanned: 0, messageFailed: 0, lifecycleFailed: 0, stale: 0, missingMessage: 0, errors: [] };
    if (!store) return report;
    const pageLimit = Math.max(1, Math.min(500, Number(options.pageLimit || 100)));
    let cursor = null;
    do {
      const page = this.lifecycleAuthority.snapshot({
        operationType: 'translation.message',
        states: ['CREATED', 'RUNNING'],
        order: 'oldest',
        limit: pageLimit,
        cursor
      }, store);
      for (const operation of page.operations) {
        report.scanned += 1;
        const message = store.getMessage(operation.scopeKey);
        const markerMatches = message
          && clean(message.translationOperationId) === clean(operation.operationId)
          && Number(message.translationGeneration || 0) === Number(operation.generation || 0)
          && clean(message.translationObjectFingerprint) === clean(operation.objectFingerprint);
        const interruption = {
          code: 'PROCESS_RESTARTED_TRANSLATION_INTERRUPTED',
          message: '翻译任务所属进程已重启，旧执行结果已失效并等待重新排队。'
        };
        let settledWithMessage = false;
        if (message && markerMatches && clean(message.translationStatus).toLowerCase() === 'pending') {
          const text = translationEligibleMessage(message) ? translatableText(message) : '';
          const sourceHash = clean(message.translationSourceHash) || (text ? translationSourceHash(text) : '');
          const recoveryJob = {
            id: operation.operationId,
            operationId: operation.operationId,
            messageId: operation.scopeKey,
            generation: operation.generation,
            objectFingerprint: operation.objectFingerprint,
            sourceHash,
            lifecyclePersisted: true
          };
          try {
            const existing = currentTranslation(message);
            this.persist(message, {
              sourceText: text || clean(message.sourceText || message.text),
              sourceLanguage: clean(message.sourceLanguage || message.language || existing.sourceLanguage),
              translatedZh: clean(message.lastSuccessfulTranslatedZh || existing.translatedZh),
              translationStatus: 'failed',
              translationModel: clean(message.lastSuccessfulTranslationModel || existing.translationModel),
              translatedAt: clean(message.lastSuccessfulTranslatedAt || existing.translatedAt),
              translationErrorCode: interruption.code,
              translationError: interruption.message,
              translationSourceHash: sourceHash,
              translationTargetLanguage: 'zh',
              lastSuccessfulTranslatedZh: clean(message.lastSuccessfulTranslatedZh || existing.translatedZh),
              lastSuccessfulTranslationModel: clean(message.lastSuccessfulTranslationModel || existing.translationModel),
              lastSuccessfulTranslatedAt: clean(message.lastSuccessfulTranslatedAt || existing.translatedAt)
            }, {
              job: recoveryJob,
              expectedSourceHash: text && sourceHash ? sourceHash : '',
              requireMarker: true,
              allowedStates: [operation.state],
              terminalState: 'FAILED',
              terminalError: interruption
            });
            report.messageFailed += 1;
            report.lifecycleFailed += 1;
            settledWithMessage = true;
          } catch (error) {
            const code = clean(error.code || 'TRANSLATION_RECOVERY_MESSAGE_FAILED').toUpperCase();
            if (code.startsWith('STALE_TRANSLATION_')) report.stale += 1;
            else report.errors.push({ operationId: operation.operationId, messageId: operation.scopeKey, code, error: clean(error.message) });
          }
        } else if (!message) {
          report.missingMessage += 1;
        } else {
          report.stale += 1;
        }
        if (settledWithMessage) continue;
        const settled = this.lifecycleAuthority.fail(operation.operationId, interruption, {
          generation: operation.generation,
          objectFingerprint: operation.objectFingerprint
        }, store);
        if (settled.updated) report.lifecycleFailed += 1;
      }
      cursor = page.nextCursor;
    } while (cursor);
    return report;
  }

  install() {
    if (this.installed) return this;
    try {
      const recovery = this.recoverInterruptedTranslations();
      if (recovery.scanned || recovery.errors.length) {
        this.logger.info?.('translation', 'message-translation-restart-recovery', recovery);
      }
    } catch (error) {
      this.logger.warn('translation', 'message-translation-restart-recovery-failed', {
        code: error.code || 'TRANSLATION_RESTART_RECOVERY_FAILED', error: error.message
      });
    }
    this.installed = true;
    const onMessage = event => {
      const message = event?.payload?.message;
      if (message?.id && translationEligibleMessage(message) && translatableText(message)) {
        this.enqueue(message.id, { background: true, timeoutMs: TRANSLATION_MODEL_TIMEOUT_MS });
      }
    };
    eventBus.on('message:inserted', onMessage);
    eventBus.on('message:updated', onMessage);
    this.listeners.push(() => eventBus.off('message:inserted', onMessage));
    this.listeners.push(() => eventBus.off('message:updated', onMessage));
    return this;
  }

  close() {
    this.listeners.splice(0).forEach(dispose => dispose());
    for (const job of this.jobs.values()) {
      if (['queued', 'running'].includes(job.status)) this.cancelJob(job.id);
    }
    this.installed = false;
  }
}

const singleton = new MessageTranslationService();

module.exports = singleton;
module.exports.MessageTranslationService = MessageTranslationService;
module.exports.translatableText = translatableText;
module.exports.translationEligibleMessage = translationEligibleMessage;
module.exports.MEDIA_PLACEHOLDER_PATTERN = MEDIA_PLACEHOLDER_PATTERN;
module.exports.currentTranslation = currentTranslation;
module.exports.translationSourceHash = translationSourceHash;
module.exports.translationWorkKey = translationWorkKey;
module.exports.translationIsFresh = translationIsFresh;
module.exports.normalizedTranslationResult = normalizedTranslationResult;
module.exports.TRANSLATION_MODEL_TIMEOUT_MS = TRANSLATION_MODEL_TIMEOUT_MS;
