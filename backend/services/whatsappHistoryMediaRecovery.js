'use strict';

const crypto = require('crypto');
const mediaPipeline = require('./mediaPipeline');
const messageStore = require('./messageStore');
const eventBus = require('./eventBus');
const logger = require('./logger');
const backgroundJobAuthority = require('./backgroundJobAuthority');
const { reconstructBaileysMessageInfo, hasMediaEnvelope } = require('./whatsappMediaEnvelope');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_SETTLED_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_QUEUE = 600;
const DEFAULT_MAX_PER_CONVERSATION = 80;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 4;

function nowIso() { return new Date().toISOString(); }

function normalizedPriority(value) {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function jobKey(job = {}) {
  return [job.accountId, job.conversationId, job.messageId].map(value => String(value || '').trim()).join(':');
}

function mediaRevision(descriptor = {}) {
  const envelope = descriptor?.mediaEnvelope && typeof descriptor.mediaEnvelope === 'object' ? descriptor.mediaEnvelope : {};
  const source = [
    descriptor?.mediaIdentity, descriptor?.fileHash, descriptor?.directPath, descriptor?.url,
    descriptor?.mimeType, descriptor?.kind, envelope.directPath, envelope.mediaKey, envelope.fileSha256,
    envelope.fileEncSha256, envelope.mimetype
  ].map(value => Buffer.isBuffer(value) ? value.toString('base64') : String(value == null ? '' : value)).join('');
  return `media-v1:${crypto.createHash('sha256').update(source).digest('hex').slice(0, 32)}`;
}

function durableMediaJob(job = {}) {
  return {
    jobType: 'media-materialization',
    platform: 'whatsapp',
    sourceAccountId: String(job.accountId || '').trim(),
    conversationId: String(job.conversationId || '').trim(),
    entityId: String(job.messageId || '').trim(),
    revision: mediaRevision(job.descriptor),
    force: job.force === true,
    maxAttempts: Number(job.maxRetries || DEFAULT_MAX_RETRIES),
    payload: { kind: String(job.descriptor?.kind || ''), mimeType: String(job.descriptor?.mimeType || '') }
  };
}

function queuedAttachment(descriptor = {}) {
  return {
    ...descriptor,
    downloadStatus: 'queued',
    recoveryQueuedAt: descriptor.recoveryQueuedAt || nowIso(),
    recoveryStartedAt: '',
    downloadError: '',
    failedAt: '',
    retryable: true
  };
}

function recoveringAttachment(descriptor = {}) {
  return {
    ...descriptor,
    downloadStatus: 'recovering',
    recoveryStartedAt: nowIso(),
    downloadError: '',
    failedAt: ''
  };
}

function terminalAttachment(descriptor = {}, error = null, options = {}) {
  const retryCount = Math.max(0, Number(options.retryCount ?? descriptor.retryCount ?? 0));
  return {
    ...descriptor,
    downloadStatus: 'failed',
    downloadError: String(error?.code || error?.message || error || 'MEDIA_RECOVERY_FAILED'),
    failedAt: nowIso(),
    retryCount,
    nextRetryAt: options.nextRetryAt || '',
    retryable: options.retryable === true
  };
}

class WhatsAppHistoryMediaRecoveryQueue {
  constructor({
    concurrency = DEFAULT_CONCURRENCY,
    settledTtlMs = DEFAULT_SETTLED_TTL_MS,
    maxQueue = DEFAULT_MAX_QUEUE,
    maxPerConversation = DEFAULT_MAX_PER_CONVERSATION,
    queueWaitTimeoutMs = DEFAULT_QUEUE_WAIT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    media = mediaPipeline,
    store = messageStore,
    events = eventBus,
    log = logger,
    backgroundJobs = undefined
  } = {}) {
    this.concurrency = Math.max(1, Number(concurrency || DEFAULT_CONCURRENCY));
    this.settledTtlMs = Math.max(60_000, Number(settledTtlMs || DEFAULT_SETTLED_TTL_MS));
    this.maxQueue = Math.max(1, Number(maxQueue || DEFAULT_MAX_QUEUE));
    this.maxPerConversation = Math.max(1, Number(maxPerConversation || DEFAULT_MAX_PER_CONVERSATION));
    this.queueWaitTimeoutMs = Math.max(1_000, Number(queueWaitTimeoutMs || DEFAULT_QUEUE_WAIT_TIMEOUT_MS));
    this.maxRetries = Math.max(1, Number(maxRetries || DEFAULT_MAX_RETRIES));
    this.pending = [];
    this.active = 0;
    this.known = new Map();
    this.media = media;
    this.store = store;
    this.events = events;
    this.log = log;
    this.backgroundJobs = backgroundJobs === undefined
      ? (store === messageStore ? backgroundJobAuthority : null)
      : backgroundJobs;
  }

  cleanupKnown() {
    const cutoff = Date.now() - this.settledTtlMs;
    for (const [key, row] of this.known.entries()) {
      const retryDue = row.state === 'settled' && row.nextRetryAt && Date.parse(row.nextRetryAt) <= Date.now();
      if (retryDue || (row.state === 'settled' && row.at < cutoff)) this.known.delete(key);
    }
  }

  enqueue(input = {}) {
    this.cleanupKnown();
    const reconstructed = input.info || reconstructBaileysMessageInfo(input.descriptor?.mediaEnvelope);
    const job = {
      ...input,
      info: reconstructed,
      accountId: String(input.accountId || '').trim(),
      conversationId: String(input.conversationId || '').trim(),
      messageId: String(input.messageId || '').trim(),
      priority: normalizedPriority(input.priority || input.message?.timestamp || input.message?.sentAt)
    };
    const key = jobKey(job);
    if (!job.accountId || !job.conversationId || !job.messageId || !job.info || !job.socket || !job.descriptor) {
      return { queued: false, reason: 'invalid-job' };
    }
    if (this.known.has(key)) return { queued: false, reason: this.known.get(key).state };
    let durableDecision = null;
    if (this.backgroundJobs?.begin) {
      durableDecision = this.backgroundJobs.begin(durableMediaJob({ ...job, maxRetries: this.maxRetries }), {
        maxAttempts: this.maxRetries,
        force: job.force === true
      });
      if (!durableDecision.acquired) {
        return {
          queued: false,
          reason: durableDecision.reason,
          backgroundJobState: durableDecision.job?.state || '',
          nextRetryAt: durableDecision.job?.nextRetryAt || '',
          attachment: durableDecision.reason === 'retry-wait'
            ? terminalAttachment(job.descriptor, durableDecision.job?.lastErrorCode || 'MEDIA_RECOVERY_RETRY_WAIT', {
              retryable: true,
              retryCount: durableDecision.job?.attempt || job.descriptor?.retryCount || 0,
              nextRetryAt: durableDecision.job?.nextRetryAt || ''
            })
            : job.descriptor
        };
      }
      job.lease = durableDecision.lease;
    }
    const conversationDepth = this.pending.filter(row => row.accountId === job.accountId && row.conversationId === job.conversationId).length;
    if (this.pending.length >= this.maxQueue || conversationDepth >= this.maxPerConversation) {
      const code = this.pending.length >= this.maxQueue ? 'MEDIA_RECOVERY_QUEUE_FULL' : 'MEDIA_RECOVERY_CONVERSATION_LIMIT';
      const error = Object.assign(new Error(code === 'MEDIA_RECOVERY_QUEUE_FULL' ? '历史媒体恢复队列已满' : '当前会话待恢复媒体过多'), { code });
      let failure = null;
      if (job.lease && this.backgroundJobs) failure = this.backgroundJobs.fail(job.lease, error, {
        retryable: true,
        maxAttempts: this.maxRetries,
        retryDelayMs: 60_000,
        payload: { stage: code === 'MEDIA_RECOVERY_QUEUE_FULL' ? 'queue-full' : 'conversation-limit' }
      });
      const attachment = terminalAttachment(job.descriptor, error, {
        retryable: failure ? failure.retryable : true,
        retryCount: failure?.attempt || job.descriptor?.retryCount || 0,
        nextRetryAt: failure?.nextRetryAt || ''
      });
      this.known.set(key, { state: 'settled', at: Date.now() });
      this.events.publish('whatsapp:history-media-failed', {
        accountId: job.accountId, conversationId: job.conversationId, messageId: job.messageId,
        attachment, terminal: true, retryable: true
      });
      return { queued: false, reason: code === 'MEDIA_RECOVERY_QUEUE_FULL' ? 'queue-full' : 'conversation-limit', attachment };
    }

    job.queuedAtMs = Date.now();
    job.descriptor = queuedAttachment(job.descriptor);
    job.message = { ...job.message, attachments: [job.descriptor] };
    this.known.set(key, { state: 'queued', at: Date.now() });
    this.pending.push(job);
    this.pending.sort((left, right) => right.priority - left.priority);
    this.events.publish('whatsapp:history-media-queued', {
      accountId: job.accountId,
      conversationId: job.conversationId,
      messageId: job.messageId,
      queueDepth: this.pending.length,
      attachment: job.descriptor
    });
    return { queued: true, attachment: job.descriptor };
  }

  drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      this.active += 1;
      const key = jobKey(job);
      this.known.set(key, { state: 'active', at: Date.now() });
      let outcome = null;
      this.run(job)
        .then(result => { outcome = result; return result; })
        .catch(error => {
          this.log.warn('whatsapp', 'history-media-recovery-unhandled', {
            accountId: job.accountId,
            conversationId: job.conversationId,
            messageId: job.messageId,
            errorCode: error.code || error.message
          });
          outcome = { ok: false, attachment: terminalAttachment(job.descriptor, error, { retryable: true }) };
        })
        .finally(() => {
          this.active -= 1;
          this.known.set(key, { state: 'settled', at: Date.now(), nextRetryAt: outcome?.attachment?.nextRetryAt || '' });
          this.drain();
        });
    }
  }

  async persistTerminalFailure(job, error, options = {}) {
    let durableFailure = null;
    if (job.lease && this.backgroundJobs) durableFailure = this.backgroundJobs.fail(job.lease, error, {
      retryable: options.retryable === true,
      maxAttempts: this.maxRetries,
      retryDelayMs: Number(options.retryDelayMs || 5 * 60 * 1000),
      payload: { stage: options.stage || 'terminal-failure' }
    });
    const attachment = terminalAttachment(job.descriptor, error, {
      ...options,
      retryable: durableFailure ? durableFailure.retryable : options.retryable,
      retryCount: durableFailure?.attempt || options.retryCount,
      nextRetryAt: durableFailure?.nextRetryAt || options.nextRetryAt || ''
    });
    await this.store.upsert({ ...job.message, attachments: [attachment] });
    this.events.publish('whatsapp:history-media-failed', {
      accountId: job.accountId,
      conversationId: job.conversationId,
      messageId: job.messageId,
      attachment,
      terminal: true,
      retryable: attachment.retryable === true
    });
    return attachment;
  }

  async run(job) {
    if (Date.now() - Number(job.queuedAtMs || Date.now()) > this.queueWaitTimeoutMs) {
      const error = Object.assign(new Error('历史媒体等待恢复超时'), { code: 'MEDIA_RECOVERY_QUEUE_TIMEOUT' });
      return { ok: false, attachment: await this.persistTerminalFailure(job, error, { retryable: true, stage: 'queue-timeout' }) };
    }

    job.descriptor = recoveringAttachment(job.descriptor);
    job.message = { ...job.message, attachments: [job.descriptor] };
    await this.store.upsert(job.message);
    this.events.publish('whatsapp:history-media-started', {
      accountId: job.accountId, conversationId: job.conversationId, messageId: job.messageId, attachment: job.descriptor
    });

    let attachment;
    try {
      attachment = await this.media.materializeBaileys({
        accountId: job.accountId,
        conversationId: job.conversationId,
        messageId: job.messageId,
        info: job.info,
        socket: job.socket,
        descriptor: job.descriptor,
        timeoutMs: Number(job.timeoutMs || 45_000)
      });
    } catch (error) {
      attachment = terminalAttachment(job.descriptor, error, { retryable: mediaPipeline.mediaFailureRetryable(error) });
    }

    if (!attachment || attachment.downloadStatus !== 'ready') {
      const source = attachment || job.descriptor;
      const sourceRetryable = source.retryable !== false;
      let durableFailure = null;
      if (job.lease && this.backgroundJobs) durableFailure = this.backgroundJobs.fail(job.lease, {
        code: source.downloadError || 'MEDIA_RECOVERY_FAILED'
      }, {
        retryable: sourceRetryable,
        maxAttempts: this.maxRetries,
        retryDelayMs: 5 * 60 * 1000,
        maxRetryDelayMs: 6 * 60 * 60 * 1000,
        payload: { stage: 'materialize' }
      });
      const retryCount = durableFailure?.attempt || (Number(source.retryCount || job.descriptor.retryCount || 0) + 1);
      const retryable = durableFailure ? durableFailure.retryable : (sourceRetryable && retryCount < this.maxRetries);
      const delayMs = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.max(0, retryCount - 1)));
      attachment = terminalAttachment(source, source.downloadError || 'MEDIA_RECOVERY_FAILED', {
        retryable,
        retryCount,
        nextRetryAt: durableFailure?.nextRetryAt || (retryable ? new Date(Date.now() + delayMs).toISOString() : '')
      });
      await this.store.upsert({ ...job.message, attachments: [attachment] });
      this.events.publish('whatsapp:history-media-failed', {
        accountId: job.accountId,
        conversationId: job.conversationId,
        messageId: job.messageId,
        attachment,
        terminal: true
      });
      return { ok: false, attachment };
    }

    await this.store.upsert({ ...job.message, attachments: [attachment] });
    if (job.lease && this.backgroundJobs) this.backgroundJobs.succeed(job.lease, {
      status: 'ready', kind: attachment.kind || '', mimeType: attachment.mimeType || ''
    });
    this.events.publish('whatsapp:history-media-recovered', {
      accountId: job.accountId,
      conversationId: job.conversationId,
      messageId: job.messageId,
      attachment
    });
    return { ok: true, attachment };
  }

  recoverableMessages(accountId, options = {}) {
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 1200)));
    const rows = [];
    for (const conversation of this.store.listConversations({ limit: 1000 })) {
      if (String(conversation.platform || '').toLowerCase() !== 'whatsapp') continue;
      if (String(conversation.accountId || '') !== String(accountId || '')) continue;
      for (const message of this.store.listMessages(conversation.id || conversation.sessionKey, { limit: 5000 })) {
        const descriptor = Array.isArray(message.attachments) ? message.attachments[0] : null;
        const status = String(descriptor?.downloadStatus || '').toLowerCase();
        if (!descriptor || descriptor.mediaUrl || descriptor.localFile) continue;
        if (!['pending', 'queued', 'recovering', 'failed', 'remote', 'history-requested'].includes(status || 'pending')) continue;
        if (status === 'failed' && descriptor.retryable === false) continue;
        if (status === 'failed' && Number(descriptor.retryCount || 0) >= this.maxRetries) continue;
        if (status === 'failed' && descriptor.nextRetryAt && Date.parse(descriptor.nextRetryAt) > Date.now()) continue;
        rows.push({ message, descriptor, priority: normalizedPriority(message.timestamp || message.sentAt) });
      }
    }
    return rows.sort((a, b) => b.priority - a.priority).slice(0, limit);
  }

  reconcileDurableCompletions(accountId, options = {}) {
    if (!this.backgroundJobs?.snapshot || !this.backgroundJobs?.reconcileSucceeded) return { scanned: 0, reconciled: 0 };
    const jobs = this.backgroundJobs.snapshot({ jobType: 'media-materialization', sourceAccountId: accountId, limit: Number(options.limit || 1200) }).jobs
      .filter(row => row.state !== 'SUCCEEDED');
    let reconciled = 0;
    for (const job of jobs) {
      const message = this.getStoredMessage(accountId, job.conversationId, job.entityId);
      const descriptor = Array.isArray(message?.attachments) ? message.attachments[0] : null;
      const ready = String(descriptor?.downloadStatus || '').toLowerCase() === 'ready' && Boolean(descriptor?.mediaUrl || descriptor?.localFile);
      if (!ready) continue;
      const result = this.backgroundJobs.reconcileSucceeded(durableMediaJob({
        accountId,
        conversationId: job.conversationId,
        messageId: job.entityId,
        descriptor
      }), { status: 'ready-reconciled', kind: descriptor.kind || '', mimeType: descriptor.mimeType || '' });
      if (result.updated) reconciled += 1;
    }
    return { scanned: jobs.length, reconciled };
  }

  resumeAccount({ accountId, socket, limit = 600 } = {}) {
    const durableReconciliation = this.reconcileDurableCompletions(accountId, { limit: Math.max(limit, 1200) });
    const stats = { scanned: 0, queued: 0, missingEnvelope: 0, skipped: 0, durableReconciled: durableReconciliation.reconciled };
    for (const row of this.recoverableMessages(accountId, { limit })) {
      stats.scanned += 1;
      if (!hasMediaEnvelope(row.descriptor)) { stats.missingEnvelope += 1; continue; }
      const result = this.enqueue({
        accountId,
        conversationId: row.message.conversationId || row.message.sessionKey,
        messageId: row.message.id,
        descriptor: row.descriptor,
        message: row.message,
        socket,
        priority: row.priority
      });
      if (result.queued) stats.queued += 1;
      else stats.skipped += 1;
    }
    if (stats.queued) this.drain();
    this.log.info('whatsapp', 'history-media-resume-planned', { accountId, ...stats });
    this.events.publish('whatsapp:history-media-resume', { accountId, ...stats });
    return stats;
  }

  getStoredMessage(accountId, conversationId, messageId) {
    const resolvedConversationId = String(conversationId || '').trim();
    return this.store.listMessages(resolvedConversationId, { limit: 5000 }).find(row => (
      String(row.id || '') === String(messageId || '') || String(row.externalMessageId || '') === String(messageId || '')
    )) || null;
  }

  retryStored({ accountId, conversationId, messageId, socket } = {}) {
    const message = this.getStoredMessage(accountId, conversationId, messageId);
    if (!message) return { queued: false, reason: 'message-not-found' };
    const descriptor = Array.isArray(message.attachments) ? message.attachments[0] : null;
    if (!descriptor) return { queued: false, reason: 'attachment-not-found' };
    const key = jobKey({ accountId, conversationId, messageId: message.id });
    this.known.delete(key);
    if (!hasMediaEnvelope(descriptor)) return { queued: false, reason: 'media-envelope-missing', message, descriptor };
    const result = this.enqueue({ accountId, conversationId, messageId: message.id, descriptor, message, socket, priority: Date.now(), force: true });
    if (result.queued) this.drain();
    return result;
  }

  snapshot() {
    return {
      queued: this.pending.length,
      active: this.active,
      known: this.known.size,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
      maxPerConversation: this.maxPerConversation,
      queueWaitTimeoutMs: this.queueWaitTimeoutMs,
      maxRetries: this.maxRetries
    };
  }
}

const queue = new WhatsAppHistoryMediaRecoveryQueue();

module.exports = {
  WhatsAppHistoryMediaRecoveryQueue,
  queue,
  queuedAttachment,
  recoveringAttachment,
  pendingAttachment: queuedAttachment,
  terminalAttachment,
  normalizedPriority,
  mediaRevision,
  durableMediaJob,
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_PER_CONVERSATION,
  DEFAULT_QUEUE_WAIT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES
};
