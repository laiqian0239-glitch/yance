'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { CommunicationAuthority } = require('../services/communicationAuthority');
const channelAdapterContract = require('../services/channelAdapterContract');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-communication-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({ dbPath });
  let id = 0;
  let tick = 0;
  const authority = new CommunicationAuthority({
    storeProvider: () => store,
    idFactory: prefix => `${prefix}-${++id}`,
    clock: () => new Date(Date.UTC(2026, 7, 1, 13, 0, tick++)).toISOString()
  });
  for (const accountId of ['tg-a', 'tg-b']) {
    const at = new Date().toISOString();
    store.db.prepare(`INSERT INTO r32_accounts(id,platform,adapter_account_id,display_name,identity_label,state,can_send,can_receive,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,'connected',1,1,'{}',?,?)`).run(accountId, 'telegram', accountId, accountId, accountId, at, at);
  }
  return {
    root, store, authority,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

test('canonical messages are account scoped, idempotent and never collapse unsupported content into a blank bubble', () => {
  const f = fixture();
  try {
    const first = f.authority.ingestMessage({
      traceId: 'trace-1',
      platform: 'telegram',
      sourceAccountId: 'tg-a',
      externalConversationId: 'chat-1',
      externalMessageId: '42',
      direction: 'inbound',
      senderExternalId: 'user-1',
      occurredAt: '2026-08-01T12:00:00.000Z',
      rawEventRef: { eventId: 'event-1', payloadSha256: 'a'.repeat(64) },
      content: { kind: 'text', text: 'Hallo' }
    });
    const duplicate = f.authority.ingestMessage({
      traceId: 'trace-1', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: '42',
      direction: 'inbound', senderExternalId: 'user-1', content: { kind: 'text', text: 'MUST NOT OVERWRITE' }
    });
    const otherAccount = f.authority.ingestMessage({
      traceId: 'trace-2', platform: 'telegram', sourceAccountId: 'tg-b', externalConversationId: 'chat-1', externalMessageId: '42',
      direction: 'inbound', senderExternalId: 'user-1', content: { kind: 'text', text: 'Other account' }
    });
    const unsupported = f.authority.ingestMessage({
      traceId: 'trace-3', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: '43',
      direction: 'inbound', senderExternalId: 'user-1', rawEventRef: { eventId: 'event-2' },
      content: { kind: 'unsupported', platformType: 'paid-media', rawSummary: '' }
    });

    assert.equal(duplicate.messageId, first.messageId);
    assert.equal(duplicate.normalizedContent.text, 'Hallo');
    assert.notEqual(otherAccount.messageId, first.messageId);
    assert.equal(unsupported.normalizedContent.kind, 'unsupported');
    assert.match(unsupported.renderProjection.fallbackText, /暂不支持|Unsupported/u);
    assert.notEqual(unsupported.renderProjection.fallbackText.trim(), '');
    assert.equal(first.rawEventRef.eventId, 'event-1');
    assert.equal(first.normalizedContent.text, 'Hallo');
    assert.equal(first.renderProjection.kind, 'text');
  } finally { f.close(); }
});

test('media lifecycle exposes retryable failure and cannot silently become available', () => {
  const f = fixture();
  try {
    const media = f.authority.registerMedia({
      traceId: 'trace-media', platform: 'telegram', sourceAccountId: 'tg-a', externalReference: 'file-ref-1',
      mediaKind: 'sticker', mimeType: 'application/x-tgsticker', animated: true
    });
    assert.equal(media.state, 'REMOTE_DISCOVERED');
    const fetching = f.authority.transitionMedia({ mediaId: media.mediaId, expectedVersion: 1, state: 'FETCHING' });
    assert.equal(fetching.version, 2);
    const failed = f.authority.transitionMedia({ mediaId: media.mediaId, expectedVersion: 2, state: 'FAILED_RETRYABLE', failureCode: 'AUTH_EXPIRED', nextRetryAt: '2026-08-01T13:05:00.000Z' });
    assert.equal(failed.state, 'FAILED_RETRYABLE');
    assert.equal(failed.failureCode, 'AUTH_EXPIRED');
    assert.equal(failed.nextRetryAt, '2026-08-01T13:05:00.000Z');
    assert.throws(
      () => f.authority.transitionMedia({ mediaId: media.mediaId, expectedVersion: 1, state: 'AVAILABLE', localPath: 'x.webp' }),
      error => error?.code === 'MEDIA_ASSET_STALE_VERSION'
    );
  } finally { f.close(); }
});

test('delivery receipt does not claim success without platform acceptance evidence', () => {
  const f = fixture();
  try {
    const message = f.authority.ingestMessage({
      traceId: 'trace-send', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: 'local-1',
      direction: 'outbound', senderExternalId: 'self', content: { kind: 'text', text: 'Hallo' }
    });
    const attempt = f.authority.createDeliveryAttempt({ traceId: 'trace-send', messageId: message.messageId, platform: 'telegram', sourceAccountId: 'tg-a', idempotencyKey: 'send-1' });
    assert.throws(
      () => f.authority.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'DELIVERED' }),
      error => error?.code === 'DELIVERY_PLATFORM_EVIDENCE_REQUIRED'
    );
    const accepted = f.authority.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'ACCEPTED', platformMessageId: 'telegram-100', providerRequestId: 'req-100' });
    assert.equal(accepted.status, 'ACCEPTED');
    assert.equal(accepted.platformMessageId, 'telegram-100');
  } finally { f.close(); }
});

