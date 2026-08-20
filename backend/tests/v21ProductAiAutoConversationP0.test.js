'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('AI_AUTO is a durable per-conversation authorization mode, not a second send stack', () => {
  const runtimeCommands = read('backend/store/commands/registerRuntimeStateCommands.js');
  const aiCommands = read('backend/store/commands/registerAiReplyCommands.js');
  const outbox = read('backend/services/aiReplyOutboxService.js');

  assert.match(runtimeCommands, /CONVERSATION_AI_AUTOMATION_MODE_SET/u);
  assert.match(runtimeCommands, /HUMAN[\s\S]*AI_ASSIST[\s\S]*AI_AUTO/u);
  assert.match(runtimeCommands, /automationModeReceipt/u);
  assert.match(aiCommands, /AI_AUTO/u);
  assert.match(aiCommands, /machineApproved|automationReceipt/u);
  assert.match(outbox, /AI_AUTO/u);
  assert.match(outbox, /manual takeover|MANUAL_TAKEOVER|automationMode/u);
  assert.doesNotMatch(outbox, /automaticSendEnabled:\s*false/u);
  assert.match(outbox, /sendQueueService\.enqueueText/u);
  assert.match(outbox, /typingStateService\.simulateApprovedSend/u);
});

test('AI_AUTO preserves fail-closed stale checks and distinguishes machine authorization from human approval', () => {
  const aiCommands = read('backend/store/commands/registerAiReplyCommands.js');
  const outbox = read('backend/services/aiReplyOutboxService.js');

  assert.match(aiCommands, /authorizationType/u);
  assert.match(aiCommands, /machine|automation/u);
  assert.match(aiCommands, /STALE_CONVERSATION/u);
  assert.match(outbox, /STALE_CONVERSATION_CONTEXT/u);
  assert.match(outbox, /MANUAL_TYPING_STARTED/u);
  assert.match(outbox, /CONVERSATION_CHANGED/u);
});

test('reply generation receives local temporal context and authoritative Persona lifeStatus', () => {
  const compiler = read('backend/personaBrain/compiler.js');
  const brain = read('backend/services/contextAwareReplyBrain.js');

  assert.match(compiler, /lifeStatus/u);
  assert.match(brain, /temporalContext/u);
  assert.match(brain, /localDate/u);
  assert.match(brain, /localTime/u);
  assert.match(brain, /weekday/u);
  assert.match(brain, /daypart/u);
  assert.match(brain, /timeZone/u);
  assert.match(brain, /不得.*时间.*编造|temporal.*not.*fabricat/is);
});

const os = require('node:os');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { registerRuntimeStateCommands } = require('../store/commands/registerRuntimeStateCommands');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');

function aiAutoCommandState() {
  return createInitialState({
    auth: { ready: true, accountsById: { account1: { id: 'account1', state: 'ready', canAttemptSend: true, canSend: true, sendVerified: true } } },
    customers: { ready: true, byId: { contact1: { id: 'contact1', version: 1, accountId: 'account1', platform: 'whatsapp' } } },
    conversations: { ready: true, byId: { conv1: { id: 'conv1', version: 3, contactId: 'contact1', accountId: 'account1', platform: 'whatsapp' } } },
    relationships: { ready: true, byContactId: { contact1: { version: 1 } } },
    memories: { ready: true, byContactId: { contact1: { version: 1, preferences: {} } } },
    interactionPolicies: { ready: true, byContactId: { contact1: { version: 1, allowReplies: true, blocked: false, config: {} } } },
    routing: { ready: true, byTask: {} },
    aiBrain: { ready: true, tasksById: {}, candidatesById: {} },
    outbox: { ready: true, byId: {} }
  });
}

function aiAutoMemoryPersistence(initialState, capturedPolicies = []) {
  return {
    async loadSnapshot() { return initialState; },
    async transaction(run) {
      return run({
        upsertInteractionPolicy(row) { capturedPolicies.push(structuredClone(row)); },
        upsertAiReplyTask() {},
        upsertAiReplyCandidate() {},
        upsertOutboxItem() {},
        insertAiContextSnapshot() {},
        appendStoreEvents() {},
        persistStoreMeta() {}
      });
    }
  };
}

