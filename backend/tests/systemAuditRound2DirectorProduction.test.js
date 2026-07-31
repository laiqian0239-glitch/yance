'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contactContextAuthority = require('../services/contactContextAuthority');
const conversationTurnCoordinator = require('../services/conversationTurnCoordinator');
const typingStateService = require('../services/typingStateService');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const {
  createContextAwareReplyBrain,
  validateDirectorPlan,
  mergeDirectorControls
} = require('../services/contextAwareReplyBrain');

function socialContext() {
  return {
    found: true,
    ready: true,
    contactId: 'contact1',
    contextVersion: 19,
    entityVersions: { customer: 1, relationship: 2, memory: 3, interactionPolicy: 1, routing: 4 },
    customer: { id: 'contact1', platform: 'whatsapp', accountId: 'account1', name: 'Kurt' },
    relationshipPotential: { relationshipStage: 'warming', warmth: 0.7 },
    relationshipAnalysis: { stage: 'warming', evidenceMessageIds: ['m1'] },
    emotion: { trend: 'warm', current: 'positive' },
    interaction: { cadence: 'rapid' },
    preferences: { replyLength: 'short' },
    feedbackLearning: { effective: {} },
    interactionPolicy: { policy: { allowReplies: true } },
    replyStrategy: { recommendedTone: 'natural', recommendedLength: 'short', recommendedDepth: 'light', maxQuestions: 1 },
    memory: {
      confirmedFacts: [{ key: 'interest', value: '骑行', evidenceMessageId: 'm1', allowInReply: true }],
      userNotes: [], importantEvents: [], openLoops: [], promises: [], boundaries: [], sensitiveTopics: [], recurringInterests: []
    },
    timeline: [],
    recentSignals: [],
    recentMessages: [{ id: 'm1', direction: 'inbound', type: 'text', text: '我刚骑车回来', sentAt: '2026-07-25T10:00:00Z' }]
  };
}

function persona() {
  return {
    compileEffectiveContext() {
      return {
        profileId: 'owner', personaVersionId: 2, policyHash: 'persona-hash', effectiveLabel: 'Yeonhee', appliedScopes: [],
        context: { persona: { truthSafePacket: { preferredLanguage: 'Chinese', style: {}, publicFacts: [], runtimeAuthority: { authority: 'YancePersonaRuntimeTruthAuthority', pass: true, receiptSha256: 'test-truth-receipt' } }, learned: {} } }
      };
    }
  };
}

function manager(dispatches) {
  const state = { conversations: { byId: { conv1: { id: 'conv1', version: 8 } } } };
  return {
    select(selector) { return selector(state); },
    async dispatch(command) {
      dispatches.push(command);
      if (command.type === 'AI_REPLY_TASK_STARTED') return { result: { taskId: 'task1' } };
      if (command.type === 'AI_REPLY_CANDIDATE_READY') return { result: { candidateId: 'candidate1' } };
      return { result: {} };
    }
  };
}

function mockRuntime(t) {
  t.mock.method(contactContextAuthority, 'getSocialContext', () => socialContext());
  t.mock.method(conversationTurnCoordinator, 'waitForQuiet', async () => ({ waitedMs: 0 }));
  t.mock.method(conversationTurnCoordinator, 'capture', (_id, persistedRevision) => ({ conversationId: 'conv1', runtimeRevision: 0, persistedRevision }));
  t.mock.method(conversationTurnCoordinator, 'isCurrent', () => true);
  t.mock.method(conversationTurnCoordinator, 'settle', () => {});
  t.mock.method(typingStateService, 'beginAiGeneration', async () => ({}));
  t.mock.method(typingStateService, 'endAiGeneration', async () => ({}));
  t.mock.method(aiTaskRuntimeRegistry, 'replace', async () => ({ signal: new AbortController().signal, generation: 1 }));
  t.mock.method(aiTaskRuntimeRegistry, 'finish', () => {});
}

function validDirector(overrides = {}) {
  return {
    strategy: '自然承接',
    reasonZh: '对方刚分享骑行经历，适合轻松承接',
    goal: '继续自然聊天',
    tone: '温暖自然',
    pace: '轻快',
    instruction: '简短回应骑行并留下一个轻松话题钩子',
    avoid: '不要捏造地点或经历',
    targetLanguage: 'zh',
    maxQuestions: 1,
    ...overrides
  };
}

