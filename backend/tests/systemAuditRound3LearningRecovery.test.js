'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { StoreManager } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');
const learningService = require('../services/replyFeedbackLearningService');

function createStore(dbPath, seed = false) {
  const store = new R32SqliteStore({ dbPath });
  if (seed) {
    store.upsertAccount({
      id: 'wa-round3', platform: 'whatsapp', adapterAccountId: 'wa-round3',
      displayName: 'WA Round 3', canSend: true, canReceive: true
    });
    store.upsertContact({
      id: 'contact-round3', platform: 'whatsapp', accountId: 'wa-round3',
      externalId: '491234567@s.whatsapp.net', displayName: 'Round 3 Customer',
      canonicalContactId: 'canonical-round3'
    });
    store.upsertConversation({
      sessionKey: 'conversation-round3', platform: 'whatsapp', accountId: 'wa-round3',
      contactId: 'contact-round3', title: 'Round 3 Customer', routeState: 'ready', version: 1
    });
  }
  return store;
}

async function createManager(store) {
  const manager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store }) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  return manager;
}

async function persistSuccessfulSend(manager, suffix, learningMode = 'send_and_learn') {
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'round3-test',
    payload: {
      contactId: 'contact-round3', conversationId: 'conversation-round3',
      conversationRevision: 1, source: 'openrouter', performanceMode: 'quality'
    }
  });
  const candidate = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'round3-test',
    payload: {
      taskId: task.result.taskId,
      text: `Das klingt schön ${suffix}. Erzähl mir später mehr.`,
      conversationRevision: 1,
      targetLanguage: 'de', targetLanguageCode: 'de',
      translatedZh: `这听起来很好${suffix}，之后多告诉我一点。`,
      translationStatus: 'success', translationModel: 'translator-free',
      modelId: 'reply-model-paid', model: 'Reply Model Paid', replyTask: 'deep_reply',
      performanceMode: 'quality', source: 'openrouter',
      personaProfileId: 'owner', personaVersionId: 12, personaPolicyHash: 'persona-hash-12',
      generationMetadata: {
        modelId: 'reply-model-paid', model: 'Reply Model Paid', replyTask: 'deep_reply',
        targetLanguage: 'de', styleVariant: 'playful-warm', requestId: `request-${suffix}`
      },
      director: {
        modelId: 'director-model-free', model: 'Director Model Free',
        variant: 'playful-warm', strategy: 'acknowledge-and-open', maxQuestions: 0
      },
      replyStrategy: { recommendedLength: 'short', maxQuestions: 0, direction: 'warm' }
    }
  });
  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'round3-test',
    payload: {
      candidateId: candidate.result.candidateId, userApproved: true, approvedBy: 'user',
      learningMode, source: 'openrouter'
    }
  });
  const outboxId = approved.result.outboxId;
  await manager.dispatch({
    type: 'OUTBOX_TEXT_REVISED', source: 'round3-test',
    payload: { outboxId, text: `Klingt schön ${suffix}. Erzähl mir später mehr.`, userConfirmedRevision: true }
  });
  await manager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED', source: 'round3-test',
    payload: { outboxId, confirmSend: true }
  });
  await manager.dispatch({
    type: 'OUTBOX_QUEUE_LINKED', source: 'round3-test',
    payload: { outboxId, sendQueueId: `queue-${suffix}` }
  });
  await manager.dispatch({
    type: 'OUTBOX_SEND_RESULT', source: 'round3-test',
    payload: { outboxId, success: true, sendQueueId: `queue-${suffix}` }
  });
  return { candidateId: candidate.result.candidateId, outboxId };
}

test('Round 3 recovers successful-send learning after a process crash and preserves generation provenance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round3-learning-recovery-'));
  const dbPath = path.join(root, 'r32.db');
  learningService.stop();
  let firstStore;
  let restartedStore;
  try {
    firstStore = createStore(dbPath, true);
    const firstManager = await createManager(firstStore);
    const sent = await persistSuccessfulSend(firstManager, 'crash');
    assert.equal(firstStore.db.prepare('SELECT COUNT(*) AS count FROM ai_reply_feedback_events').get().count, 0);
    firstStore.close();
    firstStore = null;

    restartedStore = createStore(dbPath, false);
    const restartedManager = await createManager(restartedStore);
    const repository = new ReplyFeedbackRepository(restartedStore);
    const pending = repository.listPendingSuccessfulSends();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].outboxId, sent.outboxId);
    assert.equal(pending[0].director.modelId, 'director-model-free');
    assert.equal(pending[0].generationMetadata.requestId, 'request-crash');

    learningService.start({ restarted: true, storeManager: restartedManager, repository, personaBrain: { service: {} } });
    await learningService.waitForIdle();

    const learned = repository.listEvents({ contactId: 'contact-round3', limit: 10 });
    assert.equal(learned.length, 1);
    assert.equal(learned[0].id, `sent:${sent.outboxId}`);
    assert.equal(learned[0].finalText, 'Klingt schön crash. Erzähl mir später mehr.');
    assert.equal(learned[0].modelId, 'reply-model-paid');
    assert.equal(learned[0].replyTask, 'deep_reply');
    assert.equal(learned[0].styleVariant, 'playful-warm');
    assert.equal(learned[0].generationMetadata.requestId, 'request-crash');
    assert.equal(learned[0].generationMetadata.director.modelId, 'director-model-free');
    assert.equal(learned[0].platform, 'whatsapp');
    assert.equal(learned[0].sourceAccountId, 'wa-round3');
    assert.equal(learned[0].platformContactIdentity, '491234567@s.whatsapp.net');
    assert.equal(learned[0].canonicalContactId, 'canonical-round3');
    assert.equal(repository.listPendingSuccessfulSends().length, 0);
    const status = learningService.status();
    assert.equal(status.crashRecoveryReconciliation, true);
    assert.equal(status.reconciled, 1);
    assert.equal(status.pendingBacklog, 0);
    assert.ok(status.lastReconciledAt);
  } finally {
    learningService.stop();
    try { firstStore?.close(); } catch (_) {}
    try { restartedStore?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Round 3 reconciliation excludes send-only evidence and remains idempotent after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round3-learning-modes-'));
  const dbPath = path.join(root, 'r32.db');
  learningService.stop();
  let store;
  let restarted;
  try {
    store = createStore(dbPath, true);
    const manager = await createManager(store);
    const learnable = await persistSuccessfulSend(manager, 'learnable', 'send_and_learn');
    await persistSuccessfulSend(manager, 'private', 'send_only');
    store.close();
    store = null;

    restarted = createStore(dbPath, false);
    const restartedManager = await createManager(restarted);
    const repository = new ReplyFeedbackRepository(restarted);
    const pending = repository.listPendingSuccessfulSends();
    assert.deepEqual(pending.map(row => row.outboxId), [learnable.outboxId]);
    learningService.start({ storeManager: restartedManager, repository, personaBrain: { service: {} } });
    await learningService.waitForIdle();
    assert.equal(repository.listEvents({ contactId: 'contact-round3', limit: 20 }).length, 1);
    learningService.stop();

    learningService.start({ storeManager: restartedManager, repository, personaBrain: { service: {} } });
    await learningService.waitForIdle();
    assert.equal(repository.listEvents({ contactId: 'contact-round3', limit: 20 }).length, 1);
    assert.equal(learningService.status().reconciliationScanned, 0);
  } finally {
    learningService.stop();
    try { store?.close(); } catch (_) {}
    try { restarted?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
