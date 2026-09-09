'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { registerRuntimeStateCommands } = require('../store/commands/registerRuntimeStateCommands');
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

test('successful edited sends persist immutable Learning V4 evidence without mutating shared Persona learning', async () => {
  learningService.stop();
  const immutableSignals = [];
  const originalPersistImmutableLearningSignal = learningService.persistImmutableLearningSignal;
  learningService.persistImmutableLearningSignal = (_transaction, input) => {
    immutableSignals.push(structuredClone(input));
    return { persisted: true, profileChanged: false };
  };
  const persistence = {
    async loadSnapshot() { return makeInitialState(); },
    async transaction(run) {
      return run({
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

  try {
    for (let index = 1; index <= 4; index += 1) {
      await storeManager.dispatch({
        type: 'OUTBOX_SEND_RESULT',
        source: 'test',
        payload: { outboxId: `outbox-${index}`, success: true, sendQueueId: `queue-${index}` }
      });
    }
    assert.equal(immutableSignals.length, 4);
    assert.deepEqual(immutableSignals.map(signal => signal.evidenceId), [
      'outbox-1', 'outbox-2', 'outbox-3', 'outbox-4'
    ]);
    assert.deepEqual(immutableSignals.map(signal => signal.eventType), ['sent', 'sent', 'sent', 'sent']);
    assert.equal(immutableSignals.filter(signal => signal.contactId === 'contact-1').length, 3);
    assert.equal(storeManager.select(state => state.memories.byContactId['contact-1'].feedbackLearning), undefined);
    assert.equal(learningService.status().mode, 'transaction-bound-immutable-signal-ledger');
    assert.equal(learningService.status().automaticProfileMutation, false);
  } finally {
    learningService.persistImmutableLearningSignal = originalPersistImmutableLearningSignal;
    learningService.stop();
  }
});

test('failed sends never become immutable Learning V4 evidence', async () => {
  learningService.stop();
  const immutableSignals = [];
  const originalPersistImmutableLearningSignal = learningService.persistImmutableLearningSignal;
  learningService.persistImmutableLearningSignal = (_transaction, input) => {
    immutableSignals.push(structuredClone(input));
    return { persisted: true, profileChanged: false };
  };
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
  try {
    await storeManager.dispatch({
      type: 'OUTBOX_SEND_RESULT',
      source: 'test',
      payload: { outboxId: 'outbox-1', success: false, error: 'network failed' }
    });
    assert.equal(immutableSignals.length, 0);
    assert.equal(storeManager.select(state => state.memories.byContactId['contact-1'].feedbackLearning), undefined);
  } finally {
    learningService.persistImmutableLearningSignal = originalPersistImmutableLearningSignal;
    learningService.stop();
  }
});


function makeElementAssistState(mode = 'AI_ASSIST') {
  const receipt = {
    id: `receipt-${mode.toLowerCase()}`,
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    mode,
    policyVersion: 1,
    actor: 'user',
    setAt: '2026-09-06T16:00:00.000Z'
  };
  return createInitialState({
    auth: {
      ready: true,
      accountsById: {
        'account-1': {
          id: 'account-1',
          state: 'ready',
          canAttemptSend: true,
          canSend: true,
          sendVerified: true
        }
      }
    },
    customers: {
      ready: true,
      byId: {
        'contact-1': {
          id: 'contact-1',
          version: 1,
          accountId: 'account-1',
          platform: 'whatsapp'
        }
      }
    },
    conversations: {
      ready: true,
      byId: {
        'conversation-1': {
          id: 'conversation-1',
          version: 3,
          contactId: 'contact-1',
          accountId: 'account-1',
          platform: 'whatsapp'
        }
      }
    },
    interactionPolicies: {
      ready: true,
      byContactId: {
        'contact-1': {
          version: 1,
          allowReplies: true,
          blocked: false,
          config: {
            conversationAutomationModes: {
              'conversation-1': receipt
            }
          }
        }
      }
    },
    memories: {
      ready: true,
      byContactId: {
        'contact-1': { version: 1, preferences: {} }
      }
    },
    aiBrain: {
      ready: true,
      tasksById: {
        'task-element-1': {
          taskId: 'task-element-1',
          contactId: 'contact-1',
          conversationId: 'conversation-1',
          status: 'awaiting_send_confirmation'
        }
      },
      candidatesById: {
        'candidate-element-1': {
          candidateId: 'candidate-element-1',
          taskId: 'task-element-1',
          contactId: 'contact-1',
          conversationId: 'conversation-1',
          originalText: 'Reviewed reply',
          text: 'Reviewed reply',
          state: 'approved',
          source: 'local_model'
        }
      }
    },
    outbox: {
      ready: true,
      byId: {
        'outbox-element-1': {
          id: 'outbox-element-1',
          taskId: 'task-element-1',
          candidateId: 'candidate-element-1',
          contactId: 'contact-1',
          conversationId: 'conversation-1',
          accountId: 'account-1',
          platform: 'whatsapp',
          text: 'Reviewed reply',
          originalText: 'Reviewed reply',
          state: 'approved',
          authorizationType: mode === 'AI_AUTO' ? 'machine' : 'human',
          machineApproved: mode === 'AI_AUTO',
          userApproved: mode !== 'AI_AUTO',
          automationReceipt: mode === 'AI_AUTO' ? receipt : null,
          metadata: {
            conversationRevision: 3,
            targetLanguage: 'English',
            targetLanguageCode: 'en',
            languageAuthority: { code: 'en' },
            automationMode: mode,
            automationReceipt: mode === 'AI_AUTO' ? receipt : null,
            learningEligible: true
          }
        }
      }
    }
  });
}

function elementPersistence(initialState) {
  return {
    async loadSnapshot() { return initialState; },
    async transaction(run) {
      return run({
        upsertOutboxItem() {},
        upsertAiReplyTask() {},
        upsertAiReplyCandidate() {},
        upsertInteractionPolicy() {},
        appendStoreEvents() {},
        persistStoreMeta() {}
      });
    }
  };
}

test('AI_ASSIST uses Store preflight then one real Element completion without entering SendQueue', async () => {
  learningService.stop();
  const immutableSignals = [];
  const originalPersistImmutableLearningSignal = learningService.persistImmutableLearningSignal;
  learningService.persistImmutableLearningSignal = (_transaction, input) => {
    immutableSignals.push(structuredClone(input));
    return { persisted: true };
  };
  const storeManager = new StoreManager({
    persistence: elementPersistence(makeElementAssistState())
  });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();

  await assert.rejects(
    storeManager.dispatch({
      type: 'OUTBOX_SEND_CONFIRMED',
      source: 'stale-product-ui',
      payload: { outboxId: 'outbox-element-1', confirmSend: true }
    }),
    error => error?.code === 'AI_ASSIST_ELEMENT_SEND_REQUIRED'
  );

  const prepared = await storeManager.dispatch({
    type: 'OUTBOX_ELEMENT_SEND_PREFLIGHT',
    source: 'element-send-preflight',
    payload: {
      outboxId: 'outbox-element-1',
      confirmElementSend: true,
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      accountId: 'account-1',
      matrixRoomId: '!relationship-room:example.org',
      finalText: 'Final reviewed reply'
    }
  });
  assert.ok(prepared.result.elementSendAttemptId);
  assert.equal(prepared.result.state, 'approved');
  const preparedOutbox = storeManager.select(state => state.outbox.byId['outbox-element-1']);
  assert.equal(preparedOutbox.state, 'approved');
  assert.equal(preparedOutbox.text, 'Final reviewed reply');
  assert.equal(preparedOutbox.metadata.physicalSendOwner, 'element');
  assert.equal(preparedOutbox.metadata.elementSendState, 'prepared');
  assert.equal(storeManager.select(state => state.aiBrain.candidatesById['candidate-element-1'].text), 'Final reviewed reply');

  const completed = await storeManager.dispatch({
    type: 'OUTBOX_SEND_RESULT',
    source: 'element-send-completion',
    payload: {
      outboxId: 'outbox-element-1',
      success: true,
      physicalSendOwner: 'element',
      elementSendAttemptId: prepared.result.elementSendAttemptId,
      matrixRoomId: '!relationship-room:example.org',
      matrixEventId: '$event-real-1',
      finalText: 'Final reviewed reply'
    }
  });
  assert.equal(completed.result.state, 'sent');
  assert.equal(completed.result.matrixEventId, '$event-real-1');
  const sent = storeManager.select(state => state.outbox.byId['outbox-element-1']);
  assert.equal(sent.metadata.elementSendState, 'completed');
  assert.equal(sent.metadata.matrixEventId, '$event-real-1');
  assert.equal(sent.sendQueueId, '');
  assert.equal(immutableSignals.length, 1);
  assert.equal(immutableSignals[0].evidenceId, '$event-real-1');
  assert.deepEqual(immutableSignals[0].decisionRecord, {
    physicalSendOwner: 'element',
    matrixRoomId: '!relationship-room:example.org',
    matrixEventId: '$event-real-1',
    elementSendAttemptId: prepared.result.elementSendAttemptId
  });

  const duplicate = await storeManager.dispatch({
    type: 'OUTBOX_SEND_RESULT',
    source: 'element-send-completion-retry',
    payload: {
      outboxId: 'outbox-element-1',
      success: true,
      physicalSendOwner: 'element',
      elementSendAttemptId: prepared.result.elementSendAttemptId,
      matrixRoomId: '!relationship-room:example.org',
      matrixEventId: '$event-real-1',
      finalText: 'Final reviewed reply'
    }
  });
  assert.equal(duplicate.result.state, 'sent');
  assert.equal(immutableSignals.length, 1);
  learningService.persistImmutableLearningSignal = originalPersistImmutableLearningSignal;
});

test('AI_ASSIST Element completion fails closed on stale room/event/text binding', async () => {
  const storeManager = new StoreManager({
    persistence: elementPersistence(makeElementAssistState())
  });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();

  const prepared = await storeManager.dispatch({
    type: 'OUTBOX_ELEMENT_SEND_PREFLIGHT',
    source: 'element-send-preflight',
    payload: {
      outboxId: 'outbox-element-1',
      confirmElementSend: true,
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      accountId: 'account-1',
      matrixRoomId: '!relationship-room:example.org',
      finalText: 'Final reviewed reply'
    }
  });

  await assert.rejects(
    storeManager.dispatch({
      type: 'OUTBOX_SEND_RESULT',
      source: 'stale-element-completion',
      payload: {
        outboxId: 'outbox-element-1',
        success: true,
        physicalSendOwner: 'element',
        elementSendAttemptId: prepared.result.elementSendAttemptId,
        matrixRoomId: '!wrong-room:example.org',
        matrixEventId: '$event-wrong-room',
        finalText: 'Final reviewed reply'
      }
    }),
    error => error?.code === 'ELEMENT_SEND_COMPLETION_STALE'
  );
  assert.equal(storeManager.select(state => state.outbox.byId['outbox-element-1'].state), 'approved');
});


test('AI_ASSIST completion records the real Matrix send even if the user changes mode after preflight', async () => {
  const storeManager = new StoreManager({
    persistence: elementPersistence(makeElementAssistState())
  });
  registerRuntimeStateCommands(storeManager);
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();

  const prepared = await storeManager.dispatch({
    type: 'OUTBOX_ELEMENT_SEND_PREFLIGHT',
    source: 'element-send-preflight',
    payload: {
      outboxId: 'outbox-element-1',
      confirmElementSend: true,
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      accountId: 'account-1',
      matrixRoomId: '!relationship-room:example.org',
      finalText: 'Final reviewed reply'
    }
  });

  await storeManager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET',
    source: 'manual-mode-change',
    payload: { conversationId: 'conversation-1', contactId: 'contact-1', mode: 'HUMAN', actor: 'user' }
  });

  const completed = await storeManager.dispatch({
    type: 'OUTBOX_SEND_RESULT',
    source: 'element-send-completion',
    payload: {
      outboxId: 'outbox-element-1',
      success: true,
      physicalSendOwner: 'element',
      elementSendAttemptId: prepared.result.elementSendAttemptId,
      matrixRoomId: '!relationship-room:example.org',
      matrixEventId: '$event-after-mode-change',
      finalText: 'Final reviewed reply'
    }
  });
  assert.equal(completed.result.state, 'sent');
  assert.equal(completed.result.matrixEventId, '$event-after-mode-change');
});

test('AI_AUTO keeps the existing OUTBOX_SEND_CONFIRMED SendQueue authorization path', async () => {
  const storeManager = new StoreManager({
    persistence: elementPersistence(makeElementAssistState('AI_AUTO'))
  });
  registerAiReplyCommands(storeManager);
  await storeManager.hydrate();

  const receipt = storeManager.select(
    state => state.interactionPolicies.byContactId['contact-1'].config.conversationAutomationModes['conversation-1']
  );
  const confirmed = await storeManager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED',
    source: 'ai-auto',
    payload: {
      outboxId: 'outbox-element-1',
      authorizationType: 'machine',
      machineApproved: true,
      automationReceipt: receipt
    }
  });
  assert.equal(confirmed.result.outboxId, 'outbox-element-1');
  assert.equal(storeManager.select(state => state.outbox.byId['outbox-element-1'].state), 'send_confirmed');
});
