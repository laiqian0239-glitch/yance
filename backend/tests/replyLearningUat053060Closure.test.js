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
const governanceService = require('../services/replyLearningGovernanceService');
const scopeAuthority = require('../services/replyLearningScopeAuthority');

async function withHarness(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-learning-uat-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'r32.db') });
  store.upsertAccount({ id: 'wa-1', platform: 'whatsapp', adapterAccountId: 'wa-1', displayName: 'WA One', canSend: true, canReceive: true });
  store.upsertContact({ id: 'c1', platform: 'whatsapp', accountId: 'wa-1', externalId: '491111@s.whatsapp.net', displayName: 'Customer', canonicalContactId: 'customer-shared' });
  store.upsertConversation({ sessionKey: 'conv-1', platform: 'whatsapp', accountId: 'wa-1', contactId: 'c1', title: 'Customer', routeState: 'ready', version: 1 });
  const persistence = new SqliteStorePersistenceAdapter({ store });
  const storeManager = new StoreManager({ persistence });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();
  const repository = new ReplyFeedbackRepository(store);
  learningService.stop();
  learningService.start({ storeManager, repository, personaBrain: { service: {} } });
  try {
    return await run({ root, store, storeManager, repository });
  } finally {
    learningService.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function createCandidate(storeManager, suffix = '1') {
  const task = await storeManager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test',
    payload: { contactId: 'c1', conversationId: 'conv-1', conversationRevision: 1, source: 'local_model', performanceMode: 'balanced' }
  });
  const ready = await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'test',
    payload: {
      taskId: task.result.taskId,
      text: `Dies ist eine absichtlich lange Antwort ${suffix} mit zu vielen Details und einer Frage?`,
      conversationRevision: 1,
      targetLanguage: 'de', translatedZh: `中文候选${suffix}`, translationStatus: 'success',
      modelId: 'local-model', model: 'Local Model', replyTask: 'quick_reply',
      replyStrategy: { recommendedLength: 'short', maxQuestions: 0 }
    }
  });
  return ready.result.candidateId;
}

test('UAT-053/054 lifecycle is truthful and rejection requires an explicit reason', async () => withHarness(async ({ storeManager, repository }) => {
  const candidateId = await createCandidate(storeManager, 'reject');
  await assert.rejects(
    () => storeManager.dispatch({ type: 'AI_REPLY_CANDIDATE_REJECTED', source: 'test', payload: { candidateId, reason: '' } }),
    error => error.code === 'REPLY_REJECTION_REASON_REQUIRED'
  );
  await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_REJECTED', source: 'test',
    payload: { candidateId, reason: '问题太多，语气过于正式' }
  });
  await learningService.waitForIdle();
  const lifecycle = repository.listLifecycleEvents({ contactId: 'c1', limit: 20 });
  const generated = lifecycle.find(row => row.candidateId === candidateId && row.stage === 'generated');
  const rejected = lifecycle.find(row => row.candidateId === candidateId && row.stage === 'rejected');
  assert.ok(generated);
  assert.equal(generated.learningApplied, false);
  assert.ok(rejected);
  assert.equal(rejected.sampleClass, 'negative');
  assert.equal(rejected.rejectionReason, '问题太多，语气过于正式');
  assert.equal(rejected.learningEligible, true);
  assert.equal(rejected.learningApplied, true);
}));

