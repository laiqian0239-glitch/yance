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

  function requireProjectionDependencies() {
    if (!repository || typeof repository.listLearningSignals !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_REPOSITORY_REQUIRED', 'Canonical Learning signal repository is required.');
    }
    if (!dataPolicy || typeof dataPolicy.minimize !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_DATA_POLICY_REQUIRED', 'Learning data minimization policy is required.');
    }
  }

  function isLearningEligible(signal = {}) {
    return signal.learning_eligible === true || signal.learning_eligible === 1;
  }

  function isDoNotLearn(signal = {}) {
    return signal.do_not_learn === true || signal.doNotLearn === true || signal.signal?.doNotLearn === true || signal.signal?.metadata?.doNotLearn === true;
  }

  function hasRawPrivatePersistence(signal = {}) {
    return signal.signal?.metadata?.rawPrivateChatPersisted === true;
  }

  function approvedScoreFor(signalId, approvedScoresBySignalId = {}) {
    const score = approvedScoresBySignalId?.[signalId];
    if (!score || score.authority !== 'Langfuse' || score.approvedByLearning !== true || !String(score.scoreId || '').trim()) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_APPROVED_SCORE_REQUIRED',
        `Learning-approved Langfuse Score evidence is required for signal ${signalId}.`
      );
    }
    return Object.freeze({ ...score });
  }

  function projectOutcome(signal = {}) {
    const signalType = String(signal.signal_type || '').trim();
    const eventType = String(signal.signal?.eventType || '').trim();
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

  function assertRelationshipIsolation(signals, scopeType, scopeId) {
    const mixed = signals.some(signal => signal.scope_type !== scopeType || signal.scope_id !== scopeId);
    if (mixed) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_MIXED_RELATIONSHIP_BATCH',
        'Learning→Deep Training projection may contain exactly one canonical relationship scope.'
      );
    }
  }

  async function project(scope = {}, optionsForProjection = {}) {
    requireProjectionDependencies();
    const scopeType = String(scope.scopeType || '').trim();
    const scopeId = String(scope.scopeId || '').trim();
    const query = { scopeType, scopeId, learningLevel: 'L1', learningEligible: true };
    const listed = await repository.listLearningSignals(query);
    const signals = Array.isArray(listed) ? listed : [];

    if (!optionsForProjection.globalAggregation) assertRelationshipIsolation(signals, scopeType, scopeId);

    const trajectory = [];
    for (const signal of signals) {
      if (!isLearningEligible(signal) || isDoNotLearn(signal) || hasRawPrivatePersistence(signal)) continue;

      const signalId = String(signal.signal_id || '').trim();
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
    return Object.freeze(projection);
  }

  async function projectRelationship(input = {}) {
    return project(input, { globalAggregation: false });
  }

  async function projectGlobal(input = {}) {
    const scopeType = String(input.scopeType || '').trim();
    const scopeId = String(input.scopeId || '').trim();
    const eligibility = input.canonicalGlobalEligibility || {};
    if (
      eligibility.authority !== 'Learning' ||
      eligibility.eligible !== true ||
      eligibility.scopeType !== 'global' ||
      eligibility.scopeId !== scopeId ||
      scopeType !== 'global' ||
      !String(eligibility.evidenceId || '').trim()
    ) {
      throw contractError(
        'LEARNING_DEEP_TRAINING_GLOBAL_ELIGIBILITY_REQUIRED',
        'Global aggregation is denied unless canonical Learning global eligibility is explicit.'
      );
    }
    return project(input, {
      globalAggregation: true,
      globalEligibilityEvidenceId: String(eligibility.evidenceId).trim()
    });
  }

  async function bindExperimentEvidence(input = {}) {
    if (!evidenceAdapter || typeof evidenceAdapter.bindTrainingEvidence !== 'function') {
      throw contractError('LEARNING_DEEP_TRAINING_LANGFUSE_EVIDENCE_REQUIRED', 'Langfuse Dataset/Score evidence adapter is required.');
    }
    const signalId = String(input.signalId || '').trim();
    const datasetName = String(input.datasetName || '').trim();
    const trajectory = input.projection?.trajectory;
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
    if (!String(input.evidence?.id || '').trim()) {
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
    bindExperimentEvidence,
    rollbackPromotion,
    authority: 'Learning read-only Deep Training projection'
  });
}

module.exports = { createLearningDeepTrainingContract };
