'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const learningService = require('../services/replyFeedbackLearningService');

function makeInitialState() {
  const candidatesById = {};
  const outboxById = {};
  for (let index = 1; index <= 4; index += 1) {
    candidatesById[`candidate-${index}`] = {
      candidateId: `candidate-${index}`,
      taskId: `task-${index}`,
      contactId: index === 4 ? 'contact-2' : 'contact-1',
      conversationId: index === 4 ? 'conversation-2' : 'conversation-1',
      originalText: 'This is a long generated answer with an unnecessary question and too much detail?',
      text: 'Short answer.',
      state: 'queued',
      replyStrategy: { recommendedLength: 'short', maxQuestions: 0 },
      personaProfileId: 'owner'
    };
    outboxById[`outbox-${index}`] = {
      id: `outbox-${index}`,
      taskId: `task-${index}`,
      candidateId: `candidate-${index}`,
      contactId: index === 4 ? 'contact-2' : 'contact-1',
      conversationId: index === 4 ? 'conversation-2' : 'conversation-1',
      text: 'Short answer.',
      originalText: 'This is a long generated answer with an unnecessary question and too much detail?',
      state: 'queued',
      userApproved: true,
      personaProfileId: 'owner',
      metadata: {}
    };
  }
  return createInitialState({
    customers: { ready: true, byId: { 'contact-1': { id: 'contact-1', version: 1 }, 'contact-2': { id: 'contact-2', version: 1 } } },
    memories: { ready: true, byContactId: { 'contact-1': { version: 1, preferences: {} }, 'contact-2': { version: 1, preferences: {} } } },
    aiBrain: { ready: true, tasksById: {}, candidatesById },
    outbox: { ready: true, byId: outboxById }
  });
}

test('successful edited sends close the feedback loop without mutating shared Persona learning', async () => {
  learningService.stop();
  let personaFeedbackProfile = {};
  const persistedEvents = [];
  const persistence = {
    async loadSnapshot() { return makeInitialState(); },
    async transaction(run) {
      return run({
        insertReplyFeedbackEvent(row) { persistedEvents.push(row); },
        upsertReplyFeedbackProfile(row) {
          if (row.scopeType === 'persona') personaFeedbackProfile = row.profile;
        },
        upsertOutboxItem() {},
        upsertAiReplyTask() {},
        upsertAiReplyCandidate() {},
        appendStoreEvents() {},
        persistStoreMeta() {}
      });
    }
  };
  const storeManager = new StoreManager({ persistence });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();

  let activeVersion = 1;
  const learnedUpdates = [];
  const personaBrain = {
    service: {
      getCurrent() { return { profile: { activeVersion }, version: { version: activeVersion } }; },
      updateLearned(input) {
        learnedUpdates.push(input);
        activeVersion += 1;
        return { changed: true, version: { version: activeVersion } };
      }
    }
  };
  const repository = {
    getProfile(scopeType) {
      return scopeType === 'persona' ? { profile: personaFeedbackProfile } : null;
    }
  };
  learningService.start({ storeManager, personaBrain, repository });
  try {
    for (let index = 1; index <= 4; index += 1) {
      await storeManager.dispatch({
        type: 'OUTBOX_SEND_RESULT',
        source: 'test',
        payload: { outboxId: `outbox-${index}`, success: true, sendQueueId: `queue-${index}` }
      });
      await learningService.waitForIdle();
    }
    const feedback = storeManager.select(state => state.memories.byContactId['contact-1'].feedbackLearning);
    assert.equal(feedback.effective.replyLength.value, 'short');
    assert.equal(feedback.effective.questionFrequency.value, 'low');
    assert.equal(persistedEvents.length, 4);
    assert.equal(learnedUpdates.length, 0);
  } finally {
    learningService.stop();
  }
});

test('failed sends never become learning evidence', async () => {
  learningService.stop();
  const persistence = {
    async loadSnapshot() { return makeInitialState(); },
    async transaction(run) {
      return run({
        upsertOutboxItem() {}, upsertAiReplyTask() {}, upsertAiReplyCandidate() {},
        appendStoreEvents() {}, persistStoreMeta() {}
      });
    }
  };
  const storeManager = new StoreManager({ persistence });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();
  learningService.start({
    storeManager,
    personaBrain: { service: { getCurrent: () => null } },
    repository: { getProfile: () => null }
  });
  try {
    await storeManager.dispatch({
      type: 'OUTBOX_SEND_RESULT',
      source: 'test',
      payload: { outboxId: 'outbox-1', success: false, error: 'network failed' }
    });
    await learningService.waitForIdle();
    const feedback = storeManager.select(state => state.memories.byContactId['contact-1'].feedbackLearning);
    assert.equal(feedback, undefined);
  } finally {
    learningService.stop();
  }
});
