'use strict';

const fs = require('fs');
const repository = require('../repositories/localPersistenceRepairRepository');
const messageStore = require('./messageStore');
const mediaPipeline = require('./mediaPipeline');
const eventBus = require('./eventBus');
const logger = require('./logger');

function clean(value) { return String(value == null ? '' : value).trim(); }

class LocalPersistenceRepairService {
  constructor() {
    this.started = false;
    this.running = false;
    this.timer = null;
    this.intervalMs = Math.max(500, Number(process.env.YANCE_LOCAL_REPAIR_INTERVAL_MS || 2000));
    this.maxAttempts = Math.max(1, Number(process.env.YANCE_LOCAL_REPAIR_MAX_ATTEMPTS || 20));
  }

  enqueue(input = {}) {
    const repair = repository.enqueue(input);
    eventBus.publish('local-persistence-repair:queued', { repair });
    this.wake();
    return repair;
  }

  start() {
    if (this.started) return;
    repository.ensure();
    const recovered = repository.recoverInterrupted();
    if (recovered > 0) {
      logger.warn('local-repair', 'interrupted-repairs-requeued', { recovered });
      eventBus.publish('local-persistence-repair:recovered', { recovered });
    }
    this.started = true;
    this.timer = setInterval(() => this.tick().catch(error => logger.error('local-repair', 'tick-failed', { error: error.message })), this.intervalMs);
    this.timer.unref?.();
    this.wake();
  }

  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  wake() {
    if (this.started) setImmediate(() => this.tick().catch(error => logger.error('local-repair', 'wake-failed', { error: error.message })));
  }

  async apply(repair) {
    const payload = repair.payload || {};
    const kind = clean(payload.kind);
    if (kind === 'message-upsert') {
      await messageStore.upsert(payload.message || {});
      return;
    }
    if (kind === 'message-receipt') {
      await messageStore.updateReceipt(payload.receipt || {});
      return;
    }
    if (kind === 'reaction-apply') {
      await messageStore.applyReaction(payload.reaction || {});
      return;
    }
    if (kind === 'message-revoke') {
      await messageStore.revoke(payload.revoke || {});
      return;
    }
    if (kind === 'outbound-media-upsert') {
      const message = payload.message || {};
      const source = payload.source || {};
      const descriptor = payload.descriptor || {};
      let attachment;
      if (clean(source.filePath)) {
        attachment = mediaPipeline.saveFile({
          accountId: message.accountId,
          conversationId: message.conversationId,
          messageId: message.externalMessageId || message.id,
          filePath: source.filePath,
          expectedSha256: clean(source.expectedSha256),
          descriptor
        });
      } else if (clean(source.bufferBase64)) {
        attachment = mediaPipeline.saveBuffer({
          accountId: message.accountId,
          conversationId: message.conversationId,
          messageId: message.externalMessageId || message.id,
          buffer: Buffer.from(source.bufferBase64, 'base64'),
          descriptor
        });
      } else {
        throw Object.assign(new Error('本地媒体修复缺少源文件'), { code: 'LOCAL_REPAIR_MEDIA_SOURCE_MISSING' });
      }
      await messageStore.upsert({ ...message, attachments: [attachment], mediaPath: attachment.localFile, mediaUrl: attachment.mediaUrl });
      if (payload.cleanupFile && clean(source.filePath)) fs.rmSync(source.filePath, { force: true });
      return;
    }
    throw Object.assign(new Error(`未知本地投影修复类型：${kind || 'empty'}`), { code: 'LOCAL_REPAIR_KIND_UNSUPPORTED' });
  }

  async process(repair) {
    try {
      await this.apply(repair);
      const completed = repository.complete(repair.id);
      eventBus.publish('local-persistence-repair:completed', { repair: completed });
      return completed;
    } catch (error) {
      const terminal = repair.attempts >= this.maxAttempts || ['LOCAL_REPAIR_KIND_UNSUPPORTED', 'LOCAL_REPAIR_MEDIA_SOURCE_MISSING'].includes(clean(error.code));
      const delayMs = Math.min(300000, Math.max(2000, 2 ** Math.min(repair.attempts, 8) * 1000));
      const failed = repository.fail(repair.id, `${error.code || 'LOCAL_REPAIR_FAILED'}: ${error.message}`, { terminal, delayMs });
      eventBus.publish(terminal ? 'local-persistence-repair:failed' : 'local-persistence-repair:retry', { repair: failed, error: { code: error.code || 'LOCAL_REPAIR_FAILED', message: error.message } });
      logger.warn('local-repair', terminal ? 'repair-failed' : 'repair-retry', { repairId: repair.id, queueId: repair.queueId, platform: repair.platform, attempts: repair.attempts, code: error.code || 'LOCAL_REPAIR_FAILED', error: error.message });
      return failed;
    }
  }

  async tick() {
    if (!this.started || this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        const repair = repository.claimNext();
        if (!repair) break;
        await this.process(repair);
      }
    } finally {
      this.running = false;
    }
  }

  status() {
    const rows = repository.list({ limit: 1000 });
    return {
      started: this.started,
      running: this.running,
      pending: rows.filter(row => ['pending', 'retry', 'running'].includes(row.state)).length,
      failed: rows.filter(row => row.state === 'failed').length,
      recent: rows.slice(0, 50)
    };
  }
}

module.exports = new LocalPersistenceRepairService();
module.exports.LocalPersistenceRepairService = LocalPersistenceRepairService;
