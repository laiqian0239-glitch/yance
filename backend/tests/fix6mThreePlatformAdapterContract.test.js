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

// Current CommunicationAuthority seam: the adapter only performs durable preparation
// (history synchronization / outbound outbox intents). Physical reconcile/egress execution
// belongs to the durable operations layer, so this fake records preparation calls instead of
// the retired createDeliveryAttempt/recordDeliveryReceipt local state machine.
function fakeCommunication() {
  const state = { media: [], historyPreps: [], outboundPreps: [] };
  let mediaSeq = 0; let histSeq = 0; let outSeq = 0;
  return {
    state,
    registerMedia(input) { const row = { mediaId: `media-${++mediaSeq}`, state: 'REMOTE_DISCOVERED', version: 1, ...input }; state.media.push(row); return row; },
    transitionMedia(input) { const row = state.media.find(item => item.mediaId === input.mediaId); Object.assign(row, input, { version: row.version + 1 }); return row; },
    prepareHistorySynchronization(input) {
      const row = Object.freeze({
        executionId: `hist-exec-${++histSeq}`, intentId: `hist-intent-${histSeq}`,
        operationKind: 'HISTORY_SYNCHRONIZATION', idempotencyKey: input.idempotencyKey, command: input.command
      });
      state.historyPreps.push({ input, row });
      return row;
    },
    prepareOutboundMessageSend(input) {
      const row = Object.freeze({
        executionId: `send-exec-${++outSeq}`, intentId: `send-intent-${outSeq}`,
        operationKind: 'OUTBOUND_MESSAGE_SEND', idempotencyKey: input.idempotencyKey, command: input.command
      });
      state.outboundPreps.push({ input, row });
      return row;
    }
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

test('adapter bridge delegates auth, prepares durable history/media/outbound work and never executes physical egress inline', async () => {
  const { ChannelAdapterRuntime } = require('../services/channelAdapterRuntime');
  const calls = [];
  const communication = fakeCommunication();
  const adapter = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade: fakeFacade('telegram', calls),
    communicationAuthority: communication,
    accountReader: accountId => ({ id: accountId, platform: 'telegram', displayName: 'Test Account', state: 'connected', credentialRef: 'cred-tg-a' })
  });

  const authenticated = await adapter.authenticate({ accountId: 'tg-a', operation: 'connect' });
  assert.equal(authenticated.ok, true);
  const identity = await adapter.readAccountIdentity({ accountId: 'tg-a' });
  assert.deepEqual(identity, { platform: 'telegram', accountId: 'tg-a', displayName: 'Test Account', state: 'connected' });

  // Backfill now prepares a durable history synchronization intent instead of running reconcile inline.
  const historyPrepared = await adapter.backfillMessages({ accountId: 'tg-a', externalConversationId: 'chat-1' });
  assert.equal(historyPrepared.operationKind, 'HISTORY_SYNCHRONIZATION');
  assert.equal(historyPrepared.command.streamKind, 'messages');
  assert.equal(historyPrepared.command.platform, 'telegram');
  assert.equal(historyPrepared.command.credentialReference, 'cred-tg-a');
  assert.equal(communication.state.historyPreps.length, 1);

  const normalized = await adapter.normalizeEvent({ accountId: 'tg-a', raw: { eventId: 'event-1', eventType: 'message.created' } });
  assert.equal(normalized.externalEventId, 'event-1');
  const media = await adapter.fetchMedia({ traceId: 'trace-1', accountId: 'tg-a', externalReference: 'file-ref-1', mediaKind: 'sticker', mimeType: 'image/webp' });
  assert.equal(media.state, 'FETCH_SCHEDULED');

  const sent = await adapter.sendMessage({
    traceId: 'trace-1', messageId: 'message-1', accountId: 'tg-a', idempotencyKey: 'send-1',
    command: { platform: 'telegram', accountId: 'tg-a', commandId: 'send-1', operation: 'text', conversationTarget: 'chat-1', finalText: 'Hallo' }
  });
  assert.equal(sent.operationKind, 'OUTBOUND_MESSAGE_SEND');
  assert.equal(sent.command.accountReference, 'tg-a');
  assert.equal(sent.idempotencyKey, 'send-1');
  assert.equal(communication.state.outboundPreps.length, 1);
  // durable-outbox-only: the adapter must not call the physical egress facade itself, and it must
  // never synthesize a delivery receipt from preparation.
  assert.equal(calls.filter(([kind]) => kind === 'egress').length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(sent, 'deliveryReceipt'), false);
  assert.equal(calls.filter(([kind]) => kind === 'auth').length, 1);
});

test('adapter send only prepares the outbox intent, rejects scope mismatch, and never turns missing platform evidence into success', async () => {
  const { ChannelAdapterRuntime } = require('../services/channelAdapterRuntime');
  const communication = fakeCommunication();
  const facade = fakeFacade('facebook', []);
  // Even if the physical egress would fail remotely, the adapter does not execute it during prepare.
  facade.egress.execute = async () => { throw Object.assign(new Error('remote rejected'), { code: 'REMOTE_REJECTED', providerRequestId: 'fb-req-failed' }); };
  const adapter = new ChannelAdapterRuntime({
    platform: 'facebook', facade, communicationAuthority: communication,
    accountReader: () => ({ id: 'fb-a', platform: 'facebook', state: 'connected', credentialRef: 'cred-fb-a' })
  });

  const prepared = await adapter.sendMessage({
    traceId: 'trace-fail', messageId: 'message-1', accountId: 'fb-a', idempotencyKey: 'send-fail',
    command: { platform: 'facebook', accountId: 'fb-a', commandId: 'send-fail', operation: 'text', conversationTarget: 'peer-1', finalText: 'Hallo' }
  });
  // Preparation returns only the durable intent handle; no inline delivery success/receipt.
  assert.equal(prepared.operationKind, 'OUTBOUND_MESSAGE_SEND');
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, 'deliveryReceipt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, 'status'), false);
  assert.equal(communication.state.outboundPreps.length, 1);

  // A command whose platform/account scope does not match the adapter is rejected.
  await assert.rejects(
    () => adapter.sendMessage({
      traceId: 'trace-scope', accountId: 'fb-a', idempotencyKey: 'send-scope',
      command: { platform: 'whatsapp', accountId: 'fb-a', commandId: 'send-scope', operation: 'text', conversationTarget: 'peer-1' }
    }),
    error => error?.code === 'CHANNEL_SEND_SCOPE_MISMATCH'
  );
});
