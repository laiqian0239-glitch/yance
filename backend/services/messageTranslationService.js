'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const eventBus = require('./eventBus');
const logger = require('./logger');
const aiGateway = require('./aiGateway');
const bilingualUnderstandingService = require('./bilingualUnderstandingService');
const contactLanguageAuthority = require('./contactLanguageAuthority');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');

const TRANSLATION_MODEL_TIMEOUT_MS = 180000;
const TRANSLATION_OPERATION_TYPE = 'translation.message';
const TERMINAL_OPERATION_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED']);
const EXECUTABLE_OPERATION_STATES = new Set(['SCHEDULED', 'RUNNING']);

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
    this.internalOperationAuthorityProvider = options.internalOperationAuthorityProvider || currentRuntimeInternalOperationAuthority;
    this.maxConcurrency = Math.max(1, Math.min(3, Number(options.maxConcurrency || 1)));
    this.pending = [];
    this.pendingIds = new Map();
    // Process-local execution context only. Durable lifecycle ownership lives in
    // Schema 23 through DurableInternalOperationAuthority; this map never
    // answers public read/list/cancel/retry lifecycle queries.
    this.executionContexts = new Map();
    this.active = 0;
    this.installed = false;
    this.listeners = [];
  }

  internalOperationAuthority() {
    const authority = this.internalOperationAuthorityProvider();
    if (!authority
        || typeof authority.create !== 'function'
        || typeof authority.read !== 'function'
        || typeof authority.latest !== 'function'
        || typeof authority.snapshot !== 'function'
        || typeof authority.start !== 'function'
        || typeof authority.progress !== 'function'
        || typeof authority.succeed !== 'function'
        || typeof authority.fail !== 'function'
        || typeof authority.cancel !== 'function') {
      throw Object.assign(new Error('Schema 23 translation operation authority is required'), {
        code: 'TRANSLATION_DURABLE_AUTHORITY_REQUIRED'
      });
    }
    return authority;
  }

  operationSourceHash(operation = {}) {
    const match = /^translation:([a-f0-9]{64}):[a-f0-9]{64}$/u.exec(clean(operation.objectFingerprint));
    return match?.[1] || '';
  }

  operationFingerprint(message = {}, text = translatableText(message), options = {}) {
    const sourceHash = translationSourceHash(text);
    const baseKey = translationWorkKey(message, text);
    const mode = clean(options.retryOf)
      ? `retry:${clean(options.retryOf)}`
      : options.forceNew === true
        ? `force-new:${crypto.randomUUID()}`
        : options.force === true
          ? `force:${[
              clean(message.translationOperationId),
              Number(message.translationGeneration || 0),
              clean(message.translationStatus).toLowerCase(),
              clean(message.translationUpdatedAt),
              clean(message.translationErrorCode)
            ].join('\u001f')}`
          : clean(options.previousOperationIdentity)
            ? `after:${clean(options.previousOperationIdentity)}`
            : 'normal';
    const revisionHash = crypto.createHash('sha256').update(`${baseKey}\u001f${mode}`).digest('hex');
    return `translation:${sourceHash}:${revisionHash}`;
  }

  operationStatus(operation = {}) {
    const state = clean(operation.state).toUpperCase();
    if (['CREATED', 'SCHEDULED', 'CLAIMED', 'RETRY_SCHEDULED'].includes(state)) return 'queued';
    if (['RUNNING', 'WAITING_REMOTE', 'CANCEL_REQUESTED'].includes(state)) return 'running';
    if (state === 'SUCCEEDED') return 'success';
    if (['FAILED', 'DEAD_LETTERED'].includes(state)) return 'failed';
    if (state === 'CANCELLED') return 'cancelled';
    return state ? state.toLowerCase() : '';
  }

  contextFor(operation = {}, message = null, options = {}) {
    const operationId = clean(operation.operationId || operation.executionId);
    if (!operationId) return null;
    let context = this.executionContexts.get(operationId);
    if (context) return context;
    const resolvedMessage = message || this.getMessage(operation.scopeKey);
    const text = translationEligibleMessage(resolvedMessage || {}) ? translatableText(resolvedMessage || {}) : '';
    context = {
      id: operationId,
      operationId,
      messageId: clean(operation.scopeKey),
      conversationId: clean(resolvedMessage?.sessionKey || resolvedMessage?.conversationId),
      contactId: clean(resolvedMessage?.contactId),
      translationKey: translationWorkKey(resolvedMessage || { id: operation.scopeKey }, text),
      sourceHash: this.operationSourceHash(operation) || translationSourceHash(text),
      generation: Number(operation.generation || 0),
      objectFingerprint: clean(operation.objectFingerprint),
      retryOf: clean(options.retryOf),
      options: {
        force: options.force === true,
        timeoutMs: options.timeoutMs,
        background: options.background === true
      },
      controller: new AbortController()
    };
    this.executionContexts.set(operationId, context);
    return context;
  }

  durableOperation(jobOrId) {
    const operationId = clean(typeof jobOrId === 'string'
      ? jobOrId
      : jobOrId?.operationId || jobOrId?.id);
    if (!operationId) return null;
    const operation = this.internalOperationAuthority().read(operationId);
    return operation?.operationType === TRANSLATION_OPERATION_TYPE ? operation : null;
  }

  assertTranslationAuthority(job, _store, allowedStates = ['RUNNING']) {
    if (!job) return null;
    const authority = this.internalOperationAuthority();
    const current = authority.read(clean(job.operationId || job.id));
    const latest = authority.latest({
      operationType: TRANSLATION_OPERATION_TYPE,
      scopeKey: clean(job.messageId || current?.scopeKey)
    });
    const allowed = new Set(allowedStates.map(value => clean(value).toUpperCase()));
    const actualState = clean(current?.state).toUpperCase();
    const valid = current
      && latest
      && current.operationId === latest.operationId
      && Number(current.generation || 0) === Number(job.generation || 0)
      && clean(current.objectFingerprint) === clean(job.objectFingerprint)
      && allowed.has(actualState);
    if (!valid) {
      throw Object.assign(new Error('Translation durable generation changed before message commit'), {
        code: 'STALE_TRANSLATION_RUNTIME_AT_COMMIT',
        messageId: clean(job.messageId),
        operationId: clean(job.operationId),
        expectedGeneration: Number(job.generation || 0),
        actualGeneration: Number(current?.generation || 0),
        expectedFingerprint: clean(job.objectFingerprint),
        actualFingerprint: clean(current?.objectFingerprint),
        actualState,
        latestOperationId: clean(latest?.operationId)
      });
    }
    return current;
  }

  jobSnapshot(operationOrContext) {
    if (!operationOrContext) return null;
    const operation = clean(operationOrContext.state)
      ? operationOrContext
      : this.durableOperation(operationOrContext);
    if (!operation) return null;
    const message = this.getMessage(operation.scopeKey);
    const context = this.executionContexts.get(clean(operation.operationId));
    const status = this.operationStatus(operation);
    const terminalEvent = [...(Array.isArray(operation.history) ? operation.history : [])]
      .reverse()
      .find(event => ['internal-operation-cancelled', 'internal-operation-failed'].includes(clean(event?.eventType)));
    const errorCode = clean(operation.error?.errorCode || operation.failureCode || terminalEvent?.payload?.reasonCode || terminalEvent?.payload?.errorCode);
    const sourceHash = this.operationSourceHash(operation);
    return {
      id: clean(operation.operationId),
      messageId: clean(operation.scopeKey),
      conversationId: clean(context?.conversationId || message?.sessionKey || message?.conversationId),
      contactId: clean(context?.contactId || message?.contactId),
      status,
      progress: Number(operation.progress || 0),
      createdAt: clean(operation.createdAt),
      startedAt: clean(operation.leaseStartedAt),
      finishedAt: clean(operation.completedAt),
      errorCode,
      error: errorCode ? '中文翻译任务未完成，请重试。' : '',
      retryOf: clean(context?.retryOf),
      translationKey: clean(context?.translationKey),
      sourceHash,
      operationId: clean(operation.operationId),
      generation: Number(operation.generation || 0),
      objectFingerprint: clean(operation.objectFingerprint),
      durableState: clean(operation.state).toUpperCase(),
      lifecyclePersisted: true,
      cancellable: ['SCHEDULED', 'RUNNING'].includes(clean(operation.state).toUpperCase())
    };
  }

  publishJob(jobOrOperation) {
    const snapshot = this.jobSnapshot(jobOrOperation);
    if (snapshot) eventBus.publish('translation:job-updated', snapshot);
    return snapshot;
  }

  terminalResult(operation, status, reasonCode = '') {
    const authority = this.internalOperationAuthority();
    const current = authority.read(operation.operationId);
    if (!current || TERMINAL_OPERATION_STATES.has(clean(current.state).toUpperCase())) return current;
    const options = {
      generation: Number(current.generation || 0),
      objectFingerprint: clean(current.objectFingerprint),
      reasonCode: clean(reasonCode).toUpperCase()
    };
    if (status === 'failed') {
      return authority.fail(current.operationId, { errorCode: clean(reasonCode || 'TRANSLATION_FAILED').toUpperCase() }, options).operation;
    }
    return authority.succeed(current.operationId, {
      status: clean(status || 'completed'),
      messageId: clean(current.scopeKey),
      reasonCode: clean(reasonCode).toUpperCase()
    }, options).operation;
  }

  cancelDurableOperation(operation, options = {}) {
    const authority = this.internalOperationAuthority();
    let current = operation?.operationId ? authority.read(operation.operationId) : null;
    if (!current || TERMINAL_OPERATION_STATES.has(clean(current.state).toUpperCase())) return current;
    if (clean(current.state).toUpperCase() === 'SCHEDULED') {
      current = authority.start(current.operationId, { progress: Number(current.progress || 0) }).operation;
    }
    if (!['RUNNING', 'CANCEL_REQUESTED'].includes(clean(current.state).toUpperCase())) {
      return current;
    }
    const reasonCode = clean(options.code || 'TRANSLATION_CANCELLED').toUpperCase();
    return authority.cancel(current.operationId, { reasonCode, messageId: clean(current.scopeKey) }, {
      generation: Number(current.generation || 0),
      objectFingerprint: clean(current.objectFingerprint),
      reasonCode
    }).operation;
  }

  queueOperation(operation, message, options = {}) {
    if (!operation || clean(operation.state).toUpperCase() !== 'SCHEDULED') return false;
    const context = this.contextFor(operation, message, options);
    if (!context) return false;
    const pendingOperationId = this.pendingIds.get(context.translationKey);
    if (pendingOperationId === operation.operationId) return false;
    this.pendingIds.set(context.translationKey, operation.operationId);
    this.pending.push({
      messageId: context.messageId,
      translationKey: context.translationKey,
      options: context.options,
      jobId: operation.operationId
    });
    queueMicrotask(() => this.drain());
    return true;
  }

  createJob(input, options = {}) {
    const message = typeof input === 'string' ? this.getMessage(input) : input;
    const messageId = clean(message?.id || input);
    if (!message?.id || !messageId) {
      const error = new Error('消息不存在');
      error.code = 'MESSAGE_NOT_FOUND';
      throw error;
    }
    const text = translationEligibleMessage(message) ? translatableText(message) : '';
    const sourceHash = translationSourceHash(text);
    const authority = this.internalOperationAuthority();
    const latest = authority.latest({ operationType: TRANSLATION_OPERATION_TYPE, scopeKey: messageId });
    const latestState = clean(latest?.state).toUpperCase();
    const latestSourceHash = this.operationSourceHash(latest || {});
    if (latest && !TERMINAL_OPERATION_STATES.has(latestState) && latestSourceHash === sourceHash && options.forceNew !== true) {
      this.contextFor(latest, message, options);
      this.queueOperation(latest, message, options);
      return this.jobSnapshot(latest);
    }
    if (latest && !TERMINAL_OPERATION_STATES.has(latestState)) {
      this.cancelDurableOperation(latest, {
        code: 'TRANSLATION_SUPERSEDED',
        message: '较新的翻译任务已接管该消息'
      });
    }

    const previousOperationIdentity = latest && TERMINAL_OPERATION_STATES.has(latestState)
      ? `${clean(latest.operationId)}:${Number(latest.stateVersion || 0)}:${Number(latest.generation || 0)}`
      : '';
    const objectFingerprint = this.operationFingerprint(message, text, {
      ...options,
      previousOperationIdentity
    });
    const created = authority.create({
      operationType: TRANSLATION_OPERATION_TYPE,
      scopeKey: messageId,
      objectFingerprint,
      maxAttempts: 1,
      metadata: { messageId, progress: 0, objectFingerprint }
    });
    let operation = created.operation;
    const context = this.contextFor(operation, message, options);

    if (options.force !== true && text && translationIsFresh(message, text)
        && clean(operation.state).toUpperCase() === 'SCHEDULED') {
      operation = authority.start(operation.operationId, { progress: 100 }).operation;
      operation = authority.succeed(operation.operationId, {
        status: 'cached', messageId
      }, {
        generation: operation.generation,
        objectFingerprint: operation.objectFingerprint,
        reasonCode: 'TRANSLATION_CACHE_HIT'
      }).operation;
      this.publishJob(operation);
      return this.jobSnapshot(operation);
    }

    if (clean(operation.state).toUpperCase() === 'SCHEDULED') {
      this.queueOperation(operation, message, options);
      this.publishJob(operation);
    }
    return this.jobSnapshot(operation);
  }

  getJob(jobId) {
    const operation = this.durableOperation(jobId);
    return this.jobSnapshot(operation);
  }

  listJobs(options = {}) {
    const messageId = clean(options.messageId);
    const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
    return this.internalOperationAuthority()
      .snapshot({ operationType: TRANSLATION_OPERATION_TYPE, limit: Math.min(1000, Math.max(limit, messageId ? 1000 : limit)) })
      .filter(operation => !messageId || clean(operation.scopeKey) === messageId)
      .slice(0, limit)
      .map(operation => this.jobSnapshot(operation));
  }

  cancelJob(jobId, options = {}) {
    const operation = this.durableOperation(jobId);
    if (!operation) return null;
    if (TERMINAL_OPERATION_STATES.has(clean(operation.state).toUpperCase())) return this.jobSnapshot(operation);
    const context = this.executionContexts.get(clean(operation.operationId));
    const reasonCode = clean(options.code || 'TRANSLATION_CANCELLED').toUpperCase();
    const reason = clean(options.message || (reasonCode === 'TRANSLATION_SUPERSEDED'
      ? '较新的翻译任务已接管该消息'
      : '用户已取消翻译'));
    const message = this.getMessage(operation.scopeKey);
    const text = translationEligibleMessage(message || {}) ? translatableText(message || {}) : '';
    const store = this.storeProvider();
    let cancelled;
    const commit = () => {
      cancelled = this.cancelDurableOperation(operation, { code: reasonCode, message: reason });
      const currentMessage = store.getMessage(operation.scopeKey);
      if (currentMessage?.id) {
        const markerMatches = !clean(currentMessage.translationOperationId)
          || clean(currentMessage.translationOperationId) === clean(operation.operationId);
        if (markerMatches) {
          store.upsertMessage({
            ...stripDatabaseHelpers(currentMessage),
            sourceText: clean(currentMessage.sourceText || text || currentMessage.text),
            translationStatus: 'cancelled',
            translationErrorCode: reasonCode,
            translationError: reason,
            translationSourceHash: this.operationSourceHash(operation) || translationSourceHash(text),
            translationTargetLanguage: clean(currentMessage.translationTargetLanguage || 'zh'),
            translationOperationId: clean(operation.operationId),
            translationGeneration: Number(operation.generation || 0),
            translationObjectFingerprint: clean(operation.objectFingerprint),
            translationUpdatedAt: new Date().toISOString()
          });
        }
      }
    };
    if (typeof store.transaction === 'function') store.transaction(commit); else commit();
    try { context?.controller?.abort(Object.assign(new Error(reason), { code: reasonCode })); } catch (_) {}
    const snapshot = this.publishJob(cancelled || operation);
    const saved = this.getMessage(operation.scopeKey);
    if (saved?.id) {
      eventBus.publish('message:translation-updated', {
        messageId: saved.id,
        conversationId: saved.sessionKey || saved.conversationId,
        contactId: clean(saved.contactId),
        translation: currentTranslation(saved),
        message: saved
      });
    }
    return snapshot;
  }

  retryJob(jobId, options = {}) {
    const previous = this.durableOperation(jobId);
    if (!previous) {
      const error = new Error('翻译任务不存在');
      error.code = 'TRANSLATION_JOB_NOT_FOUND';
      throw error;
    }
    if (!TERMINAL_OPERATION_STATES.has(clean(previous.state).toUpperCase())) {
      this.cancelJob(previous.operationId, {
        code: 'TRANSLATION_SUPERSEDED',
        message: '较新的翻译任务已接管该消息'
      });
    }
    return this.createJob(previous.scopeKey, {
      force: true,
      timeoutMs: options.timeoutMs,
      background: options.background === true,
      retryOf: previous.operationId,
      forceNew: true
    });
  }

  progressJob(job, value) {
    if (!job) return null;
    const authority = this.internalOperationAuthority();
    const current = authority.read(clean(job.operationId || job.id));
    if (!current || clean(current.state).toUpperCase() !== 'RUNNING') return current;
    return authority.progress(current.operationId, Math.max(0, Math.min(100, Number(value || 0)))).operation;
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
      if (job && clean(options.terminalState)) {
        const terminalState = clean(options.terminalState).toUpperCase();
        const operation = this.assertTranslationAuthority(job, store, allowedStates);
        if (terminalState === 'FAILED') {
          const terminalError = options.terminalError || {};
          this.internalOperationAuthority().fail(operation.operationId, {
            errorCode: clean(terminalError.code || terminalError.errorCode || 'TRANSLATION_FAILED').toUpperCase()
          }, {
            generation: operation.generation,
            objectFingerprint: operation.objectFingerprint,
            reasonCode: clean(terminalError.code || terminalError.errorCode || 'TRANSLATION_FAILED').toUpperCase()
          });
        } else if (terminalState === 'SUCCEEDED') {
          this.internalOperationAuthority().succeed(operation.operationId, {
            status: clean(translation.translationStatus || 'success'),
            messageId: clean(message.id)
          }, {
            generation: operation.generation,
            objectFingerprint: operation.objectFingerprint,
            reasonCode: 'TRANSLATION_COMPLETED'
          });
        }
      }
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
    let job = null;
    let operation = null;
    if (options.jobId) {
      operation = this.durableOperation(options.jobId);
      if (!operation) {
        const error = new Error('翻译任务不存在');
        error.code = 'TRANSLATION_JOB_NOT_FOUND';
        throw error;
      }
      job = this.contextFor(operation, message, options);
      const state = clean(operation.state).toUpperCase();
      if (state === 'CANCELLED') return { status: 'cancelled', message };
      if (state === 'SCHEDULED') {
        operation = this.internalOperationAuthority().start(operation.operationId, { progress: 12 }).operation;
        job.generation = Number(operation.generation || 0);
        job.objectFingerprint = clean(operation.objectFingerprint);
      } else if (state !== 'RUNNING') {
        return { status: this.operationStatus(operation), message };
      }
      this.publishJob(operation);
    }

    if (!message?.id) {
      if (operation && clean(operation.state).toUpperCase() === 'RUNNING') {
        this.terminalResult(operation, 'failed', 'MESSAGE_NOT_FOUND');
        this.publishJob(operation.operationId);
      }
      return { status: 'not-found', message: null };
    }

    const eligible = translationEligibleMessage(message);
    const text = eligible ? translatableText(message) : '';
    if (eligible) this.languageAuthority.observeMessage(message, { store: this.storeProvider() });
    if (!eligible || !text) {
      if (operation && clean(this.durableOperation(operation.operationId)?.state).toUpperCase() === 'RUNNING') {
        const reasonCode = eligible ? 'TRANSLATION_TEXT_EMPTY' : 'TRANSLATION_MESSAGE_NOT_ELIGIBLE';
        const terminal = this.terminalResult(operation, 'skipped', reasonCode);
        this.publishJob(terminal || operation);
      }
      return { status: 'skipped', message };
    }

    const currentKey = translationWorkKey(message, text);
    if (job?.translationKey && job.translationKey !== currentKey) {
      const terminal = this.terminalResult(operation, 'skipped', 'TRANSLATION_SOURCE_CHANGED_BEFORE_START');
      this.publishJob(terminal || operation);
      this.enqueue(message, {
        background: options.background === true,
        timeoutMs: options.timeoutMs,
        force: options.force === true
      });
      return { status: 'stale', message };
    }

    const existing = currentTranslation(message);
    const sourceHash = translationSourceHash(text);
    if (options.force !== true && translationIsFresh(message, text)) {
      if (operation) {
        const terminal = this.terminalResult(operation, 'cached', 'TRANSLATION_CACHE_HIT');
        this.publishJob(terminal || operation);
      }
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
    if (job) this.publishJob(this.progressJob(job, 35) || operation);

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
    const currentOperation = job ? this.durableOperation(job.operationId) : null;

    if (job && clean(currentOperation?.state).toUpperCase() === 'CANCELLED') {
      return { status: 'cancelled', message: this.getMessage(message.id) || pendingMessage };
    }

    if (job?.controller?.signal?.aborted || result.translationStatus === 'cancelled') {
      const cancellationCode = clean(job?.controller?.signal?.reason?.code || 'TRANSLATION_CANCELLED').toUpperCase();
      let cancelledOperation = currentOperation;
      if (cancelledOperation && !TERMINAL_OPERATION_STATES.has(clean(cancelledOperation.state).toUpperCase())) {
        cancelledOperation = this.cancelDurableOperation(cancelledOperation, { code: cancellationCode });
      }
      try {
        const cancelled = this.persist(pendingMessage, {
          sourceText: text,
          sourceLanguage: clean(message.sourceLanguage || message.language),
          translatedZh: clean(existing.translatedZh),
          translationStatus: 'cancelled',
          translationModel: clean(existing.translationModel),
          translatedAt: clean(existing.translatedAt),
          translationErrorCode: cancellationCode,
          translationError: '翻译已取消'
        }, {
          job,
          expectedSourceHash: sourceHash,
          requireMarker: true,
          allowedStates: job ? ['CANCELLED'] : ['RUNNING']
        });
        if (cancelledOperation) this.publishJob(cancelledOperation);
        return { status: 'cancelled', message: cancelled };
      } catch (error) {
        if (!['STALE_TRANSLATION_RUNTIME_AT_COMMIT','STALE_TRANSLATION_SOURCE_AT_COMMIT','STALE_TRANSLATION_MARKER_AT_COMMIT'].includes(clean(error.code).toUpperCase())) throw error;
        return { status: 'stale', message: this.getMessage(message.id) || pendingMessage };
      }
    }

    if (job) this.publishJob(this.progressJob(job, 88) || currentOperation || operation);
    const latestMessage = this.getMessage(message.id) || pendingMessage;
    const latestText = translatableText(latestMessage);
    if (latestText && translationSourceHash(latestText) !== sourceHash) {
      if (operation) {
        const terminal = this.terminalResult(this.durableOperation(operation.operationId) || operation, 'skipped', 'TRANSLATION_SOURCE_CHANGED');
        this.publishJob(terminal || operation);
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
      job,
      expectedSourceHash: sourceHash,
      requireMarker: Boolean(job),
      allowedStates: ['RUNNING'],
      terminalState: job ? (result.translationStatus === 'failed' ? 'FAILED' : 'SUCCEEDED') : '',
      terminalError: result.translationStatus === 'failed'
        ? { code: result.translationErrorCode || 'TRANSLATION_FAILED', message: result.translationError || '翻译失败' }
        : null
    });
    if (job) this.publishJob(job.operationId);
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
    const pendingOperationId = this.pendingIds.get(translationKey);
    if (pendingOperationId) {
      const pendingOperation = this.durableOperation(pendingOperationId);
      if (pendingOperation && EXECUTABLE_OPERATION_STATES.has(clean(pendingOperation.state).toUpperCase())) return false;
      this.pendingIds.delete(translationKey);
    }
    const created = this.createJob(message, { ...options, forceNew: false });
    return ['SCHEDULED', 'RUNNING'].includes(clean(created?.durableState).toUpperCase());
  }

  async drain() {
    while (this.active < this.maxConcurrency && this.pending.length) {
      const item = this.pending.shift();
      const operation = item.jobId ? this.durableOperation(item.jobId) : null;
      const context = operation ? this.executionContexts.get(operation.operationId) : null;
      if (!operation || clean(operation.state).toUpperCase() === 'CANCELLED') {
        if (this.pendingIds.get(item.translationKey) === item.jobId) this.pendingIds.delete(item.translationKey);
        continue;
      }
      this.active += 1;
      Promise.resolve()
        .then(() => this.translateMessage(item.messageId, { ...item.options, jobId: item.jobId }))
        .catch(error => {
          const code = clean(error.code || 'TRANSLATION_JOB_FAILED').toUpperCase();
          const stale = ['STALE_TRANSLATION_RUNTIME_AT_COMMIT','STALE_TRANSLATION_SOURCE_AT_COMMIT','STALE_TRANSLATION_MARKER_AT_COMMIT','TRANSLATION_SUPERSEDED'].includes(code);
          try { this.settleUnexpectedFailure(item.messageId, error, context); } catch (settleError) {
            this.logger.warn('translation', 'message-translation-failure-settlement-failed', {
              messageId: item.messageId,
              code: settleError.code || 'TRANSLATION_FAILURE_SETTLEMENT_FAILED',
              error: settleError.message
            });
          }
          const current = item.jobId ? this.durableOperation(item.jobId) : null;
          if (current) this.publishJob(current);
          this.logger.warn('translation', stale ? 'message-translation-stale-result-rejected' : 'message-translation-job-failed', {
            messageId: item.messageId,
            code,
            error: error.message
          });
        })
        .finally(() => {
          if (this.pendingIds.get(item.translationKey) === item.jobId) this.pendingIds.delete(item.translationKey);
          this.active -= 1;
          this.executionContexts.delete(clean(item.jobId));
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

  recoverInterruptedTranslations() {
    return {
      scanned: 0,
      messageFailed: 0,
      lifecycleFailed: 0,
      stale: 0,
      missingMessage: 0,
      errors: [],
      delegatedTo: 'DurableExecutionRecoveryAuthority'
    };
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
    // Service shutdown is not a user cancellation. Leave Schema 23 operations
    // non-terminal so DurableExecutionRecoveryAuthority can recover them after
    // process loss/restart; only discard process-local queue bookkeeping.
    this.pending.length = 0;
    this.pendingIds.clear();
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
