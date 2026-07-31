'use strict';

const crypto = require('crypto');
const eventBus = require('./eventBus');
const domainEventLog = require('./domainEventLogService').singleton;
const accountManager = require('./accountManager');
const logger = require('./logger');
const operationalProjectionReceipts = require('./operationalProjectionReceiptAuthority');

const AUTHORITY = 'DomainOperationalEventBridge';
const PROJECTOR_NAME = 'operational-projection';
const PROJECTOR_VERSION = 'round13-v2';

function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function accountPlatform(accountId = '') {
  const id = clean(accountId);
  if (!id) return '';
  try {
    const accounts = accountManager.list()?.accounts || [];
    const row = accounts.find(account => [account.id, account.accountId, account.adapterAccountId, account.authAccountKey].map(clean).includes(id));
    return clean(row?.platform).toLowerCase();
  } catch (_) { return ''; }
}
function platformFor(type = '', payload = {}) {
  const explicit = clean(payload.platform).toLowerCase();
  if (explicit) return explicit;
  const prefix = clean(type).split(':')[0].toLowerCase();
  if (['facebook','whatsapp','telegram'].includes(prefix)) return prefix;
  return accountPlatform(payload.accountId || payload.sourceAccountId);
}
function mediaState(type = '', payload = {}) {
  const text = clean(type).toLowerCase();
  if (/failed|error/.test(text)) return 'failed';
  if (/queued/.test(text)) return 'queued';
  if (/started|resume/.test(text)) return 'running';
  if (/ready|cached|recovered|refetched/.test(text)) return 'ready';
  return clean(payload.attachment?.downloadStatus || payload.state) || 'observed';
}
function mapEvent(event = {}) {
  const type = clean(event.type);
  const payload = object(event.payload);
  const accountId = clean(payload.accountId || payload.sourceAccountId);
  if (!type || !accountId || type.startsWith('domain-event:')) return null;
  const platform = platformFor(type, payload);
  if (!platform) return null;
  if (/^(media:|facebook:media-|whatsapp:(?:media-|history-media-)|telegram:media-)/i.test(type)) {
    const attachment = object(payload.attachment);
    return {
      eventType: 'media.lifecycle.updated', platform, accountId,
      projection: {
        sourceEventType: type, accountId, conversationId: clean(payload.conversationId), messageId: clean(payload.messageId),
        state: mediaState(type, payload), kind: clean(attachment.kind), mimeType: clean(attachment.mimeType),
        downloadStatus: clean(attachment.downloadStatus), fileHash: clean(attachment.fileHash), retryable: attachment.retryable === true,
        errorCode: clean(attachment.downloadError || payload.code), observedAt: clean(event.at)
      }
    };
  }
  if (/^(whatsapp|telegram):history-synced$/i.test(type)) {
    return { eventType: 'history.sync.completed', platform, accountId, projection: { sourceEventType: type, accountId, result: payload, observedAt: clean(event.at) } };
  }
  if (/^whatsapp:ingest-error$/i.test(type) && clean(payload.scope).toLowerCase() === 'history') {
    return { eventType: 'history.sync.failed', platform, accountId, projection: { sourceEventType: type, accountId, reasonCode: clean(payload.code) || 'HISTORY_SYNC_FAILED', error: clean(payload.error), observedAt: clean(event.at) } };
  }
  if (/^facebook:reconciliation-(completed|failed)$/i.test(type)) {
    const failed = /failed$/i.test(type);
    return { eventType: failed ? 'reconcile.failed' : 'reconcile.completed', platform, accountId, projection: { sourceEventType: type, accountId, result: payload, observedAt: clean(event.at) } };
  }
  return null;
}

class DomainOperationalEventBridge {
  constructor(options = {}) {
    this.events = options.eventBus || eventBus;
    this.eventLog = options.eventLog || domainEventLog;
    this.logger = options.logger || logger;
    this.bound = null;
    this.captured = 0;
    this.failed = 0;
  }
  capture(event = {}) {
    const mapped = mapEvent(event);
    if (!mapped) return null;
    const externalEventId = clean(event.id) || crypto.randomUUID();
    try {
      const appended = this.eventLog.append({
        platform: mapped.platform,
        sourceAccountId: mapped.accountId,
        externalEventId,
        eventType: mapped.eventType,
        idempotencyKey: `event-bus:${mapped.eventType}:${externalEventId}`,
        occurredAt: clean(event.at) || new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        payload: { sourceEventType: clean(event.type), projection: mapped.projection }
      });
      operationalProjectionReceipts.verifyAndRecord({ created: appended, eventLog: this.eventLog, repository: this.eventLog.repository, store: this.eventLog.repository?.store?.(), targetRefs: [] });
      this.captured += appended.created ? 1 : 0;
      return { authority: AUTHORITY, created: appended.created, event: appended.event };
    } catch (error) {
      this.failed += 1;
      this.logger.warn('domain-event', 'operational-event-bridge-failed', {
        sourceEventType: clean(event.type), reasonCode: clean(error.code) || 'DOMAIN_OPERATIONAL_EVENT_BRIDGE_FAILED', error: clean(error.message)
      });
      return null;
    }
  }
  async prepare() { return { authority: AUTHORITY, ready: true }; }
  async start() {
    if (!this.bound) {
      this.bound = event => this.capture(event);
      this.events.on('event', this.bound);
    }
    return this.snapshot();
  }
  async stop() {
    if (this.bound) this.events.off('event', this.bound);
    this.bound = null;
    return this.snapshot();
  }
  snapshot() { return { authority: AUTHORITY, started: Boolean(this.bound), captured: this.captured, failed: this.failed, eventTypes: ['media.lifecycle.updated','history.sync.completed','history.sync.failed','reconcile.completed','reconcile.failed'] }; }
}

const singleton = new DomainOperationalEventBridge();
module.exports = { AUTHORITY, PROJECTOR_NAME, PROJECTOR_VERSION, DomainOperationalEventBridge, singleton, mapEvent };