test('production candidate path executes director first and manual controls override automatic plan', async t => {
  mockRuntime(t);
  const calls = [];
  const dispatches = [];
  let replyPrompt = '';
  const gateway = {
    async execute(input) {
      calls.push(input);
      if (input.task === 'director') {
        return { text: JSON.stringify(validDirector()), modelId: 'director-primary', model: 'Director Primary', attempts: [{ status: 'success' }] };
      }
      replyPrompt = input.messages.map(row => row.content).join('\n');
      return { text: '听起来很舒服，骑完车整个人都会轻松一点。', modelId: 'reply-primary', model: 'Reply Primary', attempts: [{ status: 'success' }] };
    }
  };
  const brain = createContextAwareReplyBrain({ storeManager: manager(dispatches), aiGateway: gateway, personaBrain: persona(), waitForLearningIdle: async () => {} });
  const result = await brain.generateCandidate({
    contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'm1', text: '我刚骑车回来' },
    skipQuietWindow: true,
    director: { instruction: '不要继续谈骑行，换到音乐话题', tone: '更直接' }
  });

  assert.deepEqual(calls.map(row => row.task), ['director', 'quick_reply']);
  assert.equal(calls[0].context.scopeKey, 'director:contact1:conv1');
  assert.equal(calls[1].context.scopeKey, 'reply:contact1:conv1');
  assert.match(replyPrompt, /不要继续谈骑行，换到音乐话题/);
  assert.match(replyPrompt, /更直接/);
  assert.equal(result.director.strategy, '自然承接');
  assert.match(result.director.instruction, /临时导演指令·最高优先级.*不要继续谈骑行，换到音乐话题/s);
  assert.equal(result.directorRuleStackReceipt.pass, true);
  assert.equal(result.directorModelId, 'director-primary');
  assert.equal(result.generationMetadata.director.plan.reasonZh, '对方刚分享骑行经历，适合轻松承接');
  assert.equal(Boolean(result.directorStrategy.strategyId), true);
  assert.equal(result.candidatePlan.candidateCount, result.performancePolicy.candidateCount);
  assert.deepEqual(result.candidatePlan.branches.map(row => row.strategy), ['natural_hook', 'playful_attraction', 'direct_advance']);
  assert.equal(result.candidateStrategyBranch.strategy, 'natural_hook');
  assert.equal(result.generationMetadata.directorStrategy.strategyId, result.directorStrategy.strategyId);
  assert.equal(result.generationMetadata.candidatePlan.planId, result.candidatePlan.planId);
  assert.equal(result.generationMetadata.candidateStrategyBranchId, 'natural_hook');
  assert.equal(result.memoryRecall.evidenceRequired, true);
  const ready = dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY');
  assert.match(ready.payload.director.instruction, /临时导演指令·最高优先级.*不要继续谈骑行，换到音乐话题/s);
  assert.equal(ready.payload.directorRuleStackReceipt.pass, true);
  assert.equal(ready.payload.directorModelId, 'director-primary');
  assert.equal(ready.payload.generationMetadata.directorStrategy.strategyId, result.directorStrategy.strategyId);
  assert.equal(ready.payload.generationMetadata.candidateStrategyBranchId, 'natural_hook');
});

test('invalid director output blocks reply generation and reports the director stage truthfully', async t => {
  mockRuntime(t);
  const calls = [];
  const dispatches = [];
  const gateway = {
    async execute(input) {
      calls.push(input);
      return { text: '{not-json', modelId: 'director-bad', model: 'Director Bad' };
    }
  };
  const brain = createContextAwareReplyBrain({ storeManager: manager(dispatches), aiGateway: gateway, personaBrain: persona(), waitForLearningIdle: async () => {} });
  await assert.rejects(
    brain.generateCandidate({ contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'm1', text: '我刚骑车回来' }, skipQuietWindow: true }),
    error => {
      assert.equal(error.code, 'AI_DIRECTOR_INVALID_OUTPUT');
      assert.equal(error.aiStageFailure.stage, 'director');
      assert.equal(error.aiStageFailure.task, 'director');
      assert.deepEqual(error.aiStageFailure.priorStages.map(row => row.stage), ['understanding']);
      return true;
    }
  );
  assert.deepEqual(calls.map(row => row.task), ['director', 'director']);
  assert.equal(calls[1].modelId, 'director-bad');
  assert.equal(calls[1].options.onlyRequestedModel, true);
  assert.equal(calls[1].context.scopeKey, 'director-repair:contact1:conv1');
  const cancelled = dispatches.find(row => row.type === 'AI_REPLY_TASK_CANCELLED');
  assert.equal(cancelled.payload.failed, true);
});

