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

function seedStore(dbPath) {
  const store = new R32SqliteStore({ dbPath });
  store.upsertAccount({ id: 'fb-r4', platform: 'facebook', adapterAccountId: 'page-r4', displayName: 'Page R4', canSend: true, canReceive: true });
  store.upsertContact({
    id: 'contact-r4', platform: 'facebook', accountId: 'fb-r4', externalId: 'psid-r4',
    displayName: 'Customer R4', canonicalContactId: 'canonical-r4'
  });
  store.upsertConversation({
    sessionKey: 'conversation-r4', platform: 'facebook', accountId: 'fb-r4',
    contactId: 'contact-r4', title: 'Customer R4', routeState: 'ready', version: 1
  });
  return store;
}

async function managerFor(store) {
  const manager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store }) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  return manager;
}

async function createRejectedCandidate(manager) {
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'round4-test',
    payload: {
      contactId: 'contact-r4', conversationId: 'conversation-r4', conversationRevision: 1,
      source: 'openrouter', performanceMode: 'balanced'
    }
  });
  const ready = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'round4-test',
    payload: {
      taskId: task.result.taskId,
      text: 'Das ist wirklich sehr interessant, erzähl mir bitte alles ganz genau?',
      conversationRevision: 1,
      targetLanguage: 'de', translatedZh: '这真的很有意思，请非常详细地告诉我一切？',
      translationStatus: 'success', modelId: 'reply-r4', model: 'Reply R4', replyTask: 'quick_reply',
      source: 'openrouter', personaProfileId: 'owner', personaVersionId: 4,
      generationMetadata: {
        requestId: 'request-r4-rejected', modelId: 'reply-r4', model: 'Reply R4',
        replyTask: 'quick_reply', targetLanguage: 'de', styleVariant: 'formal-long'
      },
      director: {
        modelId: 'director-r4', model: 'Director R4', variant: 'formal-long',
        strategy: 'ask-for-details', maxQuestions: 1
      },
      replyStrategy: { recommendedLength: 'long', maxQuestions: 1 }
    }
  });
  await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_REJECTED', source: 'round4-test',
    payload: { candidateId: ready.result.candidateId, reason: '太正式、太长，而且不想提问' }
  });
  return ready.result.candidateId;
}

test('Round 4 recovers explicit rejection learning after a crash and preserves director/model evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round4-rejected-recovery-'));
  const dbPath = path.join(root, 'r32.db');
  learningService.stop();
  let firstStore;
  let restartedStore;
  try {
    firstStore = seedStore(dbPath);
    const firstManager = await managerFor(firstStore);
    const candidateId = await createRejectedCandidate(firstManager);
    assert.equal(firstStore.db.prepare('SELECT COUNT(*) AS count FROM ai_reply_feedback_events').get().count, 0);
    firstStore.close();
    firstStore = null;

    restartedStore = new R32SqliteStore({ dbPath });
    const restartedManager = await managerFor(restartedStore);
    const repository = new ReplyFeedbackRepository(restartedStore);
    const pending = repository.listPendingRejectedCandidates();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].candidateId, candidateId);
    assert.equal(pending[0].rejectionReason, '太正式、太长，而且不想提问');
    assert.equal(pending[0].generationMetadata.director.modelId, 'director-r4');

    learningService.start({ storeManager: restartedManager, repository, personaBrain: { service: {} } });
    await learningService.waitForIdle();

    const learned = repository.listEvents({ contactId: 'contact-r4', limit: 10 });
    assert.equal(learned.length, 1);
    assert.equal(learned[0].id, `rejected:${candidateId}`);
    assert.equal(learned[0].eventType, 'rejected');
    assert.equal(learned[0].rejectionReason, '太正式、太长，而且不想提问');
    assert.equal(learned[0].modelId, 'reply-r4');
    assert.equal(learned[0].generationMetadata.requestId, 'request-r4-rejected');
    assert.equal(learned[0].generationMetadata.director.modelId, 'director-r4');
    assert.equal(learned[0].platform, 'facebook');
    assert.equal(learned[0].sourceAccountId, 'fb-r4');
    assert.equal(repository.listPendingRejectedCandidates().length, 0);
    assert.equal(learningService.status().rejectedCandidateReconciled, 1);
  } finally {
    learningService.stop();
    try { firstStore?.close(); } catch (_) {}
    try { restartedStore?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Round 4 learnable sends cannot be starved by older send-only terminal rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round4-backlog-starvation-'));
  const store = seedStore(path.join(root, 'r32.db'));
  try {
    const now = new Date().toISOString();
    const insertCandidate = store.db.prepare(`
      INSERT INTO ai_reply_candidates(
        candidate_id,task_id,contact_id,conversation_id,text,original_text,model_id,model_name,
        context_version,entity_versions_json,reply_strategy_json,relationship_potential_json,state,
        persona_profile_id,persona_version_id,persona_policy_hash,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,0,'{}','{}','{}','sent','owner',0,'',?,?)
    `);
    const insertOutbox = store.db.prepare(`
      INSERT INTO ai_reply_outbox(
        id,task_id,candidate_id,contact_id,conversation_id,account_id,platform,text,original_text,
        state,user_approved,approved_at,approved_by,send_queue_id,context_version,metadata_json,
        persona_profile_id,persona_version_id,persona_policy_hash,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,'Hallo','Hallo','sent',1,?,'user','queue',0,?,'owner',0,'',?,?)
    `);
    for (let index = 0; index < 300; index += 1) {
      const candidateId = `candidate-private-${index}`;
      insertCandidate.run(candidateId, `task-private-${index}`, 'contact-r4', 'conversation-r4', 'Hallo', 'Hallo', '', '', now, now);
      insertOutbox.run(`outbox-private-${index}`, `task-private-${index}`, candidateId, 'contact-r4', 'conversation-r4', 'fb-r4', 'facebook', now, JSON.stringify({ learningMode: 'send_only' }), now, now);
    }
    insertCandidate.run('candidate-learnable', 'task-learnable', 'contact-r4', 'conversation-r4', 'Hallo', 'Hallo', '', '', now, now);
    insertOutbox.run('outbox-learnable', 'task-learnable', 'candidate-learnable', 'contact-r4', 'conversation-r4', 'fb-r4', 'facebook', now, JSON.stringify({ learningMode: 'send_and_learn' }), now, now);

    const repository = new ReplyFeedbackRepository(store);
    const pending = repository.listPendingSuccessfulSends({ limit: 1 });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].outboxId, 'outbox-learnable');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
