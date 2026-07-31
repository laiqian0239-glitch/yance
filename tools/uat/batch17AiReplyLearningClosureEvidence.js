'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const workspaceRepository = require('../../backend/repositories/workspaceRepository');
const socialChineseUnderstandingService = require('../../backend/services/socialChineseUnderstandingService');
const socialBootstrap = require('../../backend/services/socialConversationBootstrapAuthority');
const { createPlatformCoreRepository } = require('../../backend/repositories/platformCoreRepository');
const { LearningPreferenceAuthority } = require('../../backend/services/learningPreferenceAuthority');
const { CandidateInteractionLearningService } = require('../../backend/services/candidateInteractionLearningService');
const feedbackLearning = require('../../backend/services/replyFeedbackLearningService');
const aiQuality = require('../../backend/services/aiQualityRouteAuthority');
const contactContextAuthority = require('../../backend/services/contactContextAuthority');
const conversationTurnCoordinator = require('../../backend/services/conversationTurnCoordinator');
const typingStateService = require('../../backend/services/typingStateService');
const aiTaskRuntimeRegistry = require('../../backend/services/aiTaskRuntimeRegistry');
const { createContextAwareReplyBrain, buildModelMessages } = require('../../backend/services/contextAwareReplyBrain');
const performancePolicy = require('../../backend/services/replyPerformancePolicy');

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
  store.db.prepare('INSERT INTO contacts(id,platform,account_id,external_id,display_name,canonical_contact_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('contact-michael', 'facebook', 'page-1', 'psid-1', 'Michael', 'contact-michael', at, at);
  store.db.prepare("INSERT INTO r32_conversations(session_key,account_id,contact_id,platform,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)")
    .run('facebook:page-1:michael', 'page-1', 'contact-michael', 'facebook', 'Michael', at, at);
  store.db.prepare('INSERT INTO r32_messages(id,session_key,account_id,sender_id,role,direction,message_type,text,payload_json,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('hello-1', 'facebook:page-1:michael', 'page-1', 'psid-1', 'contact', 'inbound', 'text', 'Hallo 🌹', JSON.stringify({ externalMessageId: 'hello-1', translatedZh: '你好 🌹' }), at, at, at);
}

function socialContext() {
  return {
    found: true, ready: true, contactId: 'contact1', contextVersion: 1,
    entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 1 },
    customer: { id: 'contact1', platform: 'facebook', accountId: 'page1', name: 'Michael' },
    relationshipPotential: { relationshipStage: 'new', warmth: 0.3, openness: 0.3 },
    relationshipAnalysis: { stage: 'new', evidenceMessageIds: ['hello-1'] }, emotion: { current: 'neutral', trend: 'stable' },
    interaction: { cadence: 'unknown' }, preferences: { replyLength: 'short' }, feedbackLearning: { effective: {}, recentExamples: [] },
    interactionPolicy: { policy: { allowReplies: true } },
    replyStrategy: { recommendedTone: 'natural', recommendedLength: 'short', recommendedDepth: 'light', maxQuestions: 1 },
    memory: { confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [], promises: [], boundaries: [], sensitiveTopics: [], recurringInterests: [] },
    timeline: [], recentSignals: [],
    recentMessages: [{ id: 'hello-1', direction: 'inbound', type: 'text', text: 'Hallo 🌹', sentAt: '2026-07-28T00:00:00Z' }]
  };
}