test('director schema repair retries the exact successful model once before reply generation', async t => {
  mockRuntime(t);
  const calls = [];
  const dispatches = [];
  const gateway = {
    async execute(input) {
      calls.push(input);
      if (calls.length === 1) {
        return {
          text: '{not-json',
          modelId: 'director-primary',
          model: 'Director Primary',
          attempts: [{ modelId: 'director-primary', status: 'success' }]
        };
      }
      if (calls.length === 2) {
        return {
          text: JSON.stringify(validDirector()),
          modelId: 'director-primary',
          model: 'Director Primary',
          attempts: [{ modelId: 'director-primary', status: 'success' }]
        };
      }
      return {
        text: '骑完车听起来很舒服，今晚就让自己慢一点。',
        modelId: 'reply-primary',
        model: 'Reply Primary',
        attempts: [{ modelId: 'reply-primary', status: 'success' }]
      };
    }
  };
  const brain = createContextAwareReplyBrain({ storeManager: manager(dispatches), aiGateway: gateway, personaBrain: persona(), waitForLearningIdle: async () => {} });
  const result = await brain.generateCandidate({
    contactId: 'contact1', conversationId: 'conv1', incomingMessage: { id: 'm1', text: '我刚骑车回来' }, skipQuietWindow: true
  });

  assert.deepEqual(calls.map(row => row.task), ['director', 'director', 'quick_reply']);
  assert.equal(calls[1].modelId, 'director-primary');
  assert.equal(calls[1].options.onlyRequestedModel, true);
  assert.match(calls[1].messages.at(-1).content, /reasonCode: AI_DIRECTOR_INVALID_OUTPUT/);
  assert.equal(result.directorSchemaRepair.attempted, true);
  assert.equal(result.directorSchemaRepair.succeeded, true);
  assert.equal(result.directorSchemaRepair.requestedModelId, 'director-primary');
  assert.equal(result.directorSchemaRepair.selectedModelId, 'director-primary');
  assert.equal(result.generationMetadata.director.schemaRepair.succeeded, true);
  assert.equal(result.directorAttempts.length, 2);
  const ready = dispatches.find(row => row.type === 'AI_REPLY_CANDIDATE_READY');
  assert.equal(ready.payload.directorSchemaRepair.succeeded, true);
  assert.equal(ready.payload.generationMetadata.director.schemaRepair.succeeded, true);
});

test('director schema rejects wrong language, internal identifiers and invalid question counts', () => {
  const authority = { code: 'de' };
  assert.throws(() => validateDirectorPlan(validDirector({ targetLanguage: 'en' }), authority), error => error.code === 'AI_DIRECTOR_LANGUAGE_MISMATCH');
  assert.throws(() => validateDirectorPlan(validDirector({ targetLanguage: 'de', instruction: 'use PSID 123456789012345' }), authority), error => error.code === 'AI_DIRECTOR_INTERNAL_ID_LEAK');
  assert.throws(() => validateDirectorPlan(validDirector({ targetLanguage: 'de', maxQuestions: 2 }), authority), error => error.code === 'AI_DIRECTOR_INVALID_OUTPUT');
  const merged = mergeDirectorControls(validDirector(), { instruction: 'manual instruction', maxQuestions: 0, styleWeights: { playful: 0.8 } });
  assert.equal(merged.instruction, 'manual instruction');
  assert.equal(merged.maxQuestions, 0);
  assert.deepEqual(merged.styleWeights, { playful: 0.8 });
});
