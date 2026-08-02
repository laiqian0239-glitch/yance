'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { EvidenceAuthority } = require('../services/evidenceAuthority');
const { CommunicationAuthority } = require('../services/communicationAuthority');
const { ContactRelationshipAuthority } = require('../services/contactRelationshipAuthority');
const { AIReplyLearningAuthority } = require('../services/aiReplyLearningAuthority');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-ai-learning-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  let id = 0; let tick = 0;
  const idFactory = prefix => `${prefix}-${++id}`;
  const clock = () => new Date(Date.UTC(2026, 7, 1, 16, 0, tick++)).toISOString();
  const evidence = new EvidenceAuthority({ storeProvider: () => store, idFactory, clock });
  const communication = new CommunicationAuthority({ storeProvider: () => store, idFactory, clock });
  const contacts = new ContactRelationshipAuthority({ storeProvider: () => store, idFactory, clock });
  const learning = new AIReplyLearningAuthority({ storeProvider: () => store, evidenceAuthority: evidence, idFactory, clock });
  const at = clock();
  store.db.prepare(`INSERT INTO r32_accounts(id,platform,adapter_account_id,display_name,identity_label,state,can_send,can_receive,payload_json,created_at,updated_at)
    VALUES('tg-a','telegram','tg-a','Telegram A','Telegram A','connected',1,1,'{}',?,?)`).run(at, at);
  const contact = contacts.observeIdentity({ platform: 'telegram', sourceAccountId: 'tg-a', externalId: '42', displayName: 'Anna' });
  const snapshot = contacts.buildSnapshot({ contactId: contact.contactId, traceId: 'trace-reply' });
  evidence.startTrace({ traceId: 'trace-reply', traceType: 'ai-reply', task: 'quick_reply', executionMode: 'candidate-only' });
  evidence.appendObservation({ traceId: 'trace-reply', idempotencyKey: 'candidate-generated', stage: 'candidate-generated', status: 'completed', kind: 'generation', evidence: { modelId: 'model-a' } });
  const outbound = communication.ingestMessage({ traceId: 'trace-reply', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: 'local-1', direction: 'outbound', senderExternalId: 'self', content: { kind: 'text', text: 'Hallo Anna' } });
  const attempt = communication.createDeliveryAttempt({ traceId: 'trace-reply', messageId: outbound.messageId, platform: 'telegram', sourceAccountId: 'tg-a', idempotencyKey: 'send-1' });
  communication.recordDeliveryReceipt({ attemptId: attempt.attemptId, status: 'DELIVERED', platformMessageId: 'remote-1', providerRequestId: 'req-1' });
  return { root, store, evidence, communication, contacts, learning, contact, snapshot, outbound, attempt, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

function validInput(f, overrides = {}) {
  return {
    traceId: 'trace-reply',
    contactId: f.contact.contactId,
    contactSnapshotId: f.snapshot.snapshotId,
    candidateTraceId: 'trace-reply',
    deliveryAttemptId: f.attempt.attemptId,
    sourceKind: 'reviewed-reply',
    reviewOutcome: 'edited',
    humanReviewed: true,
    emergencyMode: false,
    messageDirection: 'outbound',
    ...overrides
  };
}

test('learning cannot be created from inbound, unreviewed, failed-delivery or emergency content', () => {
  const f = fixture();
  try {
    for (const [override, code] of [
      [{ messageDirection: 'inbound' }, 'LEARNING_SOURCE_DIRECTION_INVALID'],
      [{ humanReviewed: false, reviewOutcome: 'generated' }, 'LEARNING_HUMAN_REVIEW_REQUIRED'],
      [{ emergencyMode: true }, 'LEARNING_EMERGENCY_EXCLUDED']
    ]) {
      assert.throws(() => f.learning.createPending(validInput(f, override)), error => error?.code === code);
    }
    const failedMessage = f.communication.ingestMessage({ traceId: 'trace-reply', platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: 'local-failed', direction: 'outbound', senderExternalId: 'self', content: { kind: 'text', text: 'Failed' } });
    const failedAttempt = f.communication.createDeliveryAttempt({ traceId: 'trace-reply', messageId: failedMessage.messageId, platform: 'telegram', sourceAccountId: 'tg-a', idempotencyKey: 'send-failed' });
    f.communication.recordDeliveryReceipt({ attemptId: failedAttempt.attemptId, status: 'FAILED', failureCode: 'REMOTE_REJECTED' });
    assert.throws(() => f.learning.createPending(validInput(f, { deliveryAttemptId: failedAttempt.attemptId })), error => error?.code === 'LEARNING_DELIVERY_SUCCESS_REQUIRED');
  } finally { f.close(); }
});

test('reviewed delivered reply creates versioned pending learning and follows approval-shadow-active lifecycle', () => {
  const f = fixture();
  try {
    const pending = f.learning.createPending(validInput(f));
    assert.equal(pending.state, 'pending');
    assert.equal(JSON.stringify(pending).includes('Hallo Anna'), false);
    const approved = f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'approve', actor: 'owner' });
    assert.equal(approved.state, 'approved');
    const shadow = f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'start-shadow', actor: 'system' });
    assert.equal(shadow.state, 'shadow');
    const active = f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'activate', actor: 'owner' });
    assert.equal(active.state, 'active');
    const retrieval = f.learning.recordRetrieval({ learningReceiptId: pending.learningReceiptId, traceId: 'trace-next-reply', contactSnapshotId: f.snapshot.snapshotId, purpose: 'reply-context' });
    assert.equal(retrieval.learningReceiptId, pending.learningReceiptId);
    assert.equal(retrieval.traceId, 'trace-next-reply');
    assert.equal(f.learning.get(pending.learningReceiptId).events.length, 4);
  } finally { f.close(); }
});

test('active learning can be revoked or rolled back and is then excluded from retrieval', () => {
  const f = fixture();
  try {
    const pending = f.learning.createPending(validInput(f));
    f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'approve', actor: 'owner' });
    f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'start-shadow', actor: 'system' });
    f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'activate', actor: 'owner' });
    const revoked = f.learning.transition({ learningReceiptId: pending.learningReceiptId, action: 'revoke', actor: 'owner', reasonCode: 'USER_CORRECTION' });
    assert.equal(revoked.state, 'revoked');
    assert.throws(() => f.learning.recordRetrieval({ learningReceiptId: pending.learningReceiptId, traceId: 'trace-next', contactSnapshotId: f.snapshot.snapshotId }), error => error?.code === 'LEARNING_RECEIPT_NOT_ACTIVE');
  } finally { f.close(); }
});
