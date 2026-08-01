'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const performancePolicy = require('../services/replyPerformancePolicy');
const { ConversationTurnCoordinator } = require('../services/conversationTurnCoordinator');
const { validateFastReplyCandidate } = require('../services/replyQualityGuard');
const learningService = require('../services/replyFeedbackLearningService');
const contactContextAuthority = require('../services/contactContextAuthority');
const conversationTurnCoordinator = require('../services/conversationTurnCoordinator');
const typingStateService = require('../services/typingStateService');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const { createContextAwareReplyBrain, buildModelMessages } = require('../services/contextAwareReplyBrain');

function memoryPersistence(initialState) {
  return {
    async loadSnapshot() { return initialState; },
    async transaction(run) {
      return run({
        upsertAiReplyTask() {}, upsertAiReplyCandidate() {}, upsertOutboxItem() {},
        insertAiContextSnapshot() {}, insertReplyFeedbackEvent() {}, upsertReplyFeedbackProfile() {},
        appendStoreEvents() {}, persistStoreMeta() {}
      });
    }
  };
}

function commandState(options = {}) {
  const conversationRevision = Number(options.conversationRevision || 3);
  return createInitialState({
    auth: { ready: true, accountsById: { account1: { id: 'account1', state: 'ready', canAttemptSend: true, sendVerified: true, canSend: true } } },
    customers: { ready: true, byId: { contact1: { id: 'contact1', version: 1, accountId: 'account1', platform: 'whatsapp' } } },
    conversations: { ready: true, byId: { conv1: { id: 'conv1', version: conversationRevision, contactId: 'contact1', accountId: 'account1', platform: 'whatsapp' } } },
    relationships: { ready: true, byContactId: { contact1: { version: 1 } } },
    memories: { ready: true, byContactId: { contact1: { version: 1, preferences: {} } } },
    interactionPolicies: { ready: true, byContactId: { contact1: { version: 1, allowReplies: true, blocked: false } } },
    routing: { ready: true, byTask: {} },
    aiBrain: { ready: true, tasksById: {}, candidatesById: {} },
    outbox: { ready: true, byId: {} }
  });
}

function socialContext() {
  return {
    found: true,
    ready: true,
    contactId: 'contact1',
    contextVersion: 11,
    entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 },
    guards: { canGenerateReply: true, blockReason: '' },
    relationshipPotential: { relationshipStage: 'warming', warmth: 0.7, openness: 0.6 },
    emotion: { trend: 'warm', current: 'positive' },
    interaction: { cadence: 'rapid' },
    preferences: { replyLength: 'short' },
    feedbackLearning: { effective: {} },
    interactionPolicy: { policy: { allowReplies: true } },
    replyStrategy: { recommendedTone: 'natural', recommendedLength: 'short', recommendedDepth: 'light', toneWeights: {}, maxQuestions: 1 },
    memory: {
      confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [], promises: [],
      boundaries: [], sensitiveTopics: [], recurringInterests: []
    },
    timeline: [],
    recentSignals: [],
    recentMessages: [
      { id: 'm1', direction: 'inbound', text: '你在做什么？', sentAt: '2026-07-18T10:00:00Z' },
      { id: 'm2', direction: 'inbound', text: '我刚下班', sentAt: '2026-07-18T10:00:02Z' }
    ]
  };
}

test('reply performance policy keeps rapid, balanced and deep provide selectable candidates', () => {
  assert.equal(performancePolicy.policyFor({ performanceMode: 'rapid' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'balanced' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'deep' }, {}).candidateCount, 5);
  assert.ok(performancePolicy.MODES.rapid.maxContextChars < performancePolicy.MODES.balanced.maxContextChars);
  assert.ok(performancePolicy.MODES.balanced.maxContextChars < performancePolicy.MODES.deep.maxContextChars);
  assert.equal(performancePolicy.inferMode({}, { incomingMessage: { text: '在吗' }, recentMessages: [] }), 'rapid');
});

