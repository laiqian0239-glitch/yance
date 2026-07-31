'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { AIDirectorStrategyAuthority } = require('../services/aiDirectorStrategyAuthority');
const { LearningPreferenceAuthority } = require('../services/learningPreferenceAuthority');
const memoryRecall = require('../services/goalDrivenMemoryRecallService');
const { branchNameForVariant, candidateBranchPlanForCount } = require('../services/contextAwareReplyBrain');
const replyFeedbackLearningService = require('../services/replyFeedbackLearningService');
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');
const { CandidateInteractionLearningService } = require('../services/candidateInteractionLearningService');
const aiQuality = require('../services/aiQualityRouteAuthority');
const { StoreManager } = require('../store/StoreManager');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { registerRuntimeStateCommands } = require('../store/commands/registerRuntimeStateCommands');


function highQualityModel(id = 'quality-model') {
  return {
    id, name: id, provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director', 'learning_synthesis', 'understanding', 'relationship'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', pass: true, status: 'REPLY_BRAIN_QUALIFIED', completed: true, score: 92,
      scenarios: [
        { id: 'german_whatsapp', pass: true, score: 19 },
        { id: 'english_whatsapp', pass: true, score: 19 },
        { id: 'persona_boundary', pass: true, score: 24 },
        { id: 'director_schema', pass: true, score: 19 },
        { id: 'latency', pass: true, score: 11 }
      ]
    }
  };
}
function validRouteReceipt(task = 'quick_reply') {
  return aiQuality.routeReceipt({ task, selectedModel: highQualityModel(`${task}-model`), routePlan: { state: 'ready', violations: [] } });
}

