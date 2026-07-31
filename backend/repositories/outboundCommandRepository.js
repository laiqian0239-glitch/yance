'use strict';

const { getStore } = require('./storeProvider');
const outboxRouteAuthority = require('../services/outboxRouteAuthority').singleton;
const accountRepository = require('./accountRepository');

function clean(value) { return String(value == null ? '' : value).trim(); }

function createAtomic(input = {}) {
  const store = input.store || getStore();
  const queueInput = input.queue || {};
  const message = input.message || null;
  let route;
  let queue;
  let savedMessage = null;
  let conversation = null;
  const routeAuthority = input.outboxRouteAuthority || outboxRouteAuthority;
  store.transaction(() => {
    route = routeAuthority.ensure(input.route || {}, store);
    const payload = { ...(queueInput.payload || {}), outboxRouteId: route.outboxRouteId, outboxRouteVersionId: route.routeVersionId };
    queue = store.enqueueSend({
      ...queueInput,
      payload,
      outboxRouteId: route.outboxRouteId,
      outboxRouteVersionId: route.routeVersionId
    });
    queue = store.getSendQueueItem(queue.id);
    if (message && !['sent', 'failed', 'cancelled'].includes(queue.state)) {
      const authoritative = {
        ...message,
        timestamp: message.timestamp || queue.created_at || new Date().toISOString(),
        deliveryStatus: queue.state === 'retry' ? 'retry' : 'queued',
        queueId: queue.id,
        idempotencyKey: queue.idempotency_key
      };
      store.touchConversationFromMessage(authoritative);
      store.upsertMessage(authoritative);
      savedMessage = store.getMessage(authoritative.id || authoritative.dedupeKey);
      conversation = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(authoritative.sessionKey || authoritative.conversationId) || null;
    }
    accountRepository.recordWithinTransaction(store, 'outbound-command-created', {
      accountId: clean(queueInput.accountId),
      platform: clean(input.route?.platform).toLowerCase(),
      conversationId: clean(queueInput.sessionKey),
      queueId: clean(queue.id),
      outboxRouteId: clean(route.outboxRouteId),
      outboxRouteVersionId: clean(route.routeVersionId)
    });
  });
  return { route, queue, message: savedMessage, conversation };
}

module.exports = { createAtomic };