async function createAiAutoManager(initialState = aiAutoCommandState()) {
  const persistedPolicies = [];
  const manager = new StoreManager({ persistence: aiAutoMemoryPersistence(initialState, persistedPolicies) });
  registerRuntimeStateCommands(manager);
  registerAiReplyCommands(manager);
  await manager.hydrate();
  return { manager, persistedPolicies };
}

function entityVersionsFor(manager, contactId = 'contact1') {
  return manager.select(state => ({
    customer: Number(state.customers.byId[contactId]?.version || 0),
    relationship: Number(state.relationships.byContactId[contactId]?.version || 0),
    memory: Number(state.memories.byContactId[contactId]?.version || 0),
    interactionPolicy: Number(state.interactionPolicies.byContactId[contactId]?.version || 0),
    routing: Number(state.meta?.domainVersions?.routing || 0)
  }));
}

async function createCandidate(manager, text = 'Natural reply') {
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'ai-auto-test', payload: {
      contactId: 'contact1', conversationId: 'conv1', conversationRevision: 3,
      performanceMode: 'rapid', source: 'local_model', entityVersions: entityVersionsFor(manager)
    }
  });
  const candidate = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'ai-auto-test', payload: {
      taskId: task.result.taskId, text, conversationRevision: 3,
      expectedConversationRevision: 3, expectedEntityVersions: entityVersionsFor(manager),
      targetLanguage: 'English', targetLanguageCode: 'en', languageAuthority: { code: 'en' }, source: 'local_model'
    }
  });
  return candidate.result.candidateId;
}



test('existing durable orchestrator does not succeed analysis before AI_AUTO candidate persistence returns', () => {
  const orchestrator = read('backend/services/aiBrainOrchestrator.js');
  const analyzeIndex = orchestrator.indexOf('await workspaceData.analyzeConversation');
  const candidateIndex = orchestrator.indexOf('await maybeGenerateAutomaticReplyCandidate', analyzeIndex);
  const processedReturnIndex = orchestrator.indexOf('processed: true', candidateIndex);
  const scheduledAwaitIndex = orchestrator.indexOf('await processConversation(conversationId', candidateIndex);
  const durableSuccessIndex = orchestrator.indexOf('succeedCanonicalAnalysis(lease', scheduledAwaitIndex);
  assert.ok(analyzeIndex >= 0 && candidateIndex > analyzeIndex);
  assert.ok(processedReturnIndex > candidateIndex);
  assert.ok(scheduledAwaitIndex > candidateIndex && durableSuccessIndex > scheduledAwaitIndex);
  assert.doesNotMatch(orchestrator, /eventBus\.on\('ai:conversation-processed'[\s\S]{0,500}generateCandidate/u);
});
test('AI_AUTO mode receipt is durably persisted in the existing interaction-policy config', async () => {
  const { manager, persistedPolicies } = await createAiAutoManager();
  const result = await manager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET', source: 'product-ui', payload: { conversationId: 'conv1', mode: 'AI_AUTO', actor: 'user' }
  });
  assert.equal(result.result.mode, 'AI_AUTO');
  assert.ok(result.result.automationModeReceipt.id);
  assert.equal(persistedPolicies.length, 1);
  assert.equal(persistedPolicies[0].config.conversationAutomationModes.conv1.mode, 'AI_AUTO');
  assert.equal(persistedPolicies[0].config.conversationAutomationModes.conv1.id, result.result.automationModeReceipt.id);
});

test('AI_AUTO machine authorization becomes fail-closed immediately after HUMAN manual takeover', async () => {
  const { manager } = await createAiAutoManager();
  const mode = await manager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET', source: 'product-ui', payload: { conversationId: 'conv1', mode: 'AI_AUTO', actor: 'user' }
  });
  const candidateId = await createCandidate(manager);
  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'ai-auto', payload: {
      candidateId, authorizationType: 'machine', machineApproved: true,
      automationReceipt: mode.result.automationModeReceipt, approvedBy: 'ai_auto'
    }
  });
  assert.equal(approved.result.authorizationType, 'machine');
  await manager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET', source: 'manual-takeover', payload: { conversationId: 'conv1', mode: 'HUMAN', actor: 'user' }
  });
  await assert.rejects(
    manager.dispatch({
      type: 'OUTBOX_SEND_CONFIRMED', source: 'ai-auto', payload: {
        outboxId: approved.result.outboxId, authorizationType: 'machine', machineApproved: true,
        automationReceipt: mode.result.automationModeReceipt
      }
    }),
    error => error?.code === 'MANUAL_TAKEOVER'
  );
});