test('history checkpoint advances only after the committed gap is closed', () => {
  const f = fixture();
  try {
    const initial = f.authority.getSyncCheckpoint({ platform: 'telegram', sourceAccountId: 'tg-a', streamKind: 'messages', externalConversationId: 'chat-1' });
    assert.equal(initial.version, 0);
    assert.throws(
      () => f.authority.commitSyncCheckpoint({ platform: 'telegram', sourceAccountId: 'tg-a', streamKind: 'messages', externalConversationId: 'chat-1', expectedVersion: 0, cursor: 'offset-100', gapClosed: false }),
      error => error?.code === 'SYNC_GAP_NOT_CLOSED'
    );
    const committed = f.authority.commitSyncCheckpoint({ platform: 'telegram', sourceAccountId: 'tg-a', streamKind: 'messages', externalConversationId: 'chat-1', expectedVersion: 0, cursor: 'offset-100', highWatermark: '42', gapClosed: true });
    assert.equal(committed.version, 1);
    assert.equal(committed.cursor, 'offset-100');
    assert.throws(
      () => f.authority.commitSyncCheckpoint({ platform: 'telegram', sourceAccountId: 'tg-a', streamKind: 'messages', externalConversationId: 'chat-1', expectedVersion: 0, cursor: 'offset-200', gapClosed: true }),
      error => error?.code === 'SYNC_CHECKPOINT_STALE_VERSION'
    );
  } finally { f.close(); }
});

test('channel adapter contract requires complete typed ports and rejects unsafe boundary values', () => {
  const valid = Object.fromEntries(channelAdapterContract.REQUIRED_METHODS.map(name => [name, async () => ({ ok: true })]));
  assert.equal(channelAdapterContract.assertAdapter('telegram', valid), valid);
  assert.throws(
    () => channelAdapterContract.assertAdapter('telegram', { authenticate: async () => ({ ok: true }) }),
    error => error?.code === 'CHANNEL_ADAPTER_CONTRACT_INCOMPLETE'
  );
  assert.throws(
    () => channelAdapterContract.assertPlainData({ payload: Buffer.from('secret') }),
    error => error?.code === 'CHANNEL_ADAPTER_BOUNDARY_UNSAFE'
  );
  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { return 'hidden'; } });
  assert.throws(
    () => channelAdapterContract.assertPlainData(accessor),
    error => error?.code === 'CHANNEL_ADAPTER_BOUNDARY_UNSAFE'
  );
});
