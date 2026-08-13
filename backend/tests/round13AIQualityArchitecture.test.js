'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { AIDirectorStrategyAuthority } = require('../services/aiDirectorStrategyAuthority');
const memoryRecall = require('../services/goalDrivenMemoryRecallService');
const { branchNameForVariant, candidateBranchPlanForCount } = require('../services/contextAwareReplyBrain');
const replyFeedbackLearningService = require('../services/replyFeedbackLearningService');
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

test('DirectorStrategyV2 no longer fingerprints learned-profile versions', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../services/contextAwareReplyBrain.js'),'utf8');assert.doesNotMatch(source,/learningFingerprint|getLatestLearningProfile/u); });

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

test('eligible feedback does not change the next preference profile automatically', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true},learningEligible:true});assert.equal(row.learningEligible,true);assert.equal(row.signal.metadata.automaticProfileMutation,false); });

test('emergency candidates are structural evidence but excluded from eligible learning', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'e',contactId:'p',conversationId:'c',emergencyMode:true,personaTruthReceipt:{pass:true}});assert.equal(row.learningEligible,false); });

test('V4 promotion requires regression, shadow and explicit human approval', async () => { const {createLearningPromotionAdapter}=require('../services/learningPromotionAdapter');const a=createLearningPromotionAdapter({openFeature:{setEvaluationContext(){}},flagd:{mode:'in-process-offline'}});await assert.rejects(()=>a.promote({status:'READY_FOR_REVIEW',Regression:{passed:true},Shadow:{passed:true},Candidate:{}},{approved:false})); });

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

test('production sent feedback writes one idempotent signal without changing branch preference', () => { const service=require('../services/replyFeedbackLearningService');const a=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});const b=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});assert.equal(a.signalId,b.signalId);assert.equal(a.signal.metadata.automaticProfileMutation,false); });


test('candidate interactions remain non-eligible provisional evidence until successful send', () => { const {routeLearningEligibility}=require('../services/candidateInteractionLearningService');assert.equal(routeLearningEligibility({personaTruthReceipt:{pass:true}}).reasonCode,'PENDING_SUCCESSFUL_SEND');assert.equal(routeLearningEligibility({personaTruthReceipt:{pass:true},emergencyMode:true}).eligible,false); });