test('AI_AUTO remains subordinate to existing blocked or no-reply interaction policy', async () => {
  const seed = aiAutoCommandState();
  const receipt = {
    id: 'blocked-ai-auto-receipt', conversationId: 'conv1', contactId: 'contact1', mode: 'AI_AUTO',
    policyVersion: 2, previousMode: 'HUMAN', actor: 'user', setAt: '2026-08-19T11:00:00.000Z'
  };
  seed.interactionPolicies.byContactId.contact1 = {
    ...seed.interactionPolicies.byContactId.contact1,
    version: 2,
    blocked: true,
    allowReplies: false,
    config: { conversationAutomationModes: { conv1: receipt } }
  };
  const { manager } = await createAiAutoManager(seed);
  const candidateId = await createCandidate(manager, 'Must not auto-send');
  await assert.rejects(
    manager.dispatch({
      type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'ai-auto', payload: {
        candidateId, authorizationType: 'machine', machineApproved: true, automationReceipt: receipt
      }
    }),
    error => error?.code === 'AI_AUTO_INTERACTION_POLICY_BLOCKED'
  );
});

test('HUMAN mode preserves explicit candidate approval and explicit final send confirmation', async () => {
  const { manager } = await createAiAutoManager();
  const candidateId = await createCandidate(manager, 'Human approved reply');
  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'user', payload: {
      candidateId, text: 'Human approved reply', userApproved: true, approvedBy: 'user'
    }
  });
  assert.equal(approved.result.authorizationType, 'human');
  const confirmed = await manager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED', source: 'user', payload: { outboxId: approved.result.outboxId, confirmSend: true }
  });
  assert.equal(manager.select(state => state.outbox.byId[confirmed.result.outboxId].state), 'send_confirmed');
});