test('legacy SQLite reply tables migrate in place without losing the existing database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-dating-reply-migration-'));
  const dbPath = path.join(root, 'store.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE ai_reply_tasks (
      task_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      context_version INTEGER NOT NULL DEFAULT 0, entity_versions_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued', cancel_reason TEXT NOT NULL DEFAULT '',
      error_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE ai_reply_candidates (
      candidate_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, contact_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL, text TEXT NOT NULL, original_text TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '', model_name TEXT NOT NULL DEFAULT '', context_version INTEGER NOT NULL DEFAULT 0,
      entity_versions_json TEXT NOT NULL DEFAULT '{}', reply_strategy_json TEXT NOT NULL DEFAULT '{}',
      relationship_potential_json TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT 'generated',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE ai_reply_feedback_events (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, candidate_id TEXT NOT NULL DEFAULT '', outbox_id TEXT NOT NULL DEFAULT '',
      contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '', persona_profile_id TEXT NOT NULL DEFAULT 'owner',
      original_text TEXT NOT NULL DEFAULT '', final_text TEXT NOT NULL DEFAULT '', rejection_reason TEXT NOT NULL DEFAULT '',
      signals_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    ) STRICT;
  `);
  legacy.close();
  const store = new R32SqliteStore({ dbPath });
  try {
    const columns = table => new Set(store.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    const task = columns('ai_reply_tasks');
    const candidate = columns('ai_reply_candidates');
    const feedback = columns('ai_reply_feedback_events');
    for (const name of ['conversation_revision', 'performance_mode', 'reply_source']) assert.equal(task.has(name), true, name);
    for (const name of ['conversation_revision', 'context_message_ids_json', 'performance_mode', 'reply_source']) assert.equal(candidate.has(name), true, name);
    for (const name of ['reply_source', 'context_revision', 'context_message_ids_json', 'performance_mode']) assert.equal(feedback.has(name), true, name);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('interaction policy remains advisory while archived contacts still block the technical send path', async () => {
  const state = commandState({ conversationRevision: 3 });
  state.interactionPolicies.byContactId.contact1 = { version: 2, allowReplies: false, blocked: true, blockReason: 'RELATIONSHIP_ADVISORY' };
  const manager = new StoreManager({ persistence: memoryPersistence(state) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test', payload: {
      contactId: 'contact1', conversationId: 'conv1', conversationRevision: 3,
      performanceMode: 'rapid', source: 'manual', entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 2, routing: 0 }
    }
  });
  assert.ok(task.result.taskId);
  const archivedState = commandState({ conversationRevision: 3 });
  archivedState.customers.byId.contact1.archivedAt = '2026-07-18T00:00:00.000Z';
  const archivedManager = new StoreManager({ persistence: memoryPersistence(archivedState) });
  registerAiReplyCommands(archivedManager);
  await archivedManager.hydrate();
  await assert.rejects(archivedManager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test', payload: { contactId: 'contact1', conversationId: 'conv1' }
  }), error => error.code === 'ARCHIVED_CUSTOMER_READ_ONLY');
});

test('fast technical guard does not run relationship-value blocking but still blocks secrets', () => {
  const provocative = validateFastReplyCandidate('让他吃醋一下也许挺有意思。', {});
  assert.equal(provocative.pass, true);
  const secret = validateFastReplyCandidate('api_key = sk-abcdefghijklmnopqrstuvwxyz123456', {});
  assert.equal(secret.pass, false);
  assert.ok(secret.blockers.some(row => row.code === 'OBVIOUS_SECRET_LEAK'));
});

test('conversation turn coordinator increments only for inbound content and groups message ids', () => {
  const bus = new EventEmitter();
  let now = 1000;
  const coordinator = new ConversationTurnCoordinator({ eventBus: bus, clock: () => now });
  coordinator.start();
  bus.emit('message:inserted', { payload: { message: { id: 'm1', conversationId: 'conv1', direction: 'inbound', type: 'text' } } });
  now += 20;
  bus.emit('message:inserted', { payload: { message: { id: 'receipt', conversationId: 'conv1', direction: 'inbound', type: 'read' } } });
  now += 20;
  bus.emit('message:inserted', { payload: { message: { id: 'mine', conversationId: 'conv1', direction: 'outbound', type: 'text' } } });
  now += 20;
  bus.emit('message:inserted', { payload: { message: { id: 'm2', conversationId: 'conv1', direction: 'inbound', type: 'image' } } });
  const snapshot = coordinator.capture('conv1', 9);
  assert.equal(snapshot.runtimeRevision, 2);
  assert.deepEqual(snapshot.pendingMessageIds, ['m1', 'm2']);
  assert.equal(coordinator.isCurrent(snapshot, 9), true);
  coordinator.stop();
});

test('candidate approval is rejected when the conversation revision changed', async () => {
  const state = commandState({ conversationRevision: 4 });
  state.aiBrain.tasksById.task1 = {
    taskId: 'task1', contactId: 'contact1', conversationId: 'conv1', status: 'generated',
    entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 }
  };
  state.aiBrain.candidatesById.candidate1 = {
    candidateId: 'candidate1', taskId: 'task1', contactId: 'contact1', conversationId: 'conv1',
    text: '晚上聊', originalText: '晚上聊', state: 'generated', conversationRevision: 3,
    entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 },
    replyStrategy: {}, relationshipPotential: {}, personaProfileId: 'owner'
  };
  const manager = new StoreManager({ persistence: memoryPersistence(state) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  await assert.rejects(manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test',
    payload: { candidateId: 'candidate1', userApproved: true, approvedBy: 'user', learningMode: 'send_and_learn' }
  }), error => error.code === 'AI_REPLY_CANDIDATE_REVERIFY_REQUIRED');
});

test('approved reply persists learning mode, source and conversation binding in outbox metadata', async () => {
  const state = commandState({ conversationRevision: 3 });
  const manager = new StoreManager({ persistence: memoryPersistence(state) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test', payload: {
      contactId: 'contact1', conversationId: 'conv1', conversationRevision: 3,
      performanceMode: 'rapid', source: 'external_paste',
      entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 }
    }
  });
  const candidate = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'test', payload: {
      taskId: task.result.taskId, text: '刚看到你的消息，突然想笑。', conversationRevision: 3,
      contextMessageIds: ['m1', 'm2'], performanceMode: 'rapid', source: 'external_paste'
    }
  });
  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test', payload: {
      candidateId: candidate.result.candidateId, userApproved: true, approvedBy: 'user',
      learningMode: 'send_and_learn', source: 'external_paste'
    }
  });
  const outbox = manager.select(current => current.outbox.byId[approved.result.outboxId]);
  assert.equal(outbox.metadata.learningMode, 'send_and_learn');
  assert.equal(outbox.metadata.replySource, 'external_paste');
  assert.equal(outbox.metadata.conversationRevision, 3);
  assert.deepEqual(outbox.metadata.contextMessageIds, ['m1', 'm2']);
});

test('send_only successful messages do not enter reply learning', async () => {
  let dispatches = 0;
  const manager = {
    select(selector) {
      return selector({
        outbox: { byId: { o1: { id: 'o1', candidateId: 'c1', contactId: 'contact1', metadata: { learningMode: 'send_only' } } } },
        aiBrain: { candidatesById: { c1: { candidateId: 'c1', contactId: 'contact1', originalText: 'A', text: 'B' } } }
      });
    },
    async dispatch() { dispatches += 1; }
  };
  await learningService.processEvent(manager, { service: {} }, { getProfile: () => null }, {
    eventType: 'outbox.sent', entityId: 'o1', payload: { outboxId: 'o1' }
  });
  assert.equal(dispatches, 0);
});

test('fast reply generation runs director then reply and commits aggregated context binding', async t => {
  const context = socialContext();
  let modelCalls = 0;
  const modelTasks = [];
  let personaCompileCalls = 0;
  const dispatches = [];
  const state = { conversations: { byId: { conv1: { id: 'conv1', version: 7 } } } };
  const manager = {
    select(selector) { return selector(state); },
    async dispatch(command) {
      dispatches.push(command);
      if (command.type === 'AI_REPLY_TASK_STARTED') return { result: { taskId: 'task1' } };
      if (command.type === 'AI_REPLY_CANDIDATE_READY') return { result: { candidateId: 'candidate1' } };
      return { result: {} };
    }
  };
  const gateway = {
    async execute(input) {
      modelCalls += 1;
      modelTasks.push(input.task);
      if (input.task === 'director') {
        return {
          text: JSON.stringify({
            strategy: '自然承接', reasonZh: '承接对方刚下班的状态', goal: '轻松继续聊天',
            tone: '自然温暖', pace: '轻快', instruction: '简短回应并留一个轻松钩子', avoid: '过度客套',
            targetLanguage: 'zh', maxQuestions: 1
          }),
          modelId: 'director-1', model: 'director'
        };
      }
      input.options.onToken?.('晚', '晚');
      return { text: '晚点告诉你 😄', modelId: 'local-1', model: 'local' };
    }
  };
  const persona = {
    compileEffectiveContext() {
      personaCompileCalls += 1;
      return { profileId: 'owner', personaVersionId: 1, policyHash: 'hash1', effectiveLabel: 'owner', appliedScopes: [], context: { persona: { truthSafePacket: { style: {}, preferredLanguage: 'Chinese', runtimeAuthority: { authority: 'YancePersonaRuntimeTruthAuthority', pass: true, receiptSha256: 'test-truth-receipt' } }, learned: {} } } };
    }
  };
  t.mock.method(contactContextAuthority, 'getSocialContext', () => context);
  t.mock.method(conversationTurnCoordinator, 'waitForQuiet', async () => ({ waitedMs: 0 }));
  t.mock.method(conversationTurnCoordinator, 'capture', (_id, persistedRevision) => ({ conversationId: 'conv1', runtimeRevision: 0, persistedRevision }));
  t.mock.method(conversationTurnCoordinator, 'isCurrent', () => true);
  t.mock.method(conversationTurnCoordinator, 'settle', () => {});
  t.mock.method(typingStateService, 'beginAiGeneration', async () => ({}));
  t.mock.method(typingStateService, 'endAiGeneration', async () => ({}));
  t.mock.method(aiTaskRuntimeRegistry, 'replace', async () => ({ signal: new AbortController().signal, generation: 1 }));
  t.mock.method(aiTaskRuntimeRegistry, 'finish', () => {});

  const brain = createContextAwareReplyBrain({ storeManager: manager, aiGateway: gateway, personaBrain: persona });
  const result = await brain.generateCandidate({
    contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'm2', text: '我刚下班' },
    performanceMode: 'rapid', skipQuietWindow: true
  });
  assert.equal(modelCalls, 2);
  assert.deepEqual(modelTasks, ['director', 'quick_reply']);
  assert.equal(personaCompileCalls, 2, 'candidate commit must recompile Persona once to block stale profile or policy changes');
  assert.equal(result.performanceMode, 'rapid');
  assert.equal(result.performancePolicy.candidateCount, 3);
  assert.equal(result.conversationRevision, 7);
  const started = dispatches.find(row => row.type === 'AI_REPLY_TASK_STARTED');
  const ready = dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY');
  assert.equal(Object.hasOwn(started, 'expectedStateVersion'), false);
  assert.equal(Object.hasOwn(ready, 'expectedStateVersion'), false);
  assert.deepEqual(ready.payload.contextMessageIds, ['m1', 'm2']);
  assert.equal(ready.payload.source, 'local_model');
});


test('a successfully sent reply becomes an immediate contact-only example without waiting for style threshold', async () => {
  const state = commandState({ conversationRevision: 3 });
  const manager = new StoreManager({ persistence: memoryPersistence(state) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  const result = await manager.dispatch({
    type: 'AI_REPLY_FEEDBACK_RECORDED',
    source: 'test',
    payload: {
      evidenceId: 'sent:o-direct',
      eventType: 'sent',
      candidateId: 'candidate-direct',
      outboxId: 'o-direct',
      contactId: 'contact1',
      conversationId: 'conv1',
      personaProfileId: 'owner',
      personaFeedbackProfile: {},
      originalText: '刚看到你的消息。',
      finalText: '刚看到你的消息，忍不住笑了一下。',
      replyStrategy: {},
      source: 'chatgpt_web_edited',
      contextRevision: 3,
      contextMessageIds: ['m1', 'm2'],
      performanceMode: 'rapid'
    }
  });
  assert.equal(result.result.learned, true);
  const learned = manager.select(current => current.memories.byContactId.contact1.feedbackLearning);
  assert.equal(learned.recentExamples.length, 1);
  assert.equal(learned.recentExamples[0].finalText, '刚看到你的消息，忍不住笑了一下。');
  assert.equal(learned.recentExamples[0].source, 'chatgpt_web_edited');
  assert.equal(learned.recentExamples[0].qualityWeight, 0.95);
});

test('immediate learned examples are included in the next prompt as style-only contact context', () => {
  const context = socialContext();
  context.feedbackLearning.recentExamples = [{
    id: 'sent:o-direct',
    finalText: '刚看到你的消息，忍不住笑了一下。',
    source: 'chatgpt_web_edited',
    qualityWeight: 0.95
  }];
  const messages = buildModelMessages({
    ...context,
    incomingMessage: { id: 'm3', text: '今天过得怎么样？', type: 'text' },
    relevantMemories: context.memory,
    relationshipTimeline: [],
    recentSignals: [],
    director: {},
    persona: { truthSafePacket: { preferredLanguage: 'Chinese', style: {} }, learned: {} },
    performanceMode: 'rapid'
  }, { performancePolicy: performancePolicy.MODES.rapid });
  assert.match(messages[0].content, /recentExamples 可从下一次回复起立即参考/);
  assert.match(messages[1].content, /刚看到你的消息，忍不住笑了一下/);
  assert.match(messages[0].content, /不复制其中的私人事实/);
});

test('conversation UI exposes fast modes, send-learning controls, incoming invalidation and local learning management', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-store-client.js'), 'utf8');
  assert.match(index, /id="replySpeedMode"/);
  assert.match(index, /value="rapid">极速/);
  assert.match(index, /id="replyLearningMode"/);
  assert.match(index, /value="send_and_learn"/);
  assert.match(index, /data-tab="learning"/);
  assert.match(index, /data-panel="learning"/);
  assert.match(runtime, /invalidateVisibleReplyForIncoming/);
  assert.match(runtime, /旧 AI 回复已停止/);
  assert.match(runtime, /loadReplyLearning/);
  assert.match(client, /getReplyFeedback/);
  assert.match(client, /resetReplyFeedback/);
  assert.match(client, /restoreReplyFeedback/);
});

test('approval and final send are blocked when an English candidate contains Chinese text', async () => {
  const state = commandState({ conversationRevision: 3 });
  const manager = new StoreManager({ persistence: memoryPersistence(state) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test', payload: {
      contactId: 'contact1', conversationId: 'conv1', conversationRevision: 3,
      performanceMode: 'rapid', source: 'local_model',
      entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 }
    }
  });
  const candidate = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'test', payload: {
      taskId: task.result.taskId,
      text: 'This sounds good. Let us talk tomorrow.',
      conversationRevision: 3,
      targetLanguage: 'English',
      targetLanguageCode: 'en',
      languageAuthority: { code: 'en', source: 'latest_incoming_detected', confidence: 0.95 },
      generationMetadata: { targetLanguage: 'English', targetLanguageCode: 'en', languageAuthority: { code: 'en' } }
    }
  });
  await assert.rejects(manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test', payload: {
      candidateId: candidate.result.candidateId, text: '听起来不错，我们明天再聊。', userApproved: true, approvedBy: 'user'
    }
  }), error => error.code === 'AI_REPLY_LANGUAGE_MISMATCH');

  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test', payload: {
      candidateId: candidate.result.candidateId, text: 'This sounds good. Let us talk tomorrow.', userApproved: true, approvedBy: 'user'
    }
  });
  const outboxId = approved.result.outboxId;
  await assert.rejects(manager.dispatch({
    type: 'OUTBOX_TEXT_REVISED', source: 'test', payload: {
      outboxId,
      text: '听起来不错，我们明天再聊。',
      userConfirmedRevision: true
    }
  }), error => error.code === 'AI_REPLY_LANGUAGE_MISMATCH');

  const corruptedState = commandState({ conversationRevision: 3 });
  corruptedState.outbox.byId['outbox-corrupt-language'] = {
    id: 'outbox-corrupt-language',
    candidateId: 'candidate-corrupt-language',
    contactId: 'contact1',
    conversationId: 'conv1',
    accountId: 'account1',
    platform: 'whatsapp',
    text: '听起来不错，我们明天再聊。',
    state: 'approved',
    userApproved: true,
    metadata: {
      conversationRevision: 3,
      targetLanguage: 'English',
      targetLanguageCode: 'en',
      languageAuthority: { code: 'en', source: 'latest_incoming_detected', confidence: 0.95 }
    }
  };
  const corruptedManager = new StoreManager({ persistence: memoryPersistence(corruptedState) });
  registerAiReplyCommands(corruptedManager);
  await corruptedManager.hydrate();
  await assert.rejects(corruptedManager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED', source: 'test', payload: {
      outboxId: 'outbox-corrupt-language',
      confirmSend: true
    }
  }), error => error.code === 'AI_REPLY_LANGUAGE_MISMATCH');
});
