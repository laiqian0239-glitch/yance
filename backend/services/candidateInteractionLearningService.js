'use strict';

const eventBus = require('./eventBus');
const { getStoreManager } = require('../store/storeManagerSingleton');
const { LearningPreferenceAuthority } = require('./learningPreferenceAuthority');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { getStore } = require('../repositories/storeProvider');

const AUTHORITY = 'CandidateInteractionLearningService';
const SIGNAL_TYPES = new Set(['candidate_used', 'candidate_appended', 'candidate_revised', 'candidate_micro_adjusted']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function error(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }

function normalizeAdjustments(values = []) {
  const source = unique(Array.isArray(values) ? values : [values]);
  const output = new Set();
  const mappings = [
    [/短|short/u, 'shorter'], [/直接|direct/u, 'direct'], [/自然|natural/u, 'natural'],
    [/温柔|温暖|gentle|warm/u, 'gentle'], [/妩媚|女人味|feminine/u, 'feminine'], [/暧昧|情趣|调情|flirt/u, 'flirtier'],
    [/不提问|no[_ -]?question/u, 'no_question'], [/换话题|topic[_ -]?pivot/u, 'topic_pivot'],
    [/降温|cool/u, 'cooler'], [/强势|女王|strong/u, 'stronger'], [/害羞|小女人|shy/u, 'shy']
  ];
  for (const value of source) {
    let mapped = false;
    for (const [pattern, tag] of mappings) {
      if (pattern.test(value.toLowerCase())) { output.add(tag); mapped = true; }
    }
    if (!mapped && /^[a-z][a-z0-9_-]*$/i.test(value)) output.add(value);
  }
  return [...output];
}

class CandidateInteractionLearningService {
  constructor(options = {}) {
    this.storeManager = options.storeManager || null;
    const repository = options.repository || createPlatformCoreRepository({ storeProvider: () => options.store || getStore() });
    this.authority = options.authority || new LearningPreferenceAuthority({ repository });
  }

  record(input = {}) {
    const candidateId = clean(input.candidateId);
    const signalType = clean(input.signalType);
    const interactionId = clean(input.interactionId);
    if (!candidateId) throw error('CANDIDATE_INTERACTION_CANDIDATE_REQUIRED', '候选交互必须绑定候选。');
    if (!SIGNAL_TYPES.has(signalType)) throw error('CANDIDATE_INTERACTION_TYPE_INVALID', '不支持的候选交互学习类型。');
    if (!interactionId) throw error('CANDIDATE_INTERACTION_ID_REQUIRED', '候选交互必须提供唯一交互标识。');

    const storeManager = this.storeManager || getStoreManager();
    const candidate = storeManager.select(state => state.aiBrain?.candidatesById?.[candidateId] || null);
    if (!candidate) throw error('AI_REPLY_CANDIDATE_NOT_FOUND', 'AI 回复候选不存在。', 404, { candidateId });
    if (candidate.state === 'reverify_required') throw error('AI_REPLY_CANDIDATE_REVERIFY_REQUIRED', '候选上下文已经失效，不能写入正向学习。', 409, { candidateId });

    const metadata = candidate.generationMetadata || {};
    const route = candidate.qualityRouteReceipt || metadata.qualityRouteReceipt || {};
    const branch = candidate.candidateStrategyBranch || metadata.candidateStrategyBranch || {};
    const personaTruthReceipt = candidate.personaTruthReceipt || metadata.personaTruthReceipt || {};
    const emergencyMode = candidate.emergencyMode === true || metadata.emergencyMode === true || route.emergencyMode === true;
    const truthEligible = personaTruthReceipt && typeof personaTruthReceipt === 'object' && personaTruthReceipt.pass === true;
    const learningEligible = candidate.learningEligible !== false && metadata.learningEligible !== false && route.learningEligible !== false && !emergencyMode && truthEligible;
    const observedAt = clean(input.observedAt) || new Date().toISOString();
    const result = this.authority.recordSignal({
      signalType,
      scopeType: 'conversation',
      scopeId: clean(candidate.conversationId),
      contactId: clean(candidate.contactId),
      conversationId: clean(candidate.conversationId),
      candidateId,
      originalText: clean(candidate.originalText || candidate.text),
      finalText: clean(input.finalText || candidate.text),
      adjustments: normalizeAdjustments(input.adjustments),
      strategyBranch: clean(metadata.candidateStrategyBranchId || branch.strategy || candidate.director?.candidateStrategyBranch),
      qualityRouteReceipt: route,
      personaTruthReceipt,
      personaTruthRequired: true,
      qualityTier: clean(candidate.qualityTier || metadata.qualityTier || route.qualityTier),
      emergencyMode,
      learningEligible,
      provisional: true,
      idempotencyKey: `candidate-interaction:${candidateId}:${interactionId}`,
      observedAt,
      source: clean(input.source) || 'conversation-ui',
      metadata: {
        authority: AUTHORITY,
        interactionId,
        provisional: true,
        activationRequiresSuccessfulSend: true,
        interactionMode: clean(input.interactionMode),
        directorStrategyId: clean(candidate.directorStrategy?.strategyId || metadata.directorStrategy?.strategyId),
        candidatePlanId: clean(candidate.candidatePlan?.planId || metadata.candidatePlan?.planId),
        candidateAxisId: clean(metadata.candidateAxisId || branch.axisId),
        highCapabilityPath: candidate.highCapabilityPath === true || metadata.highCapabilityPath === true || route.highCapabilityPath === true,
        personaTruthReceiptPass: truthEligible,
        personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
      }
    });
    eventBus.publish('ai:candidate-learning-signal', {
      candidateId,
      contactId: candidate.contactId,
      conversationId: candidate.conversationId,
      signalType,
      interactionId,
      learningEligible: result.signal?.learningEligible === true,
      profileChanged: result.profileChanged === true,
      excludedReason: result.excludedReason || ''
    });
    return { authority: AUTHORITY, candidateId, signalType, interactionId, ...result };
  }
}

const singleton = new CandidateInteractionLearningService();
module.exports = { AUTHORITY, SIGNAL_TYPES, CandidateInteractionLearningService, singleton, normalizeAdjustments };