test('SQLite rehydrate restores AI_AUTO receipt and machine outbox authorization from existing JSON seams', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ai-auto-restart-'));
  const store = new R32SqliteStore({ dbPath: path.join(rootDir, 'yance.db') });
  const adapter = new SqliteStorePersistenceAdapter({ store });
  try {
    store.upsertAccount({ id: 'account1', platform: 'whatsapp', adapterAccountId: 'account1', displayName: 'A', canSend: true, canReceive: true });
    store.upsertContact({ id: 'contact1', platform: 'whatsapp', accountId: 'account1', externalId: '49123@s.whatsapp.net', displayName: 'C', canonicalContactId: 'contact1' });
    store.upsertConversation({ sessionKey: 'conv1', platform: 'whatsapp', accountId: 'account1', contactId: 'contact1', title: 'C', routeState: 'ready', version: 3 });
    const receipt = { id: 'receipt-restart-1', conversationId: 'conv1', contactId: 'contact1', mode: 'AI_AUTO', policyVersion: 2, setAt: '2026-08-19T11:00:00.000Z' };
    await adapter.transaction(transaction => {
      transaction.upsertInteractionPolicy({
        contactId: 'contact1', policy: 'reply_normally', allowReplies: true, allowProactive: false, blocked: false,
        blockReason: '', proactiveMessageBudget7d: 0, usedThisWeek: 0, unansweredLimit: 1, minimumIntervalHours: 18,
        nextAllowedProactiveAt: '', replyStrategy: {}, config: { conversationAutomationModes: { conv1: receipt } }, version: 2
      });
      transaction.upsertAiReplyCandidate({
        candidateId: 'candidate-restart-1', taskId: 'task-restart-1', contactId: 'contact1', conversationId: 'conv1',
        text: 'candidate', originalText: 'candidate', contextVersion: 1, entityVersions: {}, relationshipPotential: {}, state: 'generated',
        replyStrategy: { _generation: { automationMode: 'AI_AUTO', automationModeReceipt: receipt } }
      });
      transaction.upsertOutboxItem({
        id: 'outbox-restart-1', taskId: 'task-restart-1', candidateId: 'candidate-restart-1', contactId: 'contact1', conversationId: 'conv1',
        accountId: 'account1', platform: 'whatsapp', text: 'candidate', originalText: 'candidate', state: 'approved', userApproved: false,
        approvedAt: '2026-08-19T11:00:01.000Z', approvedBy: 'ai_auto', contextVersion: 1,
        metadata: { authorizationType: 'machine', machineApproved: true, automationMode: 'AI_AUTO', automationReceipt: receipt }
      });
    });
    const snapshot = await adapter.loadSnapshot();
    assert.equal(snapshot.interactionPolicies.byContactId.contact1.config.conversationAutomationModes.conv1.id, receipt.id);
    assert.equal(snapshot.aiBrain.candidatesById['candidate-restart-1'].automationMode, 'AI_AUTO');
    assert.equal(snapshot.aiBrain.candidatesById['candidate-restart-1'].automationModeReceipt.id, receipt.id);
    assert.equal(snapshot.outbox.byId['outbox-restart-1'].authorizationType, 'machine');
    assert.equal(snapshot.outbox.byId['outbox-restart-1'].machineApproved, true);
    assert.equal(snapshot.outbox.byId['outbox-restart-1'].automationReceipt.id, receipt.id);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('machine approval rejects a candidate that was generated without an AI_AUTO receipt', async () => {
  const { manager } = await createAiAutoManager();
  const candidateId = await createCandidate(manager, 'Generated before automation');
  const mode = await manager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET', source: 'product-ui', payload: {
      conversationId: 'conv1', mode: 'AI_AUTO', actor: 'user'
    }
  });

  await assert.rejects(
    manager.dispatch({
      type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'ai-auto', payload: {
        candidateId,
        authorizationType: 'machine',
        machineApproved: true,
        automationReceipt: mode.result.automationModeReceipt
      }
    }),
    error => error?.code === 'AI_AUTO_AUTOMATION_RECEIPT_STALE'
  );
});

test('pre-send AI_AUTO interaction-policy block retains the outbox for later revalidation', async () => {
  const { configureStoreManager, resetStoreManagerForTests } = require('../store/storeManagerSingleton');
  const aiReplyOutboxService = require('../services/aiReplyOutboxService');
  const receipt = {
    id: 'policy-retain-receipt', conversationId: 'conv1', contactId: 'contact1', mode: 'AI_AUTO',
    policyVersion: 2, previousMode: 'HUMAN', actor: 'user', setAt: '2026-08-19T12:00:00.000Z'
  };
  const seed = aiAutoCommandState();
  seed.interactionPolicies.byContactId.contact1 = {
    ...seed.interactionPolicies.byContactId.contact1,
    version: 2,
    blocked: true,
    allowReplies: false,
    config: { conversationAutomationModes: { conv1: receipt } }
  };
  seed.outbox.byId.out1 = {
    id: 'out1', taskId: '', candidateId: '', contactId: 'contact1', conversationId: 'conv1',
    accountId: 'account1', platform: 'whatsapp', text: 'Retain me', originalText: 'Retain me',
    state: 'send_confirmed', authorizationType: 'machine', machineApproved: true,
    automationMode: 'AI_AUTO', automationReceipt: receipt, userApproved: false,
    metadata: { conversationRevision: 3, authorizationType: 'machine', machineApproved: true, automationReceipt: receipt }
  };

  resetStoreManagerForTests();
  const manager = configureStoreManager({ persistence: aiAutoMemoryPersistence(seed), replace: true });
  registerRuntimeStateCommands(manager);
  registerAiReplyCommands(manager);
  await manager.hydrate();
  try {
    await aiReplyOutboxService.handleSendConfirmed({ payload: { entityId: 'out1', payload: { outboxId: 'out1' } } });
    const outbox = manager.select(state => state.outbox.byId.out1);
    assert.equal(outbox.state, 'approved');
    assert.equal(outbox.metadata.lastTypingCancellation.reason, 'AI_AUTO_INTERACTION_POLICY_BLOCKED');
  } finally {
    resetStoreManagerForTests();
  }
});