test('UAT-053/056/058 successful edited send records identity, applies learning, and exposes the full path', async () => withHarness(async ({ storeManager, repository }) => {
  const candidateId = await createCandidate(storeManager, 'send');
  const approved = await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test',
    payload: { candidateId, userApproved: true, approvedBy: 'user', learningMode: 'send_and_learn', source: 'local_model' }
  });
  const outboxId = approved.result.outboxId;
  await storeManager.dispatch({
    type: 'OUTBOX_TEXT_REVISED', source: 'test',
    payload: { outboxId, text: 'Kurze Antwort.', userConfirmedRevision: true }
  });
  await storeManager.dispatch({ type: 'OUTBOX_SEND_CONFIRMED', source: 'test', payload: { outboxId, confirmSend: true } });
  await storeManager.dispatch({ type: 'OUTBOX_QUEUE_LINKED', source: 'test', payload: { outboxId, sendQueueId: 'queue-1' } });
  await storeManager.dispatch({ type: 'OUTBOX_SEND_RESULT', source: 'test', payload: { outboxId, success: true, sendQueueId: 'queue-1' } });
  await learningService.waitForIdle();

  const stages = repository.listLifecycleEvents({ contactId: 'c1', limit: 30 })
    .filter(row => row.candidateId === candidateId || row.outboxId === outboxId)
    .map(row => row.stage);
  for (const stage of ['generated', 'accepted', 'edited', 'send_confirmed', 'queued', 'sent']) assert.ok(stages.includes(stage), stage);
  const sent = repository.listLifecycleEvents({ contactId: 'c1', limit: 30 }).find(row => row.outboxId === outboxId && row.stage === 'sent');
  assert.equal(sent.statusTruth, 'success');
  assert.equal(sent.learningApplied, true);
  assert.equal(sent.sourceAccountId, 'wa-1');
  const learned = repository.listEvents({ contactId: 'c1', limit: 10 }).find(row => row.id === `sent:${outboxId}`);
  assert.equal(learned.platform, 'whatsapp');
  assert.equal(learned.sourceAccountId, 'wa-1');
  assert.equal(learned.platformContactIdentity, '491111@s.whatsapp.net');
  assert.equal(learned.canonicalContactId, 'customer-shared');
  assert.equal(learned.targetLanguage, 'de');
  assert.equal(learned.translatedZh, '中文候选send');
  assert.equal(learned.learningMode, 'send_and_learn');
}));

test('UAT-059 permanent forget deletes contact learning and removes its evidence from wider scopes and histories', async () => withHarness(async ({ store, storeManager, repository }) => {
  for (let index = 1; index <= 4; index += 1) {
    scopeAuthority.recordFeedback({
      evidenceId: `c1:${index}`, eventType: 'sent', contactId: 'c1', conversationId: 'conv-1',
      platform: 'whatsapp', sourceAccountId: 'wa-1', platformContactIdentity: '491111@s.whatsapp.net', canonicalContactId: 'customer-shared',
      originalText: 'A much longer answer with a question?', finalText: 'Short.', observedAt: `2026-07-22T00:00:0${index}.000Z`
    }, { store });
  }
  await storeManager.dispatch({
    type: 'AI_REPLY_FEEDBACK_RECORDED', source: 'test',
    payload: {
      evidenceId: 'manual-c1', eventType: 'rejected', contactId: 'c1', conversationId: 'conv-1',
      rejectionReason: '问题太多', platform: 'whatsapp', sourceAccountId: 'wa-1',
      platformContactIdentity: '491111@s.whatsapp.net', canonicalContactId: 'customer-shared', observedAt: '2026-07-22T00:01:00.000Z'
    }
  });
  assert.ok(repository.listEvents({ contactId: 'c1' }).length > 0);
  const result = await governanceService.forget({ contactId: 'c1', confirmForget: true, actor: 'user' }, { storeManager, store });
  assert.equal(result.forgotten, true);
  assert.deepEqual(repository.listEvents({ contactId: 'c1' }), []);
  assert.deepEqual(repository.listVersions('contact', 'c1'), []);
  assert.equal(storeManager.select(state => state.memories.byContactId.c1.feedbackLearning), undefined);
  const scopeRows = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scopes").all();
  for (const row of scopeRows) {
    const profile = JSON.parse(row.profileJson);
    assert.equal((profile.evidence || []).some(item => item.contactId === 'c1'), false);
  }
  const historicalRows = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scope_versions").all();
  for (const row of historicalRows) {
    const profile = JSON.parse(row.profileJson);
    assert.equal((profile.evidence || []).some(item => item.contactId === 'c1'), false);
  }
}));

test('UAT-060 governance distinguishes lifecycle records from actual learning samples', async () => withHarness(async ({ store, storeManager }) => {
  const candidateId = await createCandidate(storeManager, 'truth');
  const governanceBefore = governanceService.getGovernance('c1', { storeManager, store });
  assert.ok(governanceBefore.lifecycleEvents.some(row => row.candidateId === candidateId && row.stage === 'generated'));
  assert.equal(governanceBefore.events.length, 0);
  assert.equal(governanceBefore.truth.lifecycleProjectionSource, 'sqlite-store-event-log');
  assert.equal(governanceBefore.truth.actualLearningSource, 'sqlite-ai-reply-feedback-events');
  assert.equal(governanceBefore.truth.platformScopeIncludesSourceAccountId, true);
}));
