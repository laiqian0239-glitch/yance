'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { DurableExecutionAuthority } = require('../services/durableExecutionAuthority');
const { EvidenceAuthority } = require('../services/evidenceAuthority');
const { CommunicationAuthority } = require('../services/communicationAuthority');
const { DurableChannelOperationService } = require('../services/durableChannelOperationService');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-durable-channel-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  let id = 0; let tick = 0;
  const idFactory = prefix => `${prefix}-${++id}`;
  const clock = () => new Date(Date.UTC(2026, 7, 1, 14, 0, tick++)).toISOString();
  const durable = new DurableExecutionAuthority({ storeProvider: () => store, idFactory, clock });
  const evidence = new EvidenceAuthority({ storeProvider: () => store, idFactory, clock });
  const communication = new CommunicationAuthority({ storeProvider: () => store, idFactory, clock });
  const service = new DurableChannelOperationService({ durableExecutionAuthority: durable, evidenceAuthority: evidence, idFactory, clock });
  const at = clock();
  store.db.prepare(`INSERT INTO r32_accounts(id,platform,adapter_account_id,display_name,identity_label,state,can_send,can_receive,payload_json,created_at,updated_at)
    VALUES('tg-a','telegram','tg-a','Telegram A','Telegram A','connected',1,1,'{}',?,?)`).run(at, at);
  return { root, store, durable, evidence, communication, service, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

function outboundMessage(communication) {
  return communication.ingestMessage({
    traceId: 'trace-delivery', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: 'local-1',
    direction: 'outbound', senderExternalId: 'self', content: { kind: 'text', text: 'Hallo' }
  });
}

test('delivery receipts converge monotonically and reject conflicting remote message identity', () => {
  const f = fixture();
  try {
    const message = outboundMessage(f.communication);
    const attempt = f.communication.createDeliveryAttempt({ traceId: 'trace-delivery', messageId: message.messageId, platform: 'telegram', sourceAccountId: 'tg-a', idempotencyKey: 'send-1' });
    f.communication.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'DELIVERED', platformMessageId: 'remote-1' });
    f.communication.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'ACCEPTED', platformMessageId: 'remote-1' });
    f.communication.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'FAILED', failureCode: 'LATE_TIMEOUT' });
    assert.equal(f.communication.getDeliveryAttempt(attempt.attemptId).state, 'DELIVERED');
    assert.throws(
      () => f.communication.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'READ', platformMessageId: 'remote-2' }),
      error => error?.code === 'DELIVERY_PLATFORM_MESSAGE_CONFLICT'
    );
  } finally { f.close(); }
});

test('durable channel operation resumes retry with a new generation and does not re-run terminal work', async () => {
  const f = fixture();
  try {
    let calls = 0;
    f.service.registerHandler('channel-history-sync', async ({ execution }) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary network failure'), { code: 'NETWORK_OFFLINE', retryable: true, nextAttemptAt: '2026-08-01T13:59:00.000Z' });
      return { receiptId: 'sync-receipt-1', counts: { messages: 10 } };
    });
    const queued = f.service.enqueue({ operationKind: 'channel-history-sync', idempotencyKey: 'tg-a:history:chat-1', traceId: 'trace-history', metadata: { platform: 'telegram', accountId: 'tg-a', streamKind: 'messages' }, maxAttempts: 3 });
    const first = await f.service.execute(queued.executionId, { ownerId: 'worker-a' });
    assert.equal(first.execution.state, 'RETRY_SCHEDULED');
    const second = await f.service.execute(queued.executionId, { ownerId: 'worker-b' });
    assert.equal(second.execution.state, 'SUCCEEDED');
    assert.equal(calls, 2);
    const terminal = await f.service.execute(queued.executionId, { ownerId: 'worker-c' });
    assert.equal(terminal.execution.state, 'SUCCEEDED');
    assert.equal(calls, 2);
    assert.equal(f.evidence.getTrace('trace-history').status, 'completed');
  } finally { f.close(); }
});

test('durable cancellation is acknowledged without invoking the platform handler', async () => {
  const f = fixture();
  try {
    let calls = 0;
    f.service.registerHandler('media-fetch', async () => { calls += 1; return {}; });
    const queued = f.service.enqueue({ operationKind: 'media-fetch', idempotencyKey: 'media-1', traceId: 'trace-media', metadata: { platform: 'telegram', mediaId: 'media-1' } });
    const cancel = f.service.requestCancel(queued.executionId, { actor: 'user', reasonCode: 'USER_CANCELLED' });
    assert.equal(cancel.state, 'CANCEL_REQUESTED');
    const result = await f.service.execute(queued.executionId, { ownerId: 'worker-a' });
    assert.equal(result.execution.state, 'CANCELLED');
    assert.equal(calls, 0);
    assert.equal(f.evidence.getTrace('trace-media').status, 'cancelled');
  } finally { f.close(); }
});
