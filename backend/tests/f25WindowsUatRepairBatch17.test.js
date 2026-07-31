'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const workspaceRepository = require('../repositories/workspaceRepository');
const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
const socialBootstrap = require('../services/socialConversationBootstrapAuthority');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { LearningPreferenceAuthority } = require('../services/learningPreferenceAuthority');
const { CandidateInteractionLearningService } = require('../services/candidateInteractionLearningService');
const feedbackLearning = require('../services/replyFeedbackLearningService');
const aiQuality = require('../services/aiQualityRouteAuthority');
const contactContextAuthority = require('../services/contactContextAuthority');
const conversationTurnCoordinator = require('../services/conversationTurnCoordinator');
const typingStateService = require('../services/typingStateService');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const { createContextAwareReplyBrain } = require('../services/contextAwareReplyBrain');

function qualityModel(id = 'openrouter-quality-model') {
  return {
    id, name: id, provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director', 'learning_synthesis', 'understanding', 'relationship'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', pass: true, status: 'REPLY_BRAIN_QUALIFIED', completed: true, score: 94,
      scenarios: [
        { id: 'german_whatsapp', pass: true, score: 19 }, { id: 'english_whatsapp', pass: true, score: 19 },
        { id: 'persona_boundary', pass: true, score: 25 }, { id: 'director_schema', pass: true, score: 20 },
        { id: 'latency', pass: true, score: 11 }
      ]
    }
  };
}
function routeReceipt(task = 'quick_reply') {
  return aiQuality.routeReceipt({ task, selectedModel: qualityModel(`${task}-model`), routePlan: { state: 'ready', violations: [] } });
}

