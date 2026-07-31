'use strict';

const eventBus = require('./eventBus');
const aiTaskRuntimeRegistry = require('./aiTaskRuntimeRegistry');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function inboundMessage(message = {}) {
  return messageSpeakerAuthority.isPeerInbound(message);
}

function contentMessage(message = {}) {
  return messageSpeakerAuthority.isContentMessage(message);
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      const error = new Error(clean(signal.reason?.code || signal.reason || 'GENERATION_CANCELLED'));
      error.name = 'AbortError';
      error.code = clean(signal.reason?.code || signal.reason || 'GENERATION_CANCELLED');
      reject(error);
    }
    if (signal?.aborted) return aborted();
    signal?.addEventListener?.('abort', aborted, { once: true });
  });
}

class ConversationTurnCoordinator {
  constructor(options = {}) {
    this.eventBus = options.eventBus || eventBus;
    this.clock = options.clock || (() => Date.now());
    this.rows = new Map();
    this.unsubscribers = [];
    this.started = false;
  }

  start() {
    if (this.started) return this.status();
    this.started = true;
    this._bind('message:inserted', event => this._onMessage(event));
    this._bind('conversation:presence', event => this._onPresence(event));
    return this.status();
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try { unsubscribe(); } catch (_) {}
    }
    this.rows.clear();
    this.started = false;
  }

  _bind(type, handler) {
    const listener = event => handler(event);
    this.eventBus.on(type, listener);
    this.unsubscribers.push(() => this.eventBus.off(type, listener));
  }

  _row(conversationId) {
    const id = clean(conversationId);
    if (!id) return null;
    if (!this.rows.has(id)) {
      this.rows.set(id, {
        conversationId: id,
        revision: 0,
        lastContentAtMs: 0,
        aggregationStartedAtMs: 0,
        pendingMessageIds: [],
        remoteComposing: false,
        remoteComposingAtMs: 0,
        lastReason: ''
      });
    }
    return this.rows.get(id);
  }

  _onMessage(wrapper = {}) {
    const message = wrapper?.payload?.message || {};
    if (!inboundMessage(message) || !contentMessage(message)) return;
    const conversationId = clean(message.conversationId || message.sessionKey);
    const row = this._row(conversationId);
    if (!row) return;
    const now = this.clock();
    row.revision += 1;
    row.lastContentAtMs = now;
    row.aggregationStartedAtMs = row.aggregationStartedAtMs || now;
    row.remoteComposing = false;
    row.lastReason = 'NEW_INCOMING_MESSAGE';
    const messageId = clean(message.id || message.messageId || message.externalMessageId);
    if (messageId && !row.pendingMessageIds.includes(messageId)) row.pendingMessageIds.push(messageId);
    row.pendingMessageIds = row.pendingMessageIds.slice(-20);
    aiTaskRuntimeRegistry.cancelForConversation(conversationId, 'NEW_INCOMING_MESSAGE');
  }

  _onPresence(wrapper = {}) {
    const payload = wrapper?.payload || {};
    const conversationId = clean(payload.conversationId || payload.sessionKey);
    const row = this._row(conversationId);
    if (!row) return;
    const state = clean(payload.state || payload.activity || payload.action).toLowerCase();
    row.remoteComposing = ['composing', 'typing', 'recording'].includes(state);
    row.remoteComposingAtMs = this.clock();
  }

  capture(conversationId, persistedRevision = 0) {
    const row = this._row(conversationId);
    return Object.freeze({
      conversationId: clean(conversationId),
      runtimeRevision: Number(row?.revision || 0),
      persistedRevision: Number(persistedRevision || 0),
      pendingMessageIds: [...(row?.pendingMessageIds || [])],
      capturedAtMs: this.clock()
    });
  }

  isCurrent(snapshot = {}, persistedRevision = 0) {
    const row = this._row(snapshot.conversationId);
    return Number(snapshot.runtimeRevision || 0) === Number(row?.revision || 0)
      && Number(snapshot.persistedRevision || 0) === Number(persistedRevision || 0);
  }

  settle(conversationId) {
    const row = this._row(conversationId);
    if (!row) return;
    row.pendingMessageIds = [];
    row.aggregationStartedAtMs = 0;
    row.lastReason = '';
  }

  async waitForQuiet(conversationId, options = {}) {
    const row = this._row(conversationId);
    if (!row) return { waitedMs: 0, revision: 0, pendingMessageIds: [] };
    const quietWindowMs = Math.max(0, Number(options.quietWindowMs || 0));
    const maxAggregationMs = Math.max(quietWindowMs, Number(options.maxAggregationMs || quietWindowMs));
    const started = this.clock();
    while (true) {
      if (options.signal?.aborted) await sleep(0, options.signal);
      const now = this.clock();
      const quietFor = row.lastContentAtMs ? now - row.lastContentAtMs : quietWindowMs;
      const aggregateFor = row.aggregationStartedAtMs ? now - row.aggregationStartedAtMs : 0;
      const remoteTypingFresh = row.remoteComposing && now - row.remoteComposingAtMs < Math.min(maxAggregationMs, 15000);
      if ((!remoteTypingFresh && quietFor >= quietWindowMs) || aggregateFor >= maxAggregationMs) break;
      const remaining = Math.min(
        Math.max(20, quietWindowMs - quietFor),
        Math.max(20, maxAggregationMs - aggregateFor),
        180
      );
      await sleep(remaining, options.signal);
    }
    return {
      waitedMs: this.clock() - started,
      revision: row.revision,
      pendingMessageIds: [...row.pendingMessageIds]
    };
  }

  status() {
    return {
      started: this.started,
      conversations: [...this.rows.values()].map(row => ({
        conversationId: row.conversationId,
        revision: row.revision,
        pending: row.pendingMessageIds.length,
        remoteComposing: row.remoteComposing,
        lastReason: row.lastReason
      }))
    };
  }
}

const singleton = new ConversationTurnCoordinator();
module.exports = singleton;
module.exports.ConversationTurnCoordinator = ConversationTurnCoordinator;
module.exports.inboundMessage = inboundMessage;
module.exports.contentMessage = contentMessage;
