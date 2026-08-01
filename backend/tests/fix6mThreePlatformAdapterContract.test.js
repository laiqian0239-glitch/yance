'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const channelAdapterContract = require('../services/channelAdapterContract');

function fakeFacade(platform, calls) {
  return {
    platform,
    contract() { return { platform, bindings: { auth: true, ingress: true, egress: true, reconcile: true } }; },
    auth: {
      execute: async input => { calls.push(['auth', input]); return { ok: true, state: 'ready', accountId: input.accountId }; },
      status: input => ({ configured: true, state: 'ready', accountId: input.accountId })
    },
    ingress: {
      normalize: input => ({ schemaVersion: 1, platform, sourceAccountId: input.accountId, externalEventId: input.raw.eventId, eventType: input.raw.eventType, payload: input.raw })
    },
    reconcile: {
      execute: async input => { calls.push(['reconcile', input]); return { ok: true, status: 'ready', requestedStream: input.streamKind }; }
    },
    egress: {
      execute: async input => { calls.push(['egress', input]); return { success: true, platformMessageId: `${platform}-remote-1`, providerRequestId: `${platform}-req-1` }; }
    }
  };
}

function fakeCommunication() {
  const state = { media: [], attempts: [], receipts: [] };
  return {
    state,
    ingestMessage(input) { return { messageId: input.messageId || 'message-1', ...input }; },
    registerMedia(input) { const row = { mediaId: `media-${state.media.length + 1}`, state: 'REMOTE_DISCOVERED', version: 1, ...input }; state.media.push(row); return row; },
    transitionMedia(input) { const row = state.media.find(item => item.mediaId === input.mediaId); Object.assign(row, input, { version: row.version + 1 }); return row; },
    createDeliveryAttempt(input) { const row = { attemptId: `attempt-${state.attempts.length + 1}`, state: 'CREATED', ...input }; state.attempts.push(row); return row; },
    recordDeliveryReceipt(input) { const row = { receiptId: `receipt-${state.receipts.length + 1}`, ...input }; state.receipts.push(row); return row; },
    getDeliveryAttempt(attemptId) { return state.attempts.find(item => item.attemptId === attemptId) || null; }
  };
}

test('all three Yance platform bridges expose the complete typed channel contract', () => {
  const { ChannelAdapterRuntimeRegistry } = require('../services/channelAdapterRuntime');
  const registry = new ChannelAdapterRuntimeRegistry();
  for (const platform of ['whatsapp', 'telegram', 'facebook']) {
    const adapter = registry.get(platform);
    assert.equal(channelAdapterContract.assertAdapter(platform, adapter), adapter);
    assert.equal(adapter.describe().platform, platform);
    assert.equal(adapter.describe().legacyFourPortBindings.ingress, true);
  }
});

test('adapter bridge delegates auth/reconcile, schedules media explicitly, and records real delivery evidence', async () => {
  const { ChannelAdapterRuntime } = require('../services/channelAdapterRuntime');
  const calls = [];
  const communication = fakeCommunication();
  const adapter = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade: fakeFacade('telegram', calls),
    communicationAuthority: communication,
    accountReader: accountId => ({ id: accountId, platform: 'telegram', displayName: 'Test Account', state: 'connected' })
  });

  const authenticated = await adapter.authenticate({ accountId: 'tg-a', operation: 'connect' });
  assert.equal(authenticated.ok, true);
  const identity = await adapter.readAccountIdentity({ accountId: 'tg-a' });
  assert.deepEqual(identity, { platform: 'telegram', accountId: 'tg-a', displayName: 'Test Account', state: 'connected' });
  const messages = await adapter.backfillMessages({ accountId: 'tg-a', externalConversationId: 'chat-1' });
  assert.equal(messages.requestedStream, 'messages');

  const normalized = await adapter.normalizeEvent({ accountId: 'tg-a', raw: { eventId: 'event-1', eventType: 'message.created' } });
  assert.equal(normalized.externalEventId, 'event-1');
  const media = await adapter.fetchMedia({ traceId: 'trace-1', accountId: 'tg-a', externalReference: 'file-ref-1', mediaKind: 'sticker', mimeType: 'image/webp' });
  assert.equal(media.state, 'FETCH_SCHEDULED');

  const sent = await adapter.sendMessage({
    traceId: 'trace-1', messageId: 'message-1', accountId: 'tg-a', idempotencyKey: 'send-1',
    command: { platform: 'telegram', accountId: 'tg-a', commandId: 'send-1', operation: 'text', conversationTarget: 'chat-1', finalText: 'Hallo' }
  });
  assert.equal(sent.deliveryReceipt.platformMessageId, 'telegram-remote-1');
  assert.equal(communication.state.attempts.length, 1);
  assert.equal(communication.state.receipts.length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'egress').length, 1);
});

test('adapter bridge records failed delivery truth and never turns it into success', async () => {
  const { ChannelAdapterRuntime } = require('../services/channelAdapterRuntime');
  const communication = fakeCommunication();
  const facade = fakeFacade('facebook', []);
  facade.egress.execute = async () => { throw Object.assign(new Error('remote rejected'), { code: 'REMOTE_REJECTED', providerRequestId: 'fb-req-failed' }); };
  const adapter = new ChannelAdapterRuntime({ platform: 'facebook', facade, communicationAuthority: communication, accountReader: () => ({ id: 'fb-a', platform: 'facebook', state: 'connected' }) });

  await assert.rejects(
    () => adapter.sendMessage({ traceId: 'trace-fail', messageId: 'message-1', accountId: 'fb-a', idempotencyKey: 'send-fail', command: { platform: 'facebook', accountId: 'fb-a', commandId: 'send-fail', operation: 'text', conversationTarget: 'peer-1', finalText: 'Hallo' } }),
    error => error?.code === 'REMOTE_REJECTED' && error?.deliveryReceipt?.status === 'FAILED'
  );
  assert.equal(communication.state.receipts[0].status, 'FAILED');
  assert.equal(communication.state.receipts[0].failureCode, 'REMOTE_REJECTED');
});
