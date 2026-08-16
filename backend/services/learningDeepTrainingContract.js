'use strict';

function contractError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function createLearningDeepTrainingContract(options = {}) {
  const repository = options.repository || null;
  const dataPolicy = options.dataPolicy || null;
  const evidenceAdapter = options.evidenceAdapter || null;
  const promotionAdapter = options.promotionAdapter || null;
  const issuedProjections = new WeakSet();

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function requireProjectionDependencies() {
    if (!repository || typeof repository.listLearningSignals !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_REPOSITORY_REQUIRED', 'Canonical Learning signal repository is required.');
    }
    if (!dataPolicy || typeof dataPolicy.minimize !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_DATA_POLICY_REQUIRED', 'Learning data minimization policy is required.');
    }
  }

  function isLearningEligible(signal = {}) {
    return signal.learning_eligible === true || signal.learning_eligible === 1 || signal.learningEligible === true;
  }

  function isDoNotLearn(signal = {}) {
    return signal.do_not_learn === true || signal.doNotLearn === true || signal.signal?.doNotLearn === true || signal.signal?.metadata?.doNotLearn === true;
  }

  function hasRawPrivatePersistence(signal = {}) {
    return signal.signal?.metadata?.rawPrivateChatPersisted === true || signal.signal?.rawPrivateChatPersisted === true;
  }

  function hasValidScoreSubject(score = {}) {
    const traceId = clean(score.traceId);
    const sessionId = clean(score.sessionId);
    const datasetRunId = clean(score.datasetRunId);
    const observationId = clean(score.observationId);
    const subjectCount = [traceId, sessionId, datasetRunId].filter(Boolean).length;
    return subjectCount === 1 && (!observationId || Boolean(traceId));
  }

  function hasValidScoreValue(score = {}) {
    if (score.value == null) return false;
    return typeof score.value !== 'string' || score.value.trim().length > 0;
  }

  function approvedScoreFor(signalId, approvedScoresBySignalId = {}) {
    const score = approvedScoresBySignalId?.[signalId];
    if (
      !score ||
      score.authority !== 'Langfuse' ||
      score.approvedByLearning !== true ||
      !clean(score.scoreId) ||
      !clean(score.name) ||
      !hasValidScoreValue(score) ||
      !hasValidScoreSubject(score)
    ) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_APPROVED_SCORE_REQUIRED',
        `Learning-approved Langfuse Score evidence with one canonical Langfuse subject is required for signal ${signalId}.`
      );
    }
    return Object.freeze({ ...score });
  }

  function projectOutcome(signal = {}) {
    const signalType = clean(signal.signal_type);
    const eventType = clean(signal.signal?.eventType);
    if (signalType === 'candidate_rejected' || eventType === 'rejected') {
      return Object.freeze({ status: 'rejected', success: false, negativeEvidence: true });
    }
    if (signalType === 'candidate_sent' || eventType === 'sent') {
      return Object.freeze({ status: 'sent', success: null, negativeEvidence: false });
    }
    return Object.freeze({
      status: eventType || signalType || 'unknown',
      success: null,
      negativeEvidence: signal.signal?.negativeEvidence === true
    });
  }

  function assertCanonicalScope(signals, scopeType, scopeId, reasonCode) {
    const mixed = signals.some(signal => signal.scope_type !== scopeType || signal.scope_id !== scopeId);
    if (mixed) {
      throw contractError(reasonCode, 'Learning→Deep Training projection may contain exactly one requested canonical scope.');
    }
  }

  async function project(scope = {}, optionsForProjection = {}) {
    requireProjectionDependencies();
    const scopeType = clean(scope.scopeType);
    const scopeId = clean(scope.scopeId);
    const query = { scopeType, scopeId, learningLevel: 'L1', learningEligible: true };
    const listed = await repository.listLearningSignals(query);
    const signals = Array.isArray(listed) ? listed : [];

    assertCanonicalScope(
      signals,
      scopeType,
      scopeId,
      optionsForProjection.globalAggregation
        ? 'LEARNING_DEEP_TRAINING_GLOBAL_SCOPE_MISMATCH'
        : 'LEARNING_DEEP_TRAINING_MIXED_RELATIONSHIP_BATCH'
    );

    const trajectory = [];
    for (const signal of signals) {
      if (!isLearningEligible(signal) || isDoNotLearn(signal) || hasRawPrivatePersistence(signal)) continue;

      const signalId = clean(signal.signal_id);
      if (!signalId) continue;
      const rawContent = scope.contentBySignalId?.[signalId] ?? '';
      const minimized = await dataPolicy.minimize({
        text: rawContent,
        signalId,
        scopeType,
        scopeId,
        learningEligible: true
      });
      if (!minimized || minimized.allowed !== true) continue;

      const score = approvedScoreFor(signalId, scope.approvedScoresBySignalId);
      trajectory.push(Object.freeze({
        signalId,
        idempotencyKey: signal.idempotency_key,
        scopeType: signal.scope_type,
        scopeId: signal.scope_id,
        contactId: signal.contact_id,
        conversationId: signal.conversation_id,
        candidateId: signal.candidate_id,
        outboxId: signal.outbox_id,
        signalType: signal.signal_type,
        createdAt: signal.created_at,
        content: String(minimized.text ?? minimized.minimizedText ?? ''),
        outcome: projectOutcome(signal),
        score
      }));
    }

    const projection = {
      authority: 'Learning',
      readOnly: true,
      scopeType,
      scopeId,
      learningLevel: 'L1',
      trajectory: Object.freeze(trajectory)
    };
    if (optionsForProjection.globalAggregation) {
      projection.globalAggregation = true;
      projection.globalEligibilityEvidenceId = optionsForProjection.globalEligibilityEvidenceId;
    }
    const frozenProjection = Object.freeze(projection);
    issuedProjections.add(frozenProjection);
    return frozenProjection;
  }

  async function projectRelationship(input = {}) {
    if (clean(input.scopeType) === 'global') {
      throw contractError(
        'LEARNING_DEEP_TRAINING_GLOBAL_ELIGIBILITY_REQUIRED',
        'Global Learning signals may only cross the Deep Training boundary through projectGlobal with canonical eligibility.'
      );
    }
    return project(input, { globalAggregation: false });
  }

  async function projectGlobal(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const eligibility = input.canonicalGlobalEligibility || {};
    if (
      eligibility.authority !== 'Learning' ||
      eligibility.eligible !== true ||
      eligibility.scopeType !== 'global' ||
      eligibility.scopeId !== scopeId ||
      scopeType !== 'global' ||
      !clean(eligibility.evidenceId)
    ) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_GLOBAL_ELIGIBILITY_REQUIRED',
        'Global aggregation is denied unless canonical Learning global eligibility is explicit.'
      );
    }
    return project(input, {
      globalAggregation: true,
      globalEligibilityEvidenceId: clean(eligibility.evidenceId)
    });
  }

  function exactOutcomeIds(rows = []) {
    return [...new Set(rows.flatMap(row => Array.isArray(row.signal?.outcomes) ? row.signal.outcomes : [])
      .map(outcome => clean(outcome?.outcomeId)).filter(Boolean))].sort();
  }

  function hasReplayableDecision(decision = {}) {
    const probability = Number(decision.actionProbability);
    return Boolean(
      clean(decision.decisionId) && clean(decision.candidateStrategyBranch) &&
      decision.featureBundle && typeof decision.featureBundle === 'object' && !Array.isArray(decision.featureBundle) &&
      clean(decision.actionId) && clean(decision.actionSetRef) && clean(decision.actionEncodingVersion) &&
      clean(decision.behaviorPolicyVersion || decision.policyVersion) &&
      Number.isFinite(probability) && probability > 0 && probability <= 1 && decision.exploration !== true
    );
  }

  async function listPolicyOutcomes(decisionIds, scopeType, scopeId) {
    if (typeof repository.listPolicyOutcomeSignals === 'function') {
      const listed = await repository.listPolicyOutcomeSignals({ decisionIds });
      return Array.isArray(listed) ? listed : [];
    }
    const listed = await repository.listLearningSignals({ scopeType, scopeId, learningLevel: 'L1', learningEligible: false });
    return (Array.isArray(listed) ? listed : []).filter(row =>
      clean(row.signal_type || row.signalType) === 'policy_outcome_observed' && decisionIds.includes(clean(row.signal?.decisionId))
    );
  }

  async function projectPolicy(input = {}) {
    requireProjectionDependencies();
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const listed = await repository.listLearningSignals({ scopeType, scopeId, learningLevel: 'L1', learningEligible: true });
    const sources = (Array.isArray(listed) ? listed : []).filter(signal =>
      isLearningEligible(signal) && !isDoNotLearn(signal) && !hasRawPrivatePersistence(signal)
      && clean(signal.signal_type || signal.signalType) === 'candidate_sent'
      && clean(signal.signal?.decisionRecord?.decisionId)
    );
    assertCanonicalScope(sources, scopeType, scopeId, 'LEARNING_POLICY_SOURCE_SCOPE_MISMATCH');
    const decisionIds = sources.map(row => clean(row.signal.decisionRecord.decisionId));
    const rawOutcomes = await listPolicyOutcomes(decisionIds, scopeType, scopeId);
    const trajectory = [];

    for (const source of sources) {
      const sourceSignalId = clean(source.signal_id || source.signalId);
      const decision = source.signal.decisionRecord;
      const decisionId = clean(decision.decisionId);
      const joined = rawOutcomes.filter(row => {
        const raw = row.signal || {};
        const rawFalseEligible = row.learning_eligible === false || row.learning_eligible === 0 || row.learningEligible === false;
        if (!rawFalseEligible || clean(row.signal_type || row.signalType) !== 'policy_outcome_observed') return false;
        if (clean(raw.decisionId) !== decisionId) return false;
        if (clean(raw.sourceSignalId) && clean(raw.sourceSignalId) !== sourceSignalId) return false;
        if (clean(raw.personId) && clean(decision.personId) && clean(raw.personId) !== clean(decision.personId)) return false;
        if (clean(raw.conversationId) && clean(decision.conversationId) && clean(raw.conversationId) !== clean(decision.conversationId)) return false;
        return true;
      });
      const outcomes = Object.freeze(joined.flatMap(row => Array.isArray(row.signal?.outcomes) ? row.signal.outcomes.map(value => Object.freeze({ ...value })) : []));
      const outcomeIds = exactOutcomeIds(joined);
      const score = approvedScoreFor(sourceSignalId, input.approvedScoresBySignalId);
      const scoreSourceId = clean(score.sourceSignalId || score.eligibleSourceSignalId);
      const scoreOutcomeIds = [...new Set((Array.isArray(score.outcomeIds) ? score.outcomeIds : []).map(clean).filter(Boolean))].sort();
      const exactOutcomeSet = outcomeIds.length === scoreOutcomeIds.length && outcomeIds.every((id, index) => id === scoreOutcomeIds[index]);
      if (
        scoreSourceId !== sourceSignalId || clean(score.decisionId) !== decisionId || !exactOutcomeSet ||
        !clean(score.outcomeEvidenceSetRef) || !clean(score.rewardPolicyVersion)
      ) {
        throw contractError('LEARNING_POLICY_SCORE_EVIDENCE_BINDING_REQUIRED', `Score for ${sourceSignalId} must bind exact source/decision/outcome evidence.`);
      }
      const minimized = await dataPolicy.minimize({
        text: clean(input.contentBySignalId?.[sourceSignalId]),
        signalId: sourceSignalId,
        scopeType,
        scopeId,
        learningEligible: true,
        featureBundle: decision.featureBundle
      });
      if (!minimized || minimized.allowed !== true) continue;
      trajectory.push(Object.freeze({
        sourceSignalId,
        signalId: sourceSignalId,
        decisionId,
        decision: Object.freeze({ ...decision }),
        featureBundle: Object.freeze({ ...(decision.featureBundle || {}) }),
        outcomes,
        approvedScore: score,
        score,
        minimizedContent: String(minimized.text ?? minimized.minimizedText ?? ''),
        vwTrainingEligible: hasReplayableDecision(decision)
      }));
    }

    const projection = Object.freeze({
      authority: 'Learning',
      readOnly: true,
      scopeType,
      scopeId,
      learningLevel: 'L1',
      policyProjection: true,
      trajectory: Object.freeze(trajectory)
    });
    issuedProjections.add(projection);
    return projection;
  }

  async function bindExperimentEvidence(input = {}) {
    if (!evidenceAdapter || typeof evidenceAdapter.bindTrainingEvidence !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_LANGFUSE_EVIDENCE_REQUIRED', 'Langfuse Dataset/Score evidence adapter is required.');
    }
    if (!input.projection || typeof input.projection !== 'object' || !issuedProjections.has(input.projection)) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_PROJECTION_PROVENANCE_REQUIRED',
        'Experiment evidence must come from a projection issued by this Learning contract instance.'
      );
    }
    const signalId = clean(input.signalId);
    const datasetName = clean(input.datasetName);
    const trajectory = input.projection.trajectory;
    const record = Array.isArray(trajectory) ? trajectory.find(step => step.signalId === signalId) : null;
    if (!record || !datasetName) {
      throw contractError('LEARNING_DEEP_TRAINING_EXPERIMENT_RECORD_REQUIRED', 'A projected canonical signal and dataset name are required.');
    }
    return evidenceAdapter.bindTrainingEvidence({ datasetName, record });
  }

  async function rollbackPromotion(input = {}) {
    if (input.approved !== true) {
      throw contractError('LEARNING_DEEP_TRAINING_ROLLBACK_APPROVAL_REQUIRED', 'Explicit Learning approval is required for rollback.');
    }
    if (!clean(input.evidence?.id)) {
      throw contractError('LEARNING_DEEP_TRAINING_ROLLBACK_EVIDENCE_REQUIRED', 'Rollback evidence is required.');
    }
    if (!promotionAdapter || typeof promotionAdapter.rollback !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_ROLLBACK_ADAPTER_REQUIRED', 'Learning-owned promotion adapter rollback is required.');
    }
    return promotionAdapter.rollback(input.rollout, { approved: true, evidence: input.evidence });
  }

  return Object.freeze({
    projectRelationship,
    projectGlobal,
    projectPolicy,
    bindExperimentEvidence,
    rollbackPromotion,
    authority: 'Learning read-only Deep Training projection'
  });
}

module.exports = { createLearningDeepTrainingContract };