async function main() {
  const output = path.resolve(process.argv[2] || path.join(process.cwd(), 'YANCE_BATCH17_AI_REPLY_LEARNING_CLOSURE_EVIDENCE.json'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b17-evidence-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'yance.db') });
  const originals = {
    translateBundle: socialChineseUnderstandingService.translateBundle,
    getSocialContext: contactContextAuthority.getSocialContext,
    waitForQuiet: conversationTurnCoordinator.waitForQuiet,
    capture: conversationTurnCoordinator.capture,
    isCurrent: conversationTurnCoordinator.isCurrent,
    settle: conversationTurnCoordinator.settle,
    beginAiGeneration: typingStateService.beginAiGeneration,
    endAiGeneration: typingStateService.endAiGeneration,
    taskStart: aiTaskRuntimeRegistry.start,
    taskFinish: aiTaskRuntimeRegistry.finish
  };
  const report = {
    schemaVersion: 1,
    documentType: 'YANCE_BATCH17_AI_REPLY_LEARNING_CLOSURE_EVIDENCE',
    generatedAtUtc: new Date().toISOString(),
    status: 'RUNNING',
    environment: { platform: process.platform, node: process.version, realWindowsElectron: false, realOpenRouter: false },
    checks: []
  };
  try {
    const samples = [
      ['Hallo 🌹', 'greeting'], ['你好', 'greeting'], ['Hi', 'greeting'], ['🌹', 'emoji_opener'], ['Wie geht es dir?', 'light_check_in']
    ];
    report.greetingRecognition = samples.map(([text, expectedAct], index) => {
      const result = socialBootstrap.bootstrapFromMessages([{ id: `msg-${index + 1}`, role: 'contact', direction: 'inbound', sourceText: text }]);
      assert.equal(result?.completeness?.complete, true);
      assert.equal(result.analysis.conversationAct, expectedAct);
      assert.deepEqual(result.profile, {});
      return { text, expectedAct, actualAct: result.analysis.conversationAct, complete: true, inventedProfileFacts: 0, evidenceMessageId: result.analysis.evidence[0].messageId };
    });
    report.checks.push({ id: 'GREETING_BOOTSTRAP', status: 'PASS', cases: report.greetingRecognition.length });

    seedGreetingConversation(store);
    socialChineseUnderstandingService.translateBundle = async payload => ({
      translated: { analysis: payload.analysis, profile: payload.profile, insights: payload.insights },
      translationStatus: 'success', translationModel: 'evidence-translator', translatedAt: '2026-07-28T00:00:01.000Z'
    });
    const analysisResult = await workspaceRepository.analyzeConversation('facebook:page-1:michael', {
      store,
      executor: async () => ({ modelId: 'understanding-model', model: 'Understanding Model', structured: { analysis: {}, profile: {}, insights: {} } })
    });
    assert.equal(analysisResult.analysisReceipt.transactionCommitted, true);
    assert.equal(analysisResult.analysisReceipt.completeness.complete, true);
    assert.equal(analysisResult.analysis.sourceLastMessageId, 'hello-1');
    report.analysis = {
      transactionCommitted: true,
      complete: true,
      conversationAct: analysisResult.analysis.conversationAct,
      sourceLastMessageId: analysisResult.analysis.sourceLastMessageId,
      evidenceMessageIds: analysisResult.analysis.evidence.map(row => row.messageId),
      profileFactCount: Object.keys(analysisResult.profile?.facts || {}).length,
      deterministicRepairUsed: analysisResult.analysis.deterministicBootstrap === true
    };
    report.checks.push({ id: 'UNDERSTANDING_TRANSACTION', status: 'PASS' });

    const context = socialContext();
    contactContextAuthority.getSocialContext = () => context;
    conversationTurnCoordinator.waitForQuiet = async () => ({ waitedMs: 0 });
    conversationTurnCoordinator.capture = (_id, revision) => ({ conversationId: 'conv1', runtimeRevision: 0, persistedRevision: revision });
    conversationTurnCoordinator.isCurrent = () => true;
    conversationTurnCoordinator.settle = () => {};
    typingStateService.beginAiGeneration = async () => ({});
    typingStateService.endAiGeneration = async () => ({});
    aiTaskRuntimeRegistry.start = () => ({ signal: new AbortController().signal });
    aiTaskRuntimeRegistry.finish = () => {};
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
      calls.push({ task: input.task, modelRoute: 'simulated-cloud-quality-route' });
      if (input.task === 'director') return { text: JSON.stringify({
        strategy: '自然回应', reasonZh: '对方用问候开启互动，适合简短回应并留一个轻松钩子', goal: '建立第一轮互动', tone: '自然温暖', pace: '轻快',
        instruction: '用德语自然回应问候，并加入一个低压力、容易回答的话题钩子', avoid: '不要虚构客户资料，不要连续提问', targetLanguage: 'de', maxQuestions: 1
      }), modelId: 'cloud-director', model: 'Cloud Director', attempts: [{ status: 'success' }] };
      return { text: 'Hallo, schön von dir zu hören. Wie war dein Tag?', modelId: 'cloud-reply', model: 'Cloud Reply', attempts: [{ status: 'success' }] };
    } };
    const brain = createContextAwareReplyBrain({ storeManager, aiGateway: gateway, personaBrain, waitForLearningIdle: async () => {} });
    const candidate = await brain.generateCandidate({ contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'hello-1', text: 'Hallo 🌹' }, skipQuietWindow: true, source: 'ai_routed_model' });
    assert.equal(candidate.modelId, 'cloud-reply');
    assert.equal(dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY')?.payload?.source, 'ai_routed_model');
    report.replyGeneration = {
      tasks: calls.map(row => row.task),
      directorBeforeReply: calls[0]?.task === 'director' && calls[1]?.task === 'quick_reply',
      candidateText: candidate.text,
      targetLanguageCode: candidate.targetLanguageCode || candidate.languageAuthority?.code,
      modelId: candidate.modelId,
      source: dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY')?.payload?.source,
      defaultCandidateCount: performancePolicy.MODES.balanced.candidateCount,
      supportedCandidateRange: [3, 5]
    };
    assert.equal(report.replyGeneration.directorBeforeReply, true);
    assert.ok(report.replyGeneration.defaultCandidateCount >= 3 && report.replyGeneration.defaultCandidateCount <= 5);
    report.checks.push({ id: 'DIRECTOR_TO_CANDIDATE', status: 'PASS' });

    const repository = createPlatformCoreRepository({ storeProvider: () => store });
    const authority = new LearningPreferenceAuthority({ repository });
    const route = routeReceipt('quick_reply');
    const truth = { pass: true, receiptSha256: 'truth-b17' };
    const candidateState = { aiBrain: { candidatesById: { cand1: {
      candidateId: 'cand1', contactId: 'contact1', conversationId: 'conv1', text: candidate.text, originalText: 'Hallo 🌹', state: 'generated',
      generationMetadata: { qualityRouteReceipt: route, personaTruthReceipt: truth, learningEligible: true, candidateStrategyBranchId: 'natural_hook' }
    } } } };
    const interactionService = new CandidateInteractionLearningService({ storeManager: { select: selector => selector(candidateState) }, authority });
    const provisional = interactionService.record({ candidateId: 'cand1', signalType: 'candidate_micro_adjusted', interactionId: 'edit-1', adjustments: ['更短', '不提问'], finalText: 'Hallo, schön von dir zu hören.' });
    const beforeProfileCount = Number(store.db.prepare('SELECT COUNT(*) AS count FROM learning_preference_profiles').get().count || 0);
    assert.equal(provisional.profileChanged, false);
    assert.equal(provisional.excludedReason, 'PENDING_SUCCESSFUL_SEND');
    assert.equal(beforeProfileCount, 0);

    const sentPayload = feedbackLearning.attachProvisionalCandidateInteractions({ store }, {
      eventType: 'sent', evidenceId: 'sent:outbox1', candidateId: 'cand1', outboxId: 'outbox1', contactId: 'contact1', conversationId: 'conv1',
      originalText: 'Hallo 🌹', finalText: 'Hallo, schön von dir zu hören.', learningMode: 'send_and_learn', observedAt: '2026-07-28T00:00:02.000Z',
      generationMetadata: { qualityRouteReceipt: route, personaTruthReceipt: truth, learningEligible: true, candidateStrategyBranchId: 'natural_hook' }
    });
    const activated = authority.recordSignal(feedbackLearning.l1SignalFromFeedback(sentPayload));
    assert.equal(activated.profileChanged, true);
    const profile = repository.getLatestLearningProfile({ scopeType: 'conversation', scopeId: 'conv1', learningLevel: 'L1', state: 'active' });
    assert.ok(profile?.preference?.axisWeights?.short > 0);
    assert.ok(profile?.preference?.axisWeights?.noQuestion > 0);

    const learnedContext = socialContext();
    learnedContext.feedbackLearning.recentExamples = [{ id: 'sent:outbox1', finalText: sentPayload.finalText, source: 'ai_routed_model', qualityWeight: 0.95 }];
    const nextMessages = buildModelMessages({
      ...learnedContext,
      incomingMessage: { id: 'hello-2', text: 'Wie geht es dir?', type: 'text' },
      relevantMemories: learnedContext.memory,
      relationshipTimeline: [], recentSignals: [], director: {},
      persona: { truthSafePacket: { preferredLanguage: 'German', style: {} }, learned: {} }, performanceMode: 'rapid'
    }, { performancePolicy: performancePolicy.MODES.rapid });
    const promptIncludesLearnedExample = nextMessages.some(row => String(row.content || '').includes(sentPayload.finalText));
    assert.equal(promptIncludesLearnedExample, true);
    report.learningClosure = {
      candidateInteractionBeforeSend: { ledgerRecorded: true, activeProfileChanged: false, exclusionReason: provisional.excludedReason },
      successfulSend: {
        provisionalInteractionCount: sentPayload.generationMetadata.provisionalInteractionCount,
        activatedOnlyAfterSuccessfulSend: sentPayload.generationMetadata.activatedOnlyAfterSuccessfulSend,
        activeProfileChanged: activated.profileChanged,
        adjustments: sentPayload.generationMetadata.adjustments
      },
      failedOrUnsentCandidateActivatesLearning: false,
      nextPromptIncludesSuccessfulSentExample: promptIncludesLearnedExample,
      activeAxisWeights: profile.preference.axisWeights
    };
    report.checks.push({ id: 'SUCCESSFUL_SEND_LEARNING_CLOSURE', status: 'PASS' });

    report.status = 'PASS';
    report.summary = {
      passed: report.checks.length,
      failed: 0,
      chain: 'inbound -> understanding -> director -> cloud reply -> candidate -> provisional interaction -> successful send -> L1 profile -> next prompt'
    };
  } catch (error) {
    report.status = 'FAIL';
    report.failure = { code: error.code || error.name || 'ERROR', message: error.message, stack: error.stack };
    throw error;
  } finally {
    socialChineseUnderstandingService.translateBundle = originals.translateBundle;
    contactContextAuthority.getSocialContext = originals.getSocialContext;
    conversationTurnCoordinator.waitForQuiet = originals.waitForQuiet;
    conversationTurnCoordinator.capture = originals.capture;
    conversationTurnCoordinator.isCurrent = originals.isCurrent;
    conversationTurnCoordinator.settle = originals.settle;
    typingStateService.beginAiGeneration = originals.beginAiGeneration;
    typingStateService.endAiGeneration = originals.endAiGeneration;
    aiTaskRuntimeRegistry.start = originals.taskStart;
    aiTaskRuntimeRegistry.finish = originals.taskFinish;
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: report.status, output, checks: report.checks.length }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
