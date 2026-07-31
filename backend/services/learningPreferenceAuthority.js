'use strict';

const { stableId } = require('../lib/r32SqliteStore');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const { sha256 } = require('./domainEventLogService');
const eventBus = require('./eventBus');

const AUTHORITY = 'LearningPreferenceAuthority';
const SCHEMA_VERSION = 1;
const LEVEL = Object.freeze({ L1: 'L1', L2: 'L2', L3: 'L3' });
const SIGNAL_TYPES = new Set(['candidate_used','candidate_rejected','candidate_appended','candidate_revised','candidate_micro_adjusted','candidate_sent']);
const LEARNING_OBJECT_MAX_DEPTH = 10;
const LEARNING_OBJECT_MAX_NODES = 1000;
const LEARNING_OBJECT_MAX_BYTES = 128 * 1024;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function sanitizeLearningObject(value, label = 'learningObject') {
  const seen = new WeakSet();
  const state = { nodes: 0 };
  function walk(input, depth, path) {
    state.nodes += 1;
    if (state.nodes > LEARNING_OBJECT_MAX_NODES) throw error('LEARNING_OBJECT_TOO_COMPLEX', `${label} 超过最大节点数。`, 400, { path });
    if (depth > LEARNING_OBJECT_MAX_DEPTH) throw error('LEARNING_OBJECT_TOO_DEEP', `${label} 超过最大嵌套深度。`, 400, { path });
    if (input == null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw error('LEARNING_OBJECT_NUMBER_INVALID', `${label} 包含非有限数字。`, 400, { path });
      return input;
    }
    if (typeof input !== 'object') throw error('LEARNING_OBJECT_TYPE_INVALID', `${label} 包含不可持久化的数据类型。`, 400, { path, type: typeof input });
    if (Buffer.isBuffer(input) || input instanceof Date) throw error('LEARNING_OBJECT_TYPE_INVALID', `${label} 只能包含纯 JSON 数据。`, 400, { path });
    if (seen.has(input)) throw error('LEARNING_OBJECT_CYCLE', `${label} 包含循环引用。`, 400, { path });
    seen.add(input);
    try {
      if (Array.isArray(input)) return input.map((item, index) => walk(item, depth + 1, `${path}[${index}]`));
      const proto = Object.getPrototypeOf(input);
      if (proto !== Object.prototype && proto !== null) throw error('LEARNING_OBJECT_PROTOTYPE_INVALID', `${label} 包含非纯对象。`, 400, { path });
      const output = {};
      for (const key of Object.getOwnPropertyNames(input)) {
        if (FORBIDDEN_OBJECT_KEYS.has(key)) throw error('LEARNING_OBJECT_KEY_FORBIDDEN', `${label} 包含危险对象键。`, 400, { path: `${path}.${key}`, key });
        if (key.length > 128) throw error('LEARNING_OBJECT_KEY_TOO_LONG', `${label} 的对象键过长。`, 400, { path: `${path}.${key}` });
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor?.get || descriptor?.set) throw error('LEARNING_OBJECT_ACCESSOR_FORBIDDEN', `${label} 不得包含 getter/setter。`, 400, { path: `${path}.${key}` });
        output[key] = walk(descriptor?.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(input);
    }
  }
  const sanitized = walk(value == null ? {} : value, 0, label);
  const bytes = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  if (bytes > LEARNING_OBJECT_MAX_BYTES) throw error('LEARNING_OBJECT_TOO_LARGE', `${label} 超过最大持久化大小。`, 413, { bytes, maximum: LEARNING_OBJECT_MAX_BYTES });
  return sanitized;
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function clamp(value, min = -1, max = 1) { return Math.max(min, Math.min(max, Number(value || 0))); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function error(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function boundedText(value, label, maximum = 2048, pattern = null) {
  const result = clean(value);
  if (result.length > maximum) throw error('LEARNING_IDENTIFIER_TOO_LONG', `${label} 超过最大长度。`, 413, { label, length: result.length, maximum });
  if (/[\u0000-\u001f\u007f]/u.test(result) || (pattern && result && !pattern.test(result))) {
    throw error('LEARNING_IDENTIFIER_INVALID', `${label} 格式无效。`, 400, { label });
  }
  return result;
}
function timestamp(value, fallback = now()) {
  const result = clean(value) || fallback;
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds)) throw error('LEARNING_TIMESTAMP_INVALID', '学习信号时间无效。', 400, { value });
  return new Date(milliseconds).toISOString();
}
function boundedAdjustments(values = []) {
  const rows = unique(Array.isArray(values) ? values : [values]);
  if (rows.length > 50) throw error('LEARNING_ADJUSTMENTS_TOO_MANY', '学习微调标签数量超过上限。', 413, { count: rows.length, maximum: 50 });
  return rows.map((value, index) => boundedText(value, `adjustments[${index}]`, 128, /^[a-z0-9_-]+$/i));
}
function textSignals(text = '') {
  const source = clean(text);
  return {
    length: source.length <= 60 ? 'short' : source.length <= 160 ? 'medium' : 'long',
    question: /[?？]/u.test(source),
    emoji: /\p{Extended_Pictographic}/u.test(source),
    sentenceCount: source ? source.split(/[.!?。！？]+/u).filter(Boolean).length : 0
  };
}
function signalDelta(row = {}) {
  const payload = row.signal || {};
  const type = clean(row.signal_type || payload.signalType);
  const positive = ['candidate_used','candidate_appended','candidate_revised','candidate_sent','candidate_micro_adjusted'].includes(type);
  const negative = type === 'candidate_rejected';
  const factor = positive ? 1 : negative ? -1 : 0;
  const adjustments = unique(payload.adjustments || payload.tags || []);
  const axes = {};
  for (const tag of adjustments) {
    const mapping = {
      shorter: ['short', 1], direct: ['direct', 1], natural: ['natural', 1], gentle: ['gentle', 1],
      feminine: ['feminine', 1], flirtier: ['flirtier', 1], no_question: ['noQuestion', 1],
      topic_pivot: ['topicPivot', 1], cooler: ['cooler', 1], stronger: ['stronger', 1], shy: ['shy', 1]
    }[tag];
    if (mapping) axes[mapping[0]] = (axes[mapping[0]] || 0) + mapping[1] * factor;
  }
  const text = textSignals(payload.finalText || payload.text || '');
  if (text.length === 'short') axes.short = (axes.short || 0) + 0.5 * factor;
  if (!text.question) axes.noQuestion = (axes.noQuestion || 0) + 0.25 * factor;
  return { axes, text, factor };
}
function publicProfile(row) {
  if (!row) return null;
  return {
    scopeType: row.scope_type, scopeId: row.scope_id, learningLevel: row.learning_level,
    version: Number(row.version || 0), preference: row.preference || {}, evidenceSignalIds: row.evidence_signal_ids || [],
    confidence: Number(row.confidence || 0), state: row.state, createdAt: row.created_at, activatedAt: row.activated_at
  };
}


function validatePromotionScopes(fromLevel, toLevel, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId) {
  if (!sourceScopeId || !targetScopeId) throw error('LEARNING_PROMOTION_SCOPE_REQUIRED', '学习晋升必须绑定来源和目标作用域。');
  const l1Sources = new Set(['conversation', 'contact']);
  const l2Targets = new Set(['contact', 'relationship', 'customer']);
  const l2Sources = new Set(['owner', 'portfolio']);
  const l3Targets = new Set(['persona', 'global']);
  if (fromLevel === LEVEL.L1 && toLevel === LEVEL.L2 && (!l1Sources.has(sourceScopeType) || !l2Targets.has(targetScopeType))) {
    throw error('LEARNING_PROMOTION_SCOPE_INVALID', 'L1 只能从会话/联系人晋升到客户关系级作用域。', 409);
  }
  if (fromLevel === LEVEL.L2 && toLevel === LEVEL.L3 && (!l2Sources.has(sourceScopeType) || !l3Targets.has(targetScopeType))) {
    throw error('LEARNING_PROMOTION_SCOPE_INVALID', 'L2 只能从所有者/客户组合聚合作用域晋升到 Persona/全局作用域。', 409);
  }
}
function sameIdSet(left = [], right = []) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}


function routeLearningEligibility(input = {}) {
  const receipt = input.qualityRouteReceipt && typeof input.qualityRouteReceipt === 'object' ? input.qualityRouteReceipt : {};
  const personaTruthReceipt = input.personaTruthReceipt && typeof input.personaTruthReceipt === 'object' ? input.personaTruthReceipt : {};
  const emergencyMode = input.emergencyMode === true || receipt.emergencyMode === true;
  const qualityTier = clean(receipt.qualityTier || input.qualityTier);
  if (emergencyMode) return { eligible: false, emergencyMode: true, reason: 'EMERGENCY_RESULT_NOT_LEARNING_ELIGIBLE', qualityTier };
  const truthReceiptPresent = Object.keys(personaTruthReceipt).length > 0;
  if ((input.personaTruthRequired === true && !truthReceiptPresent) || (truthReceiptPresent && personaTruthReceipt.pass !== true)) {
    return {
      eligible: false,
      emergencyMode: false,
      reason: 'PERSONA_TRUTH_RECEIPT_NOT_LEARNING_ELIGIBLE',
      qualityTier,
      personaTruthReceiptPresent: truthReceiptPresent,
      personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
    };
  }
  if (input.provisional === true) {
    return {
      eligible: false,
      emergencyMode: false,
      reason: 'PENDING_SUCCESSFUL_SEND',
      qualityTier,
      personaTruthReceiptPresent: truthReceiptPresent,
      personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
    };
  }
  if (input.learningEligible === false || receipt.learningEligible === false) return { eligible: false, emergencyMode: false, reason: 'ROUTE_OR_USER_DISABLED_LEARNING', qualityTier };
  try {
    const verified = aiQualityRouteAuthority.verifyRouteReceipt(receipt, { task: clean(receipt.task) || 'quick_reply' });
    return {
      eligible: true,
      emergencyMode: false,
      reason: '',
      qualityTier: verified.qualityTier,
      verified,
      personaTruthReceiptPresent: truthReceiptPresent,
      personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
    };
  } catch (cause) {
    return {
      eligible: false,
      emergencyMode: false,
      reason: 'UNVERIFIED_QUALITY_ROUTE_NOT_LEARNING_ELIGIBLE',
      qualityTier,
      verificationError: clean(cause.code || cause.message),
      personaTruthReceiptPresent: truthReceiptPresent,
      personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
    };
  }
}

function profileEvidenceIncludes(profile, signalId) {
  return Array.isArray(profile?.evidence_signal_ids) && profile.evidence_signal_ids.map(clean).includes(clean(signalId));
}

class LearningPreferenceAuthority {
  constructor(options = {}) { this.repository = options.repository || defaultRepository; }

  recordSignal(input = {}) {
    const signalType = boundedText(input.signalType, 'signalType', 64, /^[a-z0-9_-]+$/i);
    if (!SIGNAL_TYPES.has(signalType)) throw error('LEARNING_SIGNAL_TYPE_INVALID', '不支持的学习信号类型。');
    const scopeType = boundedText(input.scopeType, 'scopeType', 64, /^[a-z0-9_-]+$/i) || 'conversation';
    const scopeId = boundedText(input.scopeId || input.conversationId || input.contactId, 'scopeId', 1024);
    if (!scopeId) throw error('LEARNING_SIGNAL_SCOPE_REQUIRED', '学习信号必须绑定作用域。');
    const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 2048) || stableId('learning-signal-idem', [scopeType, scopeId, signalType, input.candidateId, input.outboxId, input.observedAt || now()]);
    const qualityRouteReceipt = sanitizeLearningObject(input.qualityRouteReceipt || {}, 'qualityRouteReceipt');
    const personaTruthReceipt = sanitizeLearningObject(input.personaTruthReceipt || {}, 'personaTruthReceipt');
    const metadata = sanitizeLearningObject(input.metadata || {}, 'learningSignal.metadata');
    const routeState = routeLearningEligibility({ ...input, qualityRouteReceipt, personaTruthReceipt });
    const emergencyMode = routeState.emergencyMode;
    const learningEligible = routeState.eligible;
    const createdAt = timestamp(input.observedAt);
    const editDistance = Number(input.editDistance || 0);
    if (!Number.isFinite(editDistance) || editDistance < 0 || editDistance > 1000000) throw error('LEARNING_EDIT_DISTANCE_INVALID', '学习编辑距离无效。', 400, { editDistance: input.editDistance });
    const rawSignal = {
      signalType,
      source: boundedText(input.source, 'source', 128, /^[a-z0-9_.:-]+$/i) || 'ui-feedback',
      adjustments: boundedAdjustments(input.adjustments || input.tags),
      originalText: clean(input.originalText),
      finalText: clean(input.finalText || input.text),
      rejectionReason: clean(input.rejectionReason),
      editDistance,
      strategyBranch: clean(input.strategyBranch),
      modelRouteReceipt: qualityRouteReceipt,
      personaTruthReceipt,
      personaTruthReceiptRequired: input.personaTruthRequired === true,
      routeReceiptVerified: Boolean(routeState.verified),
      exclusionReason: routeState.reason,
      routeVerificationError: routeState.verificationError || '',
      metadata
    };
    const signal = sanitizeLearningObject(rawSignal, 'learningSignal');
    const existing = typeof this.repository.getLearningSignalByIdempotency === 'function'
      ? this.repository.getLearningSignalByIdempotency(idempotencyKey)
      : null;
    if (existing) {
      const same = clean(existing.learning_level) === LEVEL.L1
        && clean(existing.scope_type) === scopeType
        && clean(existing.scope_id) === scopeId
        && clean(existing.signal_type) === signalType
        && clean(existing.contact_id) === clean(input.contactId)
        && clean(existing.conversation_id) === clean(input.conversationId)
        && clean(existing.candidate_id) === clean(input.candidateId)
        && clean(existing.outbox_id) === clean(input.outboxId)
        && Number(existing.learning_eligible || 0) === (learningEligible ? 1 : 0)
        && Number(existing.emergency_mode || 0) === (emergencyMode ? 1 : 0)
        && sha256(existing.signal || {}) === sha256(signal);
      if (!same) {
        throw error('LEARNING_SIGNAL_IDEMPOTENCY_CONFLICT', '相同幂等键对应了不同的学习信号，已阻止静默覆盖。', 409, {
          idempotencyKey, existingSignalId: clean(existing.signal_id)
        });
      }
      const storedEligible = Number(existing.learning_eligible || 0) === 1;
      let currentProfile = this.repository.getLatestLearningProfile({ scopeType, scopeId, learningLevel: LEVEL.L1, state: 'active' });
      let profileChanged = false;
      if (storedEligible && !profileEvidenceIncludes(currentProfile, existing.signal_id)) {
        currentProfile = this.repository.transaction(() => this.rebuildL1({ scopeType, scopeId }));
        profileChanged = true;
      }
      return {
        authority: AUTHORITY,
        idempotentReplay: true,
        signal: {
          signalId: existing.signal_id,
          idempotencyKey: existing.idempotency_key,
          learningEligible: storedEligible,
          emergencyMode: Number(existing.emergency_mode || 0) === 1
        },
        profile: publicProfile(currentProfile),
        profileChanged,
        excludedReason: storedEligible ? '' : Number(existing.emergency_mode || 0) === 1
          ? 'EMERGENCY_RESULT_NOT_LEARNING_ELIGIBLE'
          : clean(existing.signal?.exclusionReason) || 'ROUTE_OR_USER_DISABLED_LEARNING'
      };
    }
    const committed = this.repository.transaction(() => {
      const row = this.repository.insertLearningSignal({
        signalId: boundedText(input.signalId, 'signalId', 1024) || stableId('learning-signal', [idempotencyKey]), idempotencyKey,
        learningLevel: LEVEL.L1, scopeType, scopeId, contactId: boundedText(input.contactId, 'contactId', 1024), conversationId: boundedText(input.conversationId, 'conversationId', 1024),
        candidateId: boundedText(input.candidateId, 'candidateId', 1024), outboxId: boundedText(input.outboxId, 'outboxId', 1024), signalType, signal,
        qualityTier: routeState.qualityTier, emergencyMode, learningEligible, createdAt
      });
      const profile = learningEligible ? this.rebuildL1({ scopeType, scopeId }) : this.repository.getLatestLearningProfile({ scopeType, scopeId, learningLevel: LEVEL.L1, state: 'active' });
      return { row, profile };
    });
    const { row, profile } = committed;
    const result = {
      authority: AUTHORITY,
      signal: { signalId: row.signal_id, idempotencyKey: row.idempotency_key, learningEligible: Number(row.learning_eligible || 0) === 1, emergencyMode: Number(row.emergency_mode || 0) === 1 },
      profile: publicProfile(profile),
      profileChanged: learningEligible,
      excludedReason: learningEligible ? '' : routeState.reason
    };
    if (learningEligible) {
      eventBus.publish('learning:signal-recorded', {
        authority: AUTHORITY,
        scopeType, scopeId,
        signalId: row.signal_id,
        signalType,
        contactId: clean(row.contact_id),
        conversationId: clean(row.conversation_id),
        profileVersion: Number(profile?.version || 0),
        observedAt: createdAt
      });
    }
    return result;
  }

  rebuildL1(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const signals = this.repository.listEligibleLearningSignals({ scopeType, scopeId, learningLevel: LEVEL.L1 });
    const axes = {};
    const branchWeights = {};
    let sent = 0;
    let rejected = 0;
    let questionsAccepted = 0;
    let noQuestionsAccepted = 0;
    for (const row of signals) {
      const delta = signalDelta(row);
      for (const [key, value] of Object.entries(delta.axes)) axes[key] = (axes[key] || 0) + value;
      const branch = clean(row.signal?.strategyBranch);
      if (branch) branchWeights[branch] = (branchWeights[branch] || 0) + delta.factor;
      if (row.signal_type === 'candidate_sent') sent += 1;
      if (row.signal_type === 'candidate_rejected') rejected += 1;
      if (delta.factor > 0) {
        if (delta.text.question) questionsAccepted += 1;
        else noQuestionsAccepted += 1;
      }
    }
    const sampleCount = signals.length;
    const preference = {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      axisWeights: Object.fromEntries(Object.entries(axes).map(([key, value]) => [key, clamp(value / Math.max(1, sampleCount), -1, 1)])),
      branchWeights: Object.fromEntries(Object.entries(branchWeights).map(([key, value]) => [key, clamp(value / Math.max(1, sampleCount), -1, 1)])),
      questionPreference: noQuestionsAccepted > questionsAccepted ? 'fewer_questions' : questionsAccepted > noQuestionsAccepted ? 'questions_help' : 'neutral',
      counters: { sampleCount, sent, rejected, questionsAccepted, noQuestionsAccepted },
      updatedBy: 'eligible-non-emergency-signals-only'
    };
    const current = this.repository.getLatestLearningProfile({ scopeType, scopeId, learningLevel: LEVEL.L1 });
    const version = Number(current?.version || 0) + 1;
    const confidence = Math.min(0.95, sampleCount / 20);
    const timestamp = now();
    this.repository.insertLearningProfile({
      scopeType, scopeId, learningLevel: LEVEL.L1, version, preference,
      evidenceSignalIds: signals.map(row => row.signal_id), confidence, state: 'candidate', createdAt: timestamp, activatedAt: ''
    });
    return this.repository.activateLearningProfile({ scopeType, scopeId, learningLevel: LEVEL.L1, version, activatedAt: timestamp });
  }


  eligibleSignalsForSynthesis(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const fromLevel = clean(input.fromLevel);
    const rows = this.repository.listEligibleLearningSignals({ scopeType, scopeId, learningLevel: fromLevel });
    if (fromLevel !== LEVEL.L2) return rows;
    const current = [];
    const grouped = new Map();
    for (const row of rows) {
      const targetScopeType = clean(row.signal?.targetScopeType);
      const targetScopeId = clean(row.signal?.targetScopeId);
      const profileVersion = Number(row.signal?.profileVersion || 0);
      if (!targetScopeType || !targetScopeId || !profileVersion) continue;
      const active = this.repository.getLatestLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: LEVEL.L2, state: 'active' });
      if (!active || Number(active.version || 0) !== profileVersion) continue;
      const key = `${targetScopeType}:${targetScopeId}`;
      const previous = grouped.get(key);
      if (!previous || profileVersion > Number(previous.signal?.profileVersion || 0)) grouped.set(key, row);
    }
    current.push(...grouped.values());
    return current.sort((a, b) => clean(a.created_at).localeCompare(clean(b.created_at)));
  }

  synthesisContext(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const fromLevel = clean(input.fromLevel) || LEVEL.L1;
    const signals = this.eligibleSignalsForSynthesis({ scopeType, scopeId, fromLevel });
    const current = this.repository.getLatestLearningProfile({ scopeType, scopeId, learningLevel: fromLevel, state: 'active' });
    return {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      task: 'learning_synthesis',
      fromLevel,
      toLevel: clean(input.toLevel) || (fromLevel === LEVEL.L1 ? LEVEL.L2 : LEVEL.L3),
      scope: { type: scopeType, id: scopeId },
      currentPreference: current?.preference || {},
      eligibleSignals: signals.map(row => ({
        signalId: row.signal_id, type: row.signal_type, contactId: row.contact_id, conversationId: row.conversation_id,
        signal: row.signal || {}, qualityTier: row.quality_tier, createdAt: row.created_at
      })),
      constraints: {
        emergencySignalsExcluded: true,
        evidenceSignalIdsRequired: true,
        L3RequiresHumanApproval: true,
        L3RequiresCrossContactStability: true
      }
    };
  }

  applySynthesis(input = {}) {
    const fromLevel = clean(input.fromLevel);
    const toLevel = clean(input.toLevel);
    if (![[LEVEL.L1, LEVEL.L2], [LEVEL.L2, LEVEL.L3]].some(pair => pair[0] === fromLevel && pair[1] === toLevel)) {
      throw error('LEARNING_PROMOTION_PATH_INVALID', '学习只能从 L1 晋升到 L2，或从 L2 晋升到 L3。');
    }
    const sourceScopeType = clean(input.sourceScopeType);
    const sourceScopeId = clean(input.sourceScopeId);
    const targetScopeType = clean(input.targetScopeType);
    const targetScopeId = clean(input.targetScopeId);
    const personId = clean(input.personId);
    validatePromotionScopes(fromLevel, toLevel, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId);
    const qualityRouteReceipt = sanitizeLearningObject(input.qualityRouteReceipt || {}, 'qualityRouteReceipt');
    const preference = sanitizeLearningObject(input.preference || {}, 'learningPreference');
    const sourceVersions = sanitizeLearningObject(Array.isArray(input.sourceVersions) ? input.sourceVersions : [], 'learningSourceVersions');
    const actor = boundedText(input.actor, 'actor', 256) || 'system';
    const reason = boundedText(input.reason, 'reason', 2000);
    const aggregationScopeId = boundedText(input.aggregationScopeId || input.ownerScopeId, 'aggregationScopeId', 1024) || 'owner';
    const contactId = boundedText(input.contactId || targetScopeId, 'contactId', 1024);
    aiQualityRouteAuthority.verifyRouteReceipt(qualityRouteReceipt, {
      task: 'learning_synthesis', minimumTier: aiQualityRouteAuthority.QUALITY_TIER.HIGH
    });
    const evidenceSignalIds = unique(input.evidenceSignalIds);
    const confidence = Number(input.confidence);
    const explicitSynthesisKey = clean(input.synthesisId || input.idempotencyKey);
    const requestFingerprint = sha256({
      fromLevel, toLevel, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId,
      evidenceSignalIds: evidenceSignalIds.slice().sort(), preference, confidence, sourceVersions,
      humanApproved: input.humanApproved === true, routeReceiptHash: clean(qualityRouteReceipt.receiptHash),
      actor, reason, aggregationScopeId, contactId, personId
    });
    if (explicitSynthesisKey) {
      const explicitPromotionId = stableId('learning-promotion', [explicitSynthesisKey]);
      const existingPromotion = this.repository.getLearningPromotionAudit?.(explicitPromotionId);
      if (existingPromotion) {
        const recorded = existingPromotion.source_versions || {};
        if (clean(recorded.requestFingerprint) !== requestFingerprint) {
          throw error('LEARNING_PROMOTION_IDEMPOTENCY_CONFLICT', '相同学习晋升幂等键对应了不同请求，已阻止静默复用。', 409, { promotionId: explicitPromotionId });
        }
        const recordedVersion = Number(recorded.targetProfileVersion || 0);
        const profile = recordedVersion
          ? this.repository.getLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: toLevel, version: recordedVersion })
          : null;
        if (!profile) throw error('LEARNING_PROMOTION_REPLAY_TARGET_MISSING', '学习晋升审计存在，但原始目标配置版本缺失，已阻止错误重放。', 409, { promotionId: explicitPromotionId, recordedVersion });
        return {
          authority: AUTHORITY, promotionId: explicitPromotionId, idempotentReplay: true,
          evidenceSnapshotHash: clean(recorded.evidenceSnapshotHash), distinctContacts: Number(recorded.distinctContacts || 0),
          profile: publicProfile(profile)
        };
      }
    }
    const eligibleSignals = this.eligibleSignalsForSynthesis({ scopeType: sourceScopeType, scopeId: sourceScopeId, fromLevel });
    const eligibleIds = eligibleSignals.map(row => clean(row.signal_id)).filter(Boolean);
    if (!evidenceSignalIds.length || !sameIdSet(evidenceSignalIds, eligibleIds)) {
      throw error('LEARNING_SYNTHESIS_EVIDENCE_INVALID', '学习晋升必须引用当前合格信号快照的完整集合，不能删选或伪造证据。', 409, {
        expectedSnapshotHash: sha256(eligibleIds.slice().sort()), actualSnapshotHash: sha256(evidenceSignalIds.slice().sort())
      });
    }
    const sampleCount = fromLevel === LEVEL.L2
      ? eligibleSignals.reduce((total, row) => total + Math.max(1, Array.isArray(row.signal?.evidenceSignalIds) ? row.signal.evidenceSignalIds.length : 0), 0)
      : evidenceSignalIds.length;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw error('LEARNING_PROMOTION_CONFIDENCE_INVALID', '学习晋升置信度必须位于 0 到 1。', 409);
    const minimum = toLevel === LEVEL.L3 ? 25 : 5;
    if (sampleCount < minimum) throw error('LEARNING_PROMOTION_SAMPLE_INSUFFICIENT', `学习晋升至少需要 ${minimum} 条合格信号。`, 409, { sampleCount, minimum });
    const distinctContacts = new Set(eligibleSignals.map(row => clean(row.contact_id || row.signal?.metadata?.contactId)).filter(Boolean)).size;
    if (toLevel === LEVEL.L3) {
      if (input.humanApproved !== true) throw error('L3_HUMAN_APPROVAL_REQUIRED', '全局 Persona 学习必须经过人工确认。', 409);
      if (!actor || !reason) {
        throw error('L3_HUMAN_APPROVAL_AUDIT_REQUIRED', '全局 Persona 学习必须记录审核人和审核原因。', 409);
      }
      if (distinctContacts < 3) throw error('L3_CROSS_CONTACT_EVIDENCE_REQUIRED', '全局 Persona 学习必须在至少三个真实联系人中稳定出现。', 409, { distinctContacts });
      if (confidence < 0.75) throw error('L3_CONFIDENCE_INSUFFICIENT', '全局 Persona 学习置信度不足。', 409);
    }
    const latest = this.repository.getLatestLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: toLevel });
    const version = Number(latest?.version || 0) + 1;
    const timestamp = now();
    const synthesisKey = explicitSynthesisKey || stableId('learning-synthesis', [fromLevel, toLevel, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId, sha256(eligibleIds.slice().sort()), sha256(preference), confidence]);
    const promotionId = stableId('learning-promotion', [synthesisKey]);
    const existingPromotion = this.repository.getLearningPromotionAudit?.(promotionId);
    if (existingPromotion) {
      const recorded = existingPromotion.source_versions || {};
      if (clean(recorded.requestFingerprint) !== requestFingerprint) {
        throw error('LEARNING_PROMOTION_IDEMPOTENCY_CONFLICT', '相同学习晋升幂等键对应了不同请求，已阻止静默复用。', 409, { promotionId });
      }
      const recordedVersion = Number(recorded.targetProfileVersion || 0);
      const profile = recordedVersion
        ? this.repository.getLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: toLevel, version: recordedVersion })
        : null;
      if (!profile) throw error('LEARNING_PROMOTION_REPLAY_TARGET_MISSING', '学习晋升审计存在，但原始目标配置版本缺失，已阻止错误重放。', 409, { promotionId, recordedVersion });
      return { authority: AUTHORITY, promotionId, idempotentReplay: true, evidenceSnapshotHash: clean(recorded.evidenceSnapshotHash), distinctContacts: Number(recorded.distinctContacts || 0), profile: publicProfile(profile) };
    }
    return this.repository.transaction(repo => {
      repo.insertLearningProfile({
        scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: toLevel, version,
        preference, evidenceSignalIds, confidence, state: 'pending-approval', createdAt: timestamp, activatedAt: '', personId
      });
      const profile = repo.activateLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: toLevel, version, activatedAt: timestamp });
      repo.insertLearningPromotionAudit({
        promotionId, fromLevel, toLevel, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId,
        sourceVersions: {
          supplied: sourceVersions,
          evidenceSnapshotHash: sha256(eligibleIds.slice().sort()),
          requestFingerprint,
          distinctContacts,
          targetProfileVersion: version
        }, sampleCount, confidence, decision: 'approved', reason,
        rollbackVersion: Number(latest?.version || 0), actor, createdAt: timestamp
      });
      if (toLevel === LEVEL.L2) {
        repo.insertLearningSignal({
          signalId: stableId('learning-l2-output', [targetScopeType, targetScopeId, version]),
          idempotencyKey: `learning-l2-output:${targetScopeType}:${targetScopeId}:${version}`,
          learningLevel: LEVEL.L2, scopeType: 'owner', scopeId: aggregationScopeId,
          contactId, conversationId: '', candidateId: '', outboxId: '',
          signalType: 'synthesis_promoted',
          signal: { promotionId, targetScopeType, targetScopeId, profileVersion: version, preference, confidence, evidenceSignalIds },
          qualityTier: clean(qualityRouteReceipt.qualityTier), emergencyMode: false, learningEligible: true, createdAt: timestamp
        });
      }
      return { authority: AUTHORITY, promotionId, evidenceSnapshotHash: sha256(eligibleIds.slice().sort()), distinctContacts, profile: publicProfile(profile) };
    });
  }


  createL3Proposal(input = {}) {
    const sourceScopeType = clean(input.sourceScopeType) || 'owner';
    const sourceScopeId = clean(input.sourceScopeId) || 'owner';
    const targetScopeType = clean(input.targetScopeType) || 'persona';
    const targetScopeId = clean(input.targetScopeId) || 'owner';
    validatePromotionScopes(LEVEL.L2, LEVEL.L3, sourceScopeType, sourceScopeId, targetScopeType, targetScopeId);
    const qualityRouteReceipt = sanitizeLearningObject(input.qualityRouteReceipt || {}, 'qualityRouteReceipt');
    aiQualityRouteAuthority.verifyRouteReceipt(qualityRouteReceipt, {
      task: 'learning_synthesis', minimumTier: aiQualityRouteAuthority.QUALITY_TIER.HIGH
    });
    const preference = sanitizeLearningObject(input.preference || {}, 'learningPreference');
    const eligibleSignals = this.eligibleSignalsForSynthesis({ scopeType: sourceScopeType, scopeId: sourceScopeId, fromLevel: LEVEL.L2 });
    const eligibleIds = eligibleSignals.map(row => clean(row.signal_id)).filter(Boolean);
    const evidenceSignalIds = unique(input.evidenceSignalIds);
    if (!evidenceSignalIds.length || !sameIdSet(evidenceSignalIds, eligibleIds)) {
      throw error('LEARNING_SYNTHESIS_EVIDENCE_INVALID', 'L3 自动综合提案必须引用当前合格 L2 信号的完整集合。', 409);
    }
    const sampleCount = eligibleSignals.reduce((total, row) => total + Math.max(1, Array.isArray(row.signal?.evidenceSignalIds) ? row.signal.evidenceSignalIds.length : 0), 0);
    const distinctContacts = new Set(eligibleSignals.map(row => clean(row.contact_id || row.signal?.metadata?.contactId)).filter(Boolean)).size;
    const confidence = Number(input.confidence);
    if (sampleCount < 25) throw error('LEARNING_PROMOTION_SAMPLE_INSUFFICIENT', 'L3 自动综合提案至少需要 25 条底层合格信号。', 409, { sampleCount });
    if (distinctContacts < 3) throw error('L3_CROSS_CONTACT_EVIDENCE_REQUIRED', 'L3 自动综合提案必须覆盖至少三个真实联系人。', 409, { distinctContacts });
    if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) throw error('L3_CONFIDENCE_INSUFFICIENT', 'L3 自动综合提案置信度不足。', 409, { confidence });
    const evidenceSnapshotHash = sha256(eligibleIds.slice().sort());
    const synthesisId = boundedText(input.synthesisId || input.idempotencyKey, 'synthesisId', 2048)
      || stableId('learning-l3-proposal', [sourceScopeType, sourceScopeId, targetScopeType, targetScopeId, evidenceSnapshotHash, sha256(preference)]);
    const promotionId = stableId('learning-promotion', [synthesisId]);
    const existing = this.repository.getLearningPromotionAudit?.(promotionId);
    if (existing) {
      const recorded = existing.source_versions || {};
      const profile = this.repository.getLearningProfile({
        scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: LEVEL.L3,
        version: Number(recorded.targetProfileVersion || 0)
      });
      if (!profile) throw error('LEARNING_PROMOTION_REPLAY_TARGET_MISSING', 'L3 自动综合提案审计存在，但候选配置缺失。', 409, { promotionId });
      return { authority: AUTHORITY, promotionId, idempotentReplay: true, distinctContacts, profile: publicProfile(profile) };
    }
    const latest = this.repository.getLatestLearningProfile({ scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: LEVEL.L3 });
    const version = Number(latest?.version || 0) + 1;
    const timestamp = now();
    return this.repository.transaction(repo => {
      const profile = repo.insertLearningProfile({
        scopeType: targetScopeType, scopeId: targetScopeId, learningLevel: LEVEL.L3, version,
        preference, evidenceSignalIds, confidence, state: 'pending-approval', createdAt: timestamp, activatedAt: ''
      });
      repo.insertLearningPromotionAudit({
        promotionId, fromLevel: LEVEL.L2, toLevel: LEVEL.L3,
        sourceScopeType, sourceScopeId, targetScopeType, targetScopeId,
        sourceVersions: { evidenceSnapshotHash, distinctContacts, targetProfileVersion: version, routeReceiptHash: clean(qualityRouteReceipt.receiptHash) },
        sampleCount, confidence, decision: 'pending-human-approval', reason: boundedText(input.reason, 'reason', 2000) || '系统自动综合，等待人工批准。',
        rollbackVersion: Number(latest?.version || 0), actor: boundedText(input.actor, 'actor', 256) || 'learning-synthesis-scheduler', createdAt: timestamp
      });
      return { authority: AUTHORITY, promotionId, proposed: true, evidenceSnapshotHash, distinctContacts, profile: publicProfile(profile) };
    });
  }

  approveL3Proposal(input = {}) {
    const promotionId = clean(input.promotionId);
    if (!promotionId) throw error('L3_PROPOSAL_ID_REQUIRED', '批准 L3 提案必须指定 promotionId。');
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('L3_HUMAN_APPROVAL_AUDIT_REQUIRED', '批准 L3 提案必须记录审核人和原因。', 409);
    const audit = this.repository.getLearningPromotionAudit?.(promotionId);
    if (!audit || clean(audit.decision) !== 'pending-human-approval') throw error('L3_PROPOSAL_NOT_PENDING', '找不到待批准的 L3 提案。', 404, { promotionId });
    const recorded = audit.source_versions || {};
    const version = Number(recorded.targetProfileVersion || 0);
    const profile = this.repository.getLearningProfile({ scopeType: audit.target_scope_type, scopeId: audit.target_scope_id, learningLevel: LEVEL.L3, version });
    if (!profile || clean(profile.state) !== 'pending-approval') throw error('L3_PROPOSAL_PROFILE_INVALID', 'L3 提案候选配置缺失或状态不正确。', 409, { promotionId, version });
    const timestamp = now();
    return this.repository.transaction(repo => {
      const activated = repo.activateLearningProfile({ scopeType: audit.target_scope_type, scopeId: audit.target_scope_id, learningLevel: LEVEL.L3, version, activatedAt: timestamp });
      repo.updateLearningPromotionAudit(promotionId, { decision: 'approved', reason, actor, createdAt: timestamp });
      return { authority: AUTHORITY, promotionId, approved: true, profile: publicProfile(activated) };
    });
  }

  rejectL3Proposal(input = {}) {
    const promotionId = clean(input.promotionId);
    if (!promotionId) throw error('L3_PROPOSAL_ID_REQUIRED', '拒绝 L3 提案必须指定 promotionId。');
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('L3_HUMAN_REJECTION_AUDIT_REQUIRED', '拒绝 L3 提案必须记录审核人和原因。', 409);
    const audit = this.repository.getLearningPromotionAudit?.(promotionId);
    if (!audit || clean(audit.decision) !== 'pending-human-approval') throw error('L3_PROPOSAL_NOT_PENDING', '找不到待审核的 L3 提案。', 404, { promotionId });
    const recorded = audit.source_versions || {};
    const version = Number(recorded.targetProfileVersion || 0);
    const profile = this.repository.getLearningProfile({ scopeType: audit.target_scope_type, scopeId: audit.target_scope_id, learningLevel: LEVEL.L3, version });
    if (!profile || clean(profile.state) !== 'pending-approval') throw error('L3_PROPOSAL_PROFILE_INVALID', 'L3 提案候选配置缺失或状态不正确。', 409, { promotionId, version });
    const timestamp = now();
    return this.repository.transaction(repo => {
      const rejected = repo.updateLearningProfileState({ scopeType: audit.target_scope_type, scopeId: audit.target_scope_id, learningLevel: LEVEL.L3, version, state: 'rejected', activatedAt: '' });
      repo.updateLearningPromotionAudit(promotionId, { decision: 'rejected', reason, actor, createdAt: timestamp });
      return { authority: AUTHORITY, promotionId, rejected: true, profile: publicProfile(rejected) };
    });
  }

  rollbackProfile(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const learningLevel = clean(input.learningLevel);
    const targetVersion = Number(input.targetVersion);
    if (!Number.isInteger(targetVersion) || targetVersion <= 0) {
      throw error('LEARNING_ROLLBACK_TARGET_REQUIRED', '学习配置回滚必须明确指定有效的目标版本。', 400);
    }
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('LEARNING_ROLLBACK_AUDIT_REQUIRED', '学习配置回滚必须记录操作者和原因。', 409);
    const profiles = this.repository.listLearningProfiles({ scopeType, scopeId, learningLevel });
    const active = profiles.find(row => row.state === 'active');
    const target = profiles.find(row => Number(row.version) === targetVersion);
    if (!active || !target) throw error('LEARNING_ROLLBACK_TARGET_NOT_FOUND', '找不到学习配置回滚目标。', 404);
    if (clean(target.state) === 'forgotten') throw error('LEARNING_ROLLBACK_TARGET_FORGOTTEN', '已永久忘记的学习版本不能通过普通回滚重新激活。', 409);
    if (Number(active.version) === Number(target.version)) throw error('LEARNING_ROLLBACK_TARGET_IS_ACTIVE', '回滚目标已经是当前生效版本。', 409);
    const timestamp = now();
    return this.repository.transaction(repo => {
      repo.updateLearningProfileState({ scopeType, scopeId, learningLevel, version: active.version, state: 'rolled-back', activatedAt: '' });
      const restored = repo.activateLearningProfile({ scopeType, scopeId, learningLevel, version: target.version, activatedAt: timestamp });
      const promotionId = stableId('learning-rollback', [scopeType, scopeId, learningLevel, active.version, target.version, timestamp]);
      repo.insertLearningPromotionAudit({
        promotionId, fromLevel: learningLevel, toLevel: learningLevel,
        sourceScopeType: scopeType, sourceScopeId: scopeId, targetScopeType: scopeType, targetScopeId: scopeId,
        sourceVersions: { rolledBackFrom: Number(active.version), restoredVersion: Number(target.version) },
        sampleCount: 0, confidence: Number(restored?.confidence || 0), decision: 'rolled-back', reason,
        rollbackVersion: Number(active.version), actor, createdAt: timestamp
      });
      return { authority: AUTHORITY, promotionId, rolledBackFrom: Number(active.version), restored: publicProfile(restored) };
    });
  }

  forgetProfile(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const learningLevel = clean(input.learningLevel);
    const profiles = this.repository.listLearningProfiles({ scopeType, scopeId, learningLevel });
    if (!profiles.length) return { authority: AUTHORITY, forgotten: false };
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('LEARNING_FORGET_AUDIT_REQUIRED', '忘记学习配置必须记录操作者和原因。', 409);
    const timestamp = now();
    return this.repository.transaction(repo => {
      const forgottenProfiles = profiles.map(profile => repo.updateLearningProfileState({
        scopeType, scopeId, learningLevel, version: profile.version, state: 'forgotten', activatedAt: ''
      })).filter(Boolean);
      const versions = forgottenProfiles.map(profile => Number(profile.version)).sort((a, b) => a - b);
      const previouslyActive = profiles.find(profile => clean(profile.state) === 'active') || profiles[profiles.length - 1];
      const promotionId = stableId('learning-forget', [scopeType, scopeId, learningLevel, versions.join(','), timestamp]);
      repo.insertLearningPromotionAudit({
        promotionId, fromLevel: learningLevel, toLevel: learningLevel,
        sourceScopeType: scopeType, sourceScopeId: scopeId, targetScopeType: scopeType, targetScopeId: scopeId,
        sourceVersions: { forgottenVersions: versions, activeVersion: Number(previouslyActive?.version || 0) }, sampleCount: 0, confidence: Number(previouslyActive?.confidence || 0),
        decision: 'forgotten', reason, rollbackVersion: Number(previouslyActive?.version || 0), actor, createdAt: timestamp
      });
      return { authority: AUTHORITY, promotionId, forgotten: true, forgottenVersions: versions, profiles: forgottenProfiles.map(publicProfile) };
    });
  }
}

const singleton = new LearningPreferenceAuthority();
module.exports = { AUTHORITY, SCHEMA_VERSION, LEVEL, SIGNAL_TYPES, LearningPreferenceAuthority, singleton, textSignals, signalDelta, sanitizeLearningObject, routeLearningEligibility };