function seedGreetingConversation(store) {
  const at = '2026-07-28T00:00:00.000Z';
  store.db.prepare(`INSERT INTO contacts(id,platform,account_id,external_id,display_name,canonical_contact_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('contact-michael', 'facebook', 'page-1', 'psid-1', 'Michael', 'contact-michael', at, at);
  store.db.prepare(`INSERT INTO r32_conversations(session_key,account_id,contact_id,platform,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)`)
    .run('facebook:page-1:michael', 'page-1', 'contact-michael', 'facebook', 'Michael', at, at);
  store.db.prepare(`INSERT INTO r32_messages(id,session_key,account_id,sender_id,role,direction,message_type,text,payload_json,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('hello-1', 'facebook:page-1:michael', 'page-1', 'psid-1', 'contact', 'inbound', 'text', 'Hallo 🌹', JSON.stringify({ externalMessageId: 'hello-1', translatedZh: '你好 🌹' }), at, at, at);
}

test('Batch 17 recognizes multilingual one-line social openers without inventing profile facts', () => {
  const samples = [
    ['hello-de', 'Hallo 🌹', 'greeting'],
    ['hello-zh', '你好', 'greeting'],
    ['hello-en', 'Hi', 'greeting'],
    ['emoji-only', '🌹', 'emoji_opener'],
    ['check-in', 'Wie geht es dir?', 'light_check_in']
  ];
  for (const [id, text, act] of samples) {
    const result = socialBootstrap.bootstrapFromMessages([{ id, role: 'contact', direction: 'inbound', sourceText: text }]);
    assert.equal(result.completeness.complete, true, text);
    assert.equal(result.analysis.conversationAct, act, text);
    assert.equal(result.analysis.evidence[0].messageId, id, text);
    assert.equal(result.analysis.evidence[0].quote, text, text);
    assert.match(result.analysis.hiddenNeed, /没有足够证据/u, text);
    assert.deepEqual(result.profile, {}, text);
    assert.equal(result.analysis.deterministicBootstrap, true, text);
  }
});

test('Batch 17 full analysis converts an invalid empty model envelope into a committed greeting analysis', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b17-greeting-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'yance.db') });
  const originalTranslate = socialChineseUnderstandingService.translateBundle;
  socialChineseUnderstandingService.translateBundle = async payload => ({
    translated: { analysis: payload.analysis, profile: payload.profile, insights: payload.insights },
    translationStatus: 'success', translationModel: 'test-translator', translatedAt: '2026-07-28T00:00:01.000Z'
  });
  try {
    seedGreetingConversation(store);
    const result = await workspaceRepository.analyzeConversation('facebook:page-1:michael', {
      store,
      executor: async () => ({ modelId: 'understanding-model', model: 'Understanding Model', structured: { analysis: {}, profile: {}, insights: {} } })
    });
    assert.equal(result.ok, true);
    assert.equal(result.analysisReceipt.transactionCommitted, true);
    assert.equal(result.analysisReceipt.completeness.complete, true);
    assert.equal(result.analysis.sourceLastMessageId, 'hello-1');
    assert.equal(result.analysis.evidence[0].messageId, 'hello-1');
    assert.equal(result.profile.facts && Object.keys(result.profile.facts).length, 0);
    const context = workspaceRepository.getContextByConversation('facebook:page-1:michael', store);
    assert.equal(context.latestRun.status, 'completed');
    assert.equal(context.latestRun.current, true);
    assert.equal(context.analysis.conversationAct, 'greeting');
  } finally {
    socialChineseUnderstandingService.translateBundle = originalTranslate;
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Batch 17 candidate edits are provisional and become active only through a successful-send signal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b17-learning-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const authority = new LearningPreferenceAuthority({ repository });
  const route = routeReceipt('quick_reply');
  const truth = { pass: true, receiptSha256: 'truth-b17' };
  const state = { aiBrain: { candidatesById: { cand1: {
    candidateId: 'cand1', contactId: 'contact1', conversationId: 'conv1', text: 'Hallo, schön von dir zu hören.', originalText: 'Hallo.', state: 'generated',
    generationMetadata: { qualityRouteReceipt: route, personaTruthReceipt: truth, learningEligible: true, candidateStrategyBranchId: 'natural_hook' }
  } } } };
  try {
    const service = new CandidateInteractionLearningService({ storeManager: { select: fn => fn(state) }, authority });
    const pending = service.record({ candidateId: 'cand1', signalType: 'candidate_micro_adjusted', interactionId: 'edit-1', adjustments: ['更短', '不提问'], finalText: 'Hallo, schön von dir zu hören.' });
    assert.equal(pending.profileChanged, false);
    assert.equal(pending.excludedReason, 'PENDING_SUCCESSFUL_SEND');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_preference_profiles').get().count, 0);
    const sentPayload = feedbackLearning.attachProvisionalCandidateInteractions({ store }, {
      eventType: 'sent', evidenceId: 'sent:outbox1', candidateId: 'cand1', outboxId: 'outbox1', contactId: 'contact1', conversationId: 'conv1',
      originalText: 'Hallo.', finalText: 'Hallo, schön von dir zu hören.', learningMode: 'send_and_learn', observedAt: '2026-07-28T00:00:02.000Z',
      generationMetadata: { qualityRouteReceipt: route, personaTruthReceipt: truth, learningEligible: true, candidateStrategyBranchId: 'natural_hook' }
    });
    assert.deepEqual(sentPayload.generationMetadata.adjustments.sort(), ['no_question', 'shorter']);
    assert.equal(sentPayload.generationMetadata.activatedOnlyAfterSuccessfulSend, true);
    const activated = authority.recordSignal(feedbackLearning.l1SignalFromFeedback(sentPayload));
    assert.equal(activated.profileChanged, true);
    assert.equal(activated.profile.preference.axisWeights.short > 0, true);
    assert.equal(activated.profile.preference.axisWeights.noQuestion > 0, true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_signal_ledger WHERE learning_eligible=1').get().count, 1);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Batch 17 reply brain generates a real German candidate for a one-line Hallo opener', async t => {
  const socialContext = {
    found: true, ready: true, contactId: 'contact1', contextVersion: 1,
    entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 1 },
    customer: { id: 'contact1', platform: 'facebook', accountId: 'page1', name: 'Michael' },
    relationshipPotential: { relationshipStage: 'new', warmth: 0.3, openness: 0.3 },
    relationshipAnalysis: { stage: 'new', evidenceMessageIds: ['hello-1'] }, emotion: { current: 'neutral', trend: 'stable' },
    interaction: { cadence: 'unknown' }, preferences: { replyLength: 'short' }, feedbackLearning: { effective: {} },
    interactionPolicy: { policy: { allowReplies: true } },
    replyStrategy: { recommendedTone: 'natural', recommendedLength: 'short', recommendedDepth: 'light', maxQuestions: 1 },
    memory: { confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [], promises: [], boundaries: [], sensitiveTopics: [], recurringInterests: [] },
    timeline: [], recentSignals: [], recentMessages: [{ id: 'hello-1', direction: 'inbound', type: 'text', text: 'Hallo 🌹', sentAt: '2026-07-28T00:00:00Z' }]
  };
  t.mock.method(contactContextAuthority, 'getSocialContext', () => socialContext);
  t.mock.method(conversationTurnCoordinator, 'waitForQuiet', async () => ({ waitedMs: 0 }));
  t.mock.method(conversationTurnCoordinator, 'capture', (_id, revision) => ({ conversationId: 'conv1', runtimeRevision: 0, persistedRevision: revision }));
  t.mock.method(conversationTurnCoordinator, 'isCurrent', () => true);
  t.mock.method(conversationTurnCoordinator, 'settle', () => {});
  t.mock.method(typingStateService, 'beginAiGeneration', async () => ({}));
  t.mock.method(typingStateService, 'endAiGeneration', async () => ({}));
  t.mock.method(aiTaskRuntimeRegistry, 'replace', async () => ({ signal: new AbortController().signal, generation: 1 }));
  t.mock.method(aiTaskRuntimeRegistry, 'finish', () => {});
  const state = { conversations: { byId: { conv1: { id: 'conv1', version: 1 } } } };
  const dispatches = [];
  const storeManager = {
    select: selector => selector(state),
    async dispatch(command) {
      dispatches.push(command);
      if (command.type === 'AI_REPLY_TASK_STARTED') return { result: { taskId: 'task-hallo' } };
      if (command.type === 'AI_REPLY_CANDIDATE_READY') return { result: { candidateId: 'candidate-hallo' } };
      return { result: {} };
    }
  };
  const personaBrain = { compileEffectiveContext() { return {
    profileId: 'owner', personaVersionId: 1, policyHash: 'persona-b17', effectiveLabel: 'Yeonhee', appliedScopes: [],
    context: { persona: { truthSafePacket: { preferredLanguage: 'German', publicFacts: [], style: {}, runtimeAuthority: { authority: 'YancePersonaRuntimeTruthAuthority', pass: true, receiptSha256: 'truth-hallo' } }, learned: {} } }
  }; } };
  const calls = [];
  const gateway = { async execute(input) {
    calls.push(input);
    if (input.task === 'director') return { text: JSON.stringify({
      strategy: '自然回应', reasonZh: '对方用问候开启互动，适合简短回应并留一个轻松钩子', goal: '建立第一轮互动', tone: '自然温暖', pace: '轻快',
      instruction: '用德语自然回应问候，并加入一个低压力、容易回答的话题钩子', avoid: '不要虚构客户资料，不要连续提问', targetLanguage: 'de', maxQuestions: 1
    }), modelId: 'cloud-director', model: 'Cloud Director', attempts: [{ status: 'success' }] };
    return { text: 'Hallo, schön von dir zu hören. Wie war dein Tag?', modelId: 'cloud-reply', model: 'Cloud Reply', attempts: [{ status: 'success' }] };
  } };
  const brain = createContextAwareReplyBrain({ storeManager, aiGateway: gateway, personaBrain, waitForLearningIdle: async () => {} });
  const result = await brain.generateCandidate({ contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'hello-1', text: 'Hallo 🌹' }, skipQuietWindow: true, source: 'ai_routed_model' });
  assert.deepEqual(calls.slice(0, 2).map(row => row.task), ['director', 'quick_reply']);
  assert.equal(calls.filter(row => row.task === 'translation').length, 2);
  assert.equal(result.text, 'Hallo, schön von dir zu hören. Wie war dein Tag?');
  assert.equal(result.targetLanguageCode || result.languageAuthority?.code, 'de');
  assert.equal(result.modelId, 'cloud-reply');
  const ready = dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY');
  assert.equal(ready.payload.source, 'ai_routed_model');
  assert.equal(ready.payload.text, result.text);
});

test('Batch 17 frontend automatically runs understanding then 3-5 candidates and records routed-model provenance', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const quick = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-conversation-center-v3.js'), 'utf8');
  assert.match(runtime, /scheduleAutomaticReplyPipeline/u);
  assert.match(runtime, /await runAnalysis\(\{automatic:true/u);
  assert.match(runtime, /await generateAiCandidates\(null,null,\{automatic:true/u);
  assert.match(runtime, /sourceId===latestId/u);
  assert.match(runtime, /ai_routed_model/u);
  assert.doesNotMatch(runtime, /source:extra\?\.mergeCandidates\?\.length\?'ai_merge':'local_model'/u);
  assert.match(quick, /replySource='ai_routed_model'/u);
});
