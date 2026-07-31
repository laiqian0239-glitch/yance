'use strict';

const crypto = require('crypto');
const { stableId } = require('../lib/r32SqliteStore');
const { canonical, sha256 } = require('./domainEventLogService');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'DirectorStrategyV2Authority';
const SCHEMA_VERSION = 2;
const DEFAULT_EXPIRES_ON = Object.freeze(['new_inbound_message', 'director_override', 'relationship_state_change', 'persona_version_change']);
const BRANCHES = Object.freeze([
  Object.freeze({ strategy: 'natural_hook', length: 'short', warmth: 0.65, flirtation: 0.25, directness: 0.35, question: 'light', purpose: '自然回应并留下轻话题钩子' }),
  Object.freeze({ strategy: 'playful_attraction', length: 'short', warmth: 0.55, flirtation: 0.55, directness: 0.35, question: 'none', purpose: '增加玩心与吸引力，但不脱离人设' }),
  Object.freeze({ strategy: 'screen_and_advance', length: 'short', warmth: 0.5, flirtation: 0.35, directness: 0.55, question: 'selective', purpose: '轻筛选并推动对方多表达' }),
  Object.freeze({ strategy: 'direct_advance', length: 'short', warmth: 0.45, flirtation: 0.6, directness: 0.7, question: 'optional', purpose: '更直接地推进关系' }),
  Object.freeze({ strategy: 'leave_aftertaste', length: 'short', warmth: 0.5, flirtation: 0.5, directness: 0.4, question: 'none', purpose: '不提问，留出余味和空间' })
]);
const STYLE_ADJUSTMENTS = Object.freeze({
  shorter: { length: 'very-short' },
  direct: { directnessDelta: 0.2 },
  natural: { naturalnessDelta: 0.2, formalityDelta: -0.2 },
  gentle: { warmthDelta: 0.2, directnessDelta: -0.1 },
  feminine: { feminineExpressionDelta: 0.2, warmthDelta: 0.1 },
  flirtier: { flirtationDelta: 0.2 },
  no_question: { question: 'none' },
  topic_pivot: { strategy: 'topic_pivot' },
  cooler: { flirtationDelta: -0.2, warmthDelta: -0.1 },
  stronger: { directnessDelta: 0.2, assertivenessDelta: 0.2 },
  shy: { directnessDelta: -0.15, vulnerabilityDelta: 0.15 }
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number(value || 0))); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function error(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function normalizeTone(input = {}) {
  return {
    warmth: clamp(input.warmth == null ? 0.6 : input.warmth),
    flirtation: clamp(input.flirtation == null ? 0.35 : input.flirtation),
    directness: clamp(input.directness == null ? 0.4 : input.directness),
    intimacyCeiling: clamp(input.intimacyCeiling == null ? 0.55 : input.intimacyCeiling),
    formality: clamp(input.formality == null ? 0.1 : input.formality)
  };
}
function normalizeStrategy(input = {}) {
  const relationGoal = clean(input.relationshipGoal || input.goal) || 'maintain_and_learn';
  const branches = Array.isArray(input.candidateBranches) ? input.candidateBranches.map(clean).filter(Boolean) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    relationshipGoal: relationGoal,
    relationshipAction: clean(input.relationshipAction) || 'respond_naturally',
    toneEnvelope: normalizeTone(input.toneEnvelope || input.tone || {}),
    questionPolicy: clean(input.questionPolicy) || 'optional',
    lengthTarget: clean(input.lengthTarget) || 'short',
    initiative: clean(input.initiative) || 'balanced',
    mustUseMemory: unique(input.mustUseMemory),
    avoid: unique(input.avoid),
    prohibitedClaims: unique(input.prohibitedClaims),
    candidateBranches: branches.length ? branches : ['natural_hook', 'playful_attraction', 'screen_and_advance'],
    riskBoundaries: unique(input.riskBoundaries),
    rationale: clean(input.rationale),
    modelRouteReceipt: input.modelRouteReceipt || {},
    evidenceRefs: unique(input.evidenceRefs)
  };
}
function publicStrategy(row) {
  if (!row) return null;
  return {
    strategyId: row.strategy_id, contactId: row.contact_id, conversationId: row.conversation_id,
    strategyVersion: Number(row.strategy_version || 1), conversationGeneration: row.conversation_generation,
    personaVersionId: Number(row.persona_version_id || 0), memorySnapshotId: row.memory_snapshot_id,
    learningProfileVersion: Number(row.learning_profile_version || 0), strategy: row.strategy || {},
    strategySha256: row.strategy_sha256, evidenceRefs: row.evidence_refs || [], state: row.state,
    expiresOn: row.expires_on || [], createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function publicPlan(row) {
  if (!row) return null;
  return {
    planId: row.plan_id, strategyId: row.strategy_id, contactId: row.contact_id, conversationId: row.conversation_id,
    candidateCount: Number(row.candidate_count || 3), sharedConstraints: row.shared_constraints || {}, branches: row.branches || [],
    planSha256: row.plan_sha256, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

class AIDirectorStrategyAuthority {
  constructor(options = {}) { this.repository = options.repository || defaultRepository; }

  createOrReuse(input = {}) {
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    if (!contactId || !conversationId) throw error('DIRECTOR_STRATEGY_SCOPE_REQUIRED', '导演策略必须绑定联系人和会话。');
    const strategy = normalizeStrategy(input.strategy || input);
    const strategySha256 = sha256(strategy);
    const current = this.repository.getActiveDirectorStrategy(conversationId);
    const personaVersionId = Number(input.personaVersionId || 0);
    const memorySnapshotId = clean(input.memorySnapshotId);
    const learningProfileVersion = Number(input.learningProfileVersion || 0);
    const conversationGeneration = clean(input.conversationGeneration);
    if (current && current.strategy_sha256 === strategySha256
      && Number(current.persona_version_id || 0) === personaVersionId
      && clean(current.memory_snapshot_id) === memorySnapshotId
      && Number(current.learning_profile_version || 0) === learningProfileVersion
      && clean(current.conversation_generation) === conversationGeneration) {
      return { authority: AUTHORITY, created: false, reused: true, strategy: publicStrategy(current) };
    }
    const timestamp = clean(input.createdAt) || now();
    const version = Math.max(1, Number(current?.strategy_version || 0) + 1);
    const strategyId = clean(input.strategyId) || stableId('director-strategy-v2', [conversationId, version, strategySha256]);
    const created = this.repository.transaction(repo => {
      const row = repo.insertDirectorStrategy({
        strategyId, contactId, conversationId, strategyVersion: version, conversationGeneration, personaVersionId,
        memorySnapshotId, learningProfileVersion, strategy, strategySha256, evidenceRefs: strategy.evidenceRefs,
        state: 'active', expiresOn: unique(input.expiresOn?.length ? input.expiresOn : DEFAULT_EXPIRES_ON), createdAt: timestamp, updatedAt: timestamp
      });
      repo.supersedeDirectorStrategies(conversationId, strategyId, timestamp);
      return row;
    });
    return { authority: AUTHORITY, created: true, reused: false, strategy: publicStrategy(created) };
  }

  createCandidatePlan(input = {}) {
    const strategyId = clean(input.strategyId);
    const strategyRow = this.repository.getDirectorStrategy(strategyId);
    if (!strategyRow || strategyRow.state !== 'active') throw error('DIRECTOR_STRATEGY_NOT_ACTIVE', '候选计划必须绑定有效导演策略。', 409);
    const strategy = strategyRow.strategy || {};
    const candidateCount = Math.max(1, Math.min(5, Number(input.candidateCount || 3)));
    const requested = Array.isArray(input.branches) && input.branches.length ? input.branches : strategy.candidateBranches;
    const selected = [];
    for (const item of requested || []) {
      const name = clean(typeof item === 'string' ? item : item.strategy);
      const template = BRANCHES.find(row => row.strategy === name) || null;
      const base = typeof item === 'object' && item ? { ...(template || {}), ...item } : template;
      if (base && !selected.some(row => row.strategy === clean(base.strategy))) selected.push({ ...base });
      if (selected.length >= candidateCount) break;
    }
    for (const base of BRANCHES) {
      if (selected.length >= candidateCount) break;
      if (!selected.some(row => row.strategy === base.strategy)) selected.push({ ...base });
    }
    if (new Set(selected.map(row => row.strategy)).size !== selected.length) throw error('CANDIDATE_PLAN_DUPLICATE_BRANCH', '候选计划不能包含重复策略分支。', 409);
    const sharedConstraints = {
      personaLocked: true,
      personaVersionId: Number(strategyRow.persona_version_id || 0),
      strategyId,
      strategyVersion: Number(strategyRow.strategy_version || 1),
      targetLanguage: clean(input.targetLanguage),
      naturalPrivateChat: true,
      noMidSentenceEmoji: true,
      noUnsupportedFacts: true,
      evidenceRequiredForFacts: true,
      lengthTarget: clean(strategy.lengthTarget) || 'short',
      questionPolicy: clean(strategy.questionPolicy) || 'optional',
      toneEnvelope: strategy.toneEnvelope || {},
      mustUseMemory: strategy.mustUseMemory || [],
      avoid: strategy.avoid || [],
      learningWeights: input.learningWeights || {}
    };
    const branches = selected.map((branch, index) => ({ axisId: `axis-${index + 1}`, ...branch }));
    const document = { schemaVersion: 1, authority: 'CandidateGenerationPlanAuthority', candidateCount, sharedConstraints, branches };
    const planSha256 = sha256(document);
    const current = this.repository.getActiveCandidatePlan(strategyRow.conversation_id);
    if (current && current.plan_sha256 === planSha256 && current.strategy_id === strategyId) {
      return { authority: 'CandidateGenerationPlanAuthority', created: false, reused: true, plan: publicPlan(current) };
    }
    const timestamp = clean(input.createdAt) || now();
    const planId = clean(input.planId) || stableId('candidate-generation-plan', [strategyId, planSha256]);
    const created = this.repository.transaction(repo => {
      const row = repo.insertCandidatePlan({
        planId, strategyId, contactId: strategyRow.contact_id, conversationId: strategyRow.conversation_id,
        candidateCount, sharedConstraints, branches, planSha256, state: 'active', createdAt: timestamp, updatedAt: timestamp
      });
      repo.supersedeCandidatePlans(strategyRow.conversation_id, planId, timestamp);
      return row;
    });
    return { authority: 'CandidateGenerationPlanAuthority', created: true, reused: false, plan: publicPlan(created) };
  }

  adjustCandidatePlan(input = {}) {
    const plan = this.repository.getCandidatePlan(clean(input.planId));
    if (!plan) throw error('CANDIDATE_PLAN_NOT_FOUND', '候选计划不存在。', 404);
    const adjustment = STYLE_ADJUSTMENTS[clean(input.adjustment)] || null;
    if (!adjustment) throw error('CANDIDATE_ADJUSTMENT_UNSUPPORTED', '不支持的候选微调标签。', 400);
    const selectedAxis = clean(input.axisId);
    if (clean(plan.state) !== 'active') throw error('CANDIDATE_PLAN_NOT_ACTIVE', '只能微调当前有效的候选计划。', 409);
    if (selectedAxis && !(plan.branches || []).some(branch => clean(branch.axisId) === selectedAxis)) {
      throw error('CANDIDATE_PLAN_AXIS_NOT_FOUND', '候选微调目标不存在或已经失效。', 404, { planId: clean(input.planId), axisId: selectedAxis });
    }
    const branches = (plan.branches || []).map(branch => {
      if (selectedAxis && branch.axisId !== selectedAxis) return { ...branch };
      const next = { ...branch };
      if (adjustment.length) next.length = adjustment.length;
      if (adjustment.question) next.question = adjustment.question;
      if (adjustment.strategy) next.strategy = adjustment.strategy;
      for (const [key, delta] of Object.entries(adjustment)) {
        if (!key.endsWith('Delta')) continue;
        const target = key.slice(0, -5);
        next[target] = clamp(Number(next[target] || 0) + Number(delta || 0));
      }
      next.adjustments = unique([...(next.adjustments || []), clean(input.adjustment)]);
      return next;
    });
    return this.createCandidatePlan({
      strategyId: plan.strategy_id,
      candidateCount: Number(plan.candidate_count || branches.length),
      branches,
      targetLanguage: plan.shared_constraints?.targetLanguage,
      learningWeights: plan.shared_constraints?.learningWeights,
      createdAt: clean(input.createdAt) || now()
    });
  }
}

const singleton = new AIDirectorStrategyAuthority();
module.exports = {
  AUTHORITY, SCHEMA_VERSION, DEFAULT_EXPIRES_ON, BRANCHES, STYLE_ADJUSTMENTS,
  AIDirectorStrategyAuthority, singleton, normalizeStrategy, normalizeTone
};