function withAuthorities(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r13-ai-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try {
    return callback({
      store,
      repository,
      director: new AIDirectorStrategyAuthority({ repository }),
      learning: new LearningPreferenceAuthority({ repository })
    });
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function withAuthoritiesAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r13-ai-async-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try {
    return await callback({
      store,
      repository,
      director: new AIDirectorStrategyAuthority({ repository }),
      learning: new LearningPreferenceAuthority({ repository })
    });
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('DirectorStrategyV2 is reusable until context, persona, memory or learning versions change', () => {
  withAuthorities(({ director, store }) => {
    const input = {
      contactId: 'c1', conversationId: 'conv-1', conversationGeneration: '42', personaVersionId: 5,
      memorySnapshotId: 'mem-3', learningProfileVersion: 2,
      strategy: {
        relationshipGoal: 'advance_relationship', questionPolicy: 'optional', lengthTarget: 'short',
        mustUseMemory: ['trip-topic'], avoid: ['generic-compliment'], evidenceRefs: ['message-42']
      }
    };
    const first = director.createOrReuse(input);
    const second = director.createOrReuse(input);
    assert.equal(first.created, true);
    assert.equal(second.reused, true);
    assert.equal(first.strategy.strategyId, second.strategy.strategyId);
    const changed = director.createOrReuse({ ...input, learningProfileVersion: 3 });
    assert.equal(changed.created, true);
    assert.equal(changed.strategy.strategyVersion, 2);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM ai_director_strategies WHERE conversation_id='conv-1' AND state='active'").get().count, 1);
  });
});

test('candidate plans keep one persona while creating distinct strategy branches', () => {
  withAuthorities(({ director }) => {
    const strategy = director.createOrReuse({
      contactId: 'c1', conversationId: 'conv-1', personaVersionId: 7,
      strategy: { relationshipGoal: 'advance_relationship', candidateBranches: ['natural_hook','playful_attraction','screen_and_advance'] }
    }).strategy;
    const plan = director.createCandidatePlan({ strategyId: strategy.strategyId, candidateCount: 3, targetLanguage: 'de' }).plan;
    assert.equal(plan.sharedConstraints.personaLocked, true);
    assert.equal(plan.sharedConstraints.personaVersionId, 7);
    assert.equal(new Set(plan.branches.map(row => row.strategy)).size, 3);
    assert.deepEqual(plan.branches.map(row => row.strategy), ['natural_hook','playful_attraction','screen_and_advance']);
    const adjusted = director.adjustCandidatePlan({ planId: plan.planId, axisId: 'axis-2', adjustment: 'no_question' }).plan;
    const axis2 = adjusted.branches.find(row => row.axisId === 'axis-2');
    assert.equal(axis2.question, 'none');
    assert.equal(axis2.adjustments.includes('no_question'), true);
  });
});

test('eligible L1 feedback changes the next preference profile immediately', () => {
  withAuthorities(({ learning }) => {
    const result = learning.recordSignal({
      signalType: 'candidate_micro_adjusted', scopeType: 'conversation', scopeId: 'conv-1', conversationId: 'conv-1',
      contactId: 'c1', candidateId: 'cand-1', adjustments: ['shorter','no_question'], finalText: 'Bis morgen.',
      qualityRouteReceipt: validRouteReceipt('quick_reply')
    });
    assert.equal(result.profileChanged, true);
    assert.equal(result.profile.preference.axisWeights.short > 0, true);
    assert.equal(result.profile.preference.axisWeights.noQuestion > 0, true);
    assert.equal(result.profile.preference.questionPreference, 'fewer_questions');
  });
});

test('emergency candidates are recorded for audit but excluded from learning profiles', () => {
  withAuthorities(({ learning, store }) => {
    const result = learning.recordSignal({
      signalType: 'candidate_sent', scopeType: 'conversation', scopeId: 'conv-1', conversationId: 'conv-1',
      contactId: 'c1', candidateId: 'cand-emergency', finalText: 'Hallo',
      qualityRouteReceipt: { qualityTier: 'emergency', learningEligible: false, emergencyMode: true }
    });
    assert.equal(result.profileChanged, false);
    assert.equal(result.excludedReason, 'EMERGENCY_RESULT_NOT_LEARNING_ELIGIBLE');
    const row = store.db.prepare('SELECT emergency_mode,learning_eligible FROM learning_signal_ledger').get();
    assert.equal(row.emergency_mode, 1);
    assert.equal(row.learning_eligible, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_preference_profiles').get().count, 0);
  });
});

test('L3 Persona promotion requires high confidence, current cross-contact L2 profiles and human approval', () => {
  withAuthorities(({ learning, repository }) => {
    const created = [];
    const at = new Date().toISOString();
    for (let contact = 0; contact < 3; contact += 1) {
      const contactId = `c-${contact}`;
      const evidence = Array.from({ length: 9 }, (_, index) => `l1-${contact}-${index}`);
      repository.insertLearningProfile({
        scopeType: 'contact', scopeId: contactId, learningLevel: 'L2', version: 1,
        preference: { defaultLength: 'short' }, evidenceSignalIds: evidence, confidence: 0.85,
        state: 'candidate', createdAt: at, activatedAt: ''
      });
      repository.activateLearningProfile({ scopeType: 'contact', scopeId: contactId, learningLevel: 'L2', version: 1, activatedAt: at });
      const row = repository.insertLearningSignal({
        signalId: `s-${contact}`, idempotencyKey: `idem-${contact}`, learningLevel: 'L2', scopeType: 'owner', scopeId: 'owner',
        contactId, conversationId: '', signalType: 'synthesis_promoted',
        signal: { targetScopeType: 'contact', targetScopeId: contactId, profileVersion: 1, evidenceSignalIds: evidence },
        qualityTier: 'high', emergencyMode: false, learningEligible: true, createdAt: new Date(Date.now() + contact).toISOString()
      });
      created.push(row.signal_id);
    }
    const base = {
      synthesisId: 'l3-owner-v1', fromLevel: 'L2', toLevel: 'L3', sourceScopeType: 'owner', sourceScopeId: 'owner',
      targetScopeType: 'persona', targetScopeId: 'owner', evidenceSignalIds: created,
      preference: { defaultLength: 'short' }, confidence: 0.85,
      qualityRouteReceipt: validRouteReceipt('learning_synthesis')
    };
    assert.throws(() => learning.applySynthesis(base), error => error.code === 'L3_HUMAN_APPROVAL_REQUIRED');
    const promoted = learning.applySynthesis({ ...base, humanApproved: true, actor: 'owner', reason: 'approved after cross-contact review' });
    assert.equal(promoted.profile.learningLevel, 'L3');
    assert.equal(promoted.profile.state, 'active');
    assert.equal(promoted.distinctContacts, 3);
    assert.equal(learning.applySynthesis({ ...base, humanApproved: true, actor: 'owner', reason: 'approved after cross-contact review' }).idempotentReplay, true);
  });
});

test('goal-driven memory recall prioritizes useful evidence and suppresses conflicts and unsupported claims', () => {
  const result = memoryRecall.recall({
    goal: 'advance_relationship',
    memories: [
      { id: 'm1', type: 'unfinished_topic', text: '他上次说想去维也纳', confidence: 0.9, evidenceRef: 'msg-1', updatedAt: new Date().toISOString() },
      { id: 'm2', type: 'confirmed_fact', text: '他喜欢滑雪', confidence: 0.9, evidenceRef: '', updatedAt: new Date().toISOString() },
      { id: 'm3', type: 'confirmed_fact', factKey: 'city', text: '住在汉堡', confidence: 0.9, evidenceRef: 'msg-3', updatedAt: new Date().toISOString() },
      { id: 'm4', type: 'confirmed_fact', factKey: 'city', text: '住在柏林', confidence: 0.9, evidenceRef: 'msg-4', updatedAt: new Date().toISOString() },
      { id: 'm5', type: 'sensitive_boundary', text: '不喜欢讨论前任', confidence: 1, evidenceRef: 'msg-5', updatedAt: new Date().toISOString() }
    ]
  });
  assert.equal(result.selected[0].memoryId, 'm1');
  assert.equal(result.selected.some(row => row.memoryId === 'm2'), false);
  assert.equal(result.selected.some(row => row.memoryId === 'm3' || row.memoryId === 'm4'), false);
  assert.equal(result.suppressed.some(row => row.type === 'conflict'), true);
});


test('production candidate variants map to distinct controlled strategy branches', () => {
  const variants = ['自然成熟', '温暖有女人味', '简短直接', '边界清晰', '不提问留余味'];
  const mapped = variants.map(branchNameForVariant);
  assert.deepEqual(mapped, ['natural_hook','playful_attraction','direct_advance','screen_and_advance','leave_aftertaste']);
  assert.deepEqual(candidateBranchPlanForCount(3), ['natural_hook','playful_attraction','direct_advance']);
  assert.equal(new Set(candidateBranchPlanForCount(5)).size, 5);
});

test('production sent feedback writes one idempotent L1 signal and changes the next branch preference', async () => {
  await withAuthoritiesAsync(async ({ store }) => {
    const repository = new ReplyFeedbackRepository(store);
    store.upsertAccount({ id: 'wa-round13-learning', platform: 'whatsapp', adapterAccountId: 'wa-round13-learning', displayName: 'Round 13', canSend: true, canReceive: true });
    store.upsertContact({ id: 'contact-1', platform: 'whatsapp', accountId: 'wa-round13-learning', externalId: '491111111@s.whatsapp.net', displayName: 'Contact 1', canonicalContactId: 'contact-1' });
    store.upsertConversation({ sessionKey: 'conversation-1', platform: 'whatsapp', accountId: 'wa-round13-learning', contactId: 'contact-1', title: 'Contact 1', routeState: 'ready', version: 1 });
    const storeManager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store }) });
    registerRuntimeStateCommands(storeManager);
    registerAiReplyCommands(storeManager);
    await storeManager.hydrate();
    await storeManager.dispatch({
      type: 'SYNC_CUSTOMER_CONTEXT',
      source: 'round13-production-learning-test',
      payload: { context: { contact: { id: 'contact-1', displayName: 'Contact 1' } } }
    });
    const payload = {
      evidenceId: 'sent:outbox-1', eventType: 'sent', candidateId: 'candidate-1', outboxId: 'outbox-1',
      contactId: 'contact-1', conversationId: 'conversation-1', originalText: 'Long question?', finalText: 'Bis morgen.',
      learningMode: 'send_and_learn', replyTask: 'quick_reply', styleVariant: '自然成熟', observedAt: new Date().toISOString(),
      generationMetadata: {
        candidateStrategyBranchId: 'natural_hook', candidateAxisId: 'axis-1',
        directorStrategy: { strategyId: 'strategy-1' }, candidatePlan: { planId: 'plan-1' },
        qualityTier: 'high', emergencyMode: false, learningEligible: true, highCapabilityPath: true,
        personaTruthReceipt: { pass: true, receiptSha256: 'truth-sent-1' },
        qualityRouteReceipt: validRouteReceipt('quick_reply')
      }
    };
    const first = await replyFeedbackLearningService.recordFeedback(storeManager, repository, payload);
    const second = await replyFeedbackLearningService.recordFeedback(storeManager, repository, payload);
    assert.equal(first.projection.completed, 1);
    assert.equal(second.projection.completed, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_signal_ledger').get().count, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM learning_preference_profiles WHERE scope_type='conversation' AND scope_id='conversation-1'").get().count, 1);
    const profileRow = store.db.prepare("SELECT preference_json FROM learning_preference_profiles WHERE scope_type='conversation' AND scope_id='conversation-1' ORDER BY version DESC LIMIT 1").get();
    const profile = JSON.parse(profileRow.preference_json || '{}');
    assert.equal(Number(profile.branchWeights?.natural_hook || 0) > 0, true);
  });
});


test('candidate interactions remain provisional until successful send and emergency results stay excluded', () => {
  withAuthorities(({ repository, store }) => {
    const state = {
      aiBrain: { candidatesById: {
        'candidate-high': {
          candidateId: 'candidate-high', contactId: 'contact-1', conversationId: 'conversation-1',
          text: 'Bis morgen.', originalText: 'Bis morgen.', state: 'generated',
          generationMetadata: {
            candidateStrategyBranchId: 'natural_hook', candidateAxisId: 'axis-1',
            qualityTier: 'high', emergencyMode: false, learningEligible: true,
            personaTruthReceipt: { pass: true, receiptSha256: 'truth-candidate-high' },
            qualityRouteReceipt: validRouteReceipt('quick_reply')
          }
        },
        'candidate-emergency': {
          candidateId: 'candidate-emergency', contactId: 'contact-1', conversationId: 'conversation-1',
          text: 'Hallo.', originalText: 'Hallo.', state: 'generated', emergencyMode: true, learningEligible: false,
          generationMetadata: {
            candidateStrategyBranchId: 'playful_attraction', qualityTier: 'emergency', emergencyMode: true, learningEligible: false,
            personaTruthReceipt: { pass: true, receiptSha256: 'truth-candidate-emergency' },
            qualityRouteReceipt: { qualityTier: 'emergency', emergencyMode: true, learningEligible: false }
          }
        }
      } }
    };
    const storeManager = { select(selector) { return selector(state); } };
    const service = new CandidateInteractionLearningService({
      storeManager,
      authority: new LearningPreferenceAuthority({ repository })
    });
    const used = service.record({ candidateId: 'candidate-high', signalType: 'candidate_used', interactionId: 'use-1' });
    const replay = service.record({ candidateId: 'candidate-high', signalType: 'candidate_used', interactionId: 'use-1' });
    const adjusted = service.record({ candidateId: 'candidate-high', signalType: 'candidate_micro_adjusted', interactionId: 'adjust-1', adjustments: ['更短','不提问'], finalText: 'Morgen.' });
    const emergency = service.record({ candidateId: 'candidate-emergency', signalType: 'candidate_used', interactionId: 'emergency-use-1' });
    assert.equal(used.profileChanged, false);
    assert.equal(used.excludedReason, 'PENDING_SUCCESSFUL_SEND');
    assert.equal(replay.idempotentReplay, true);
    assert.equal(adjusted.profileChanged, false);
    assert.equal(adjusted.excludedReason, 'PENDING_SUCCESSFUL_SEND');
    assert.equal(emergency.profileChanged, false);
    assert.equal(emergency.excludedReason, 'EMERGENCY_RESULT_NOT_LEARNING_ELIGIBLE');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_signal_ledger').get().count, 3);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_signal_ledger WHERE learning_eligible=1').get().count, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM learning_signal_ledger WHERE json_extract(signal_json,'$.exclusionReason')='PENDING_SUCCESSFUL_SEND'").get().count, 2);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM learning_preference_profiles').get().count, 0);
  });
});
