'use strict';

function promotionError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function createLearningPromotionAdapter(options = {}) {
  const openFeature = options.openFeature || null; // OpenFeature authority.
  const flagd = options.flagd || null; // flagd in-process/offline provider authority.
  const langfuse = options.langfuse || null;

  function requireRolloutAuthority() {
    if (!openFeature || typeof openFeature.setEvaluationContext !== 'function') {
      throw promotionError('OPENFEATURE_UNAVAILABLE', 'OpenFeature runtime is required for staged rollout.');
    }
    if (!flagd || flagd.mode !== 'in-process-offline') {
      throw promotionError('FLAGD_OFFLINE_PROVIDER_REQUIRED', 'flagd must run in-process/offline for Learning P0.');
    }
  }

  async function promote(proposal = {}, input = {}) {
    if (input.approved !== true) throw promotionError('LEARNING_APPROVAL_REQUIRED', 'Explicit approval is required before Promotion.');
    if (proposal.status !== 'READY_FOR_REVIEW') throw promotionError('LEARNING_EVALUATION_INCOMPLETE', 'Regression and Shadow evidence must pass before Promotion.');
    if (!proposal.Regression?.passed || !proposal.Shadow?.passed) throw promotionError('LEARNING_EVIDENCE_REJECTED', 'Regression and Shadow must both pass.');
    requireRolloutAuthority();
    const rollout = Object.freeze({
      kind: 'LEARNING_ROLLOUT',
      candidate: proposal.Candidate,
      approvedAt: new Date().toISOString(),
      OpenFeature: true,
      flagd: 'in-process-offline',
      automaticPromotion: false
    });
    await langfuse?.recordPromotion?.({ proposal, rollout });
    return rollout;
  }

  async function rollback(rollout = {}, input = {}) {
    if (input.approved !== true) {
      throw promotionError('LEARNING_ROLLBACK_APPROVAL_REQUIRED', 'Explicit Learning approval is required before rollback.');
    }
    const evidenceId = String(input.evidence?.id || '').trim();
    if (!evidenceId) {
      throw promotionError('LEARNING_ROLLBACK_EVIDENCE_REQUIRED', 'Explicit rollback evidence is required.');
    }
    if (rollout.kind !== 'LEARNING_ROLLOUT') {
      throw promotionError('LEARNING_ROLLBACK_ROLLOUT_REQUIRED', 'Rollback requires a canonical Learning rollout.');
    }
    const candidateId = String(rollout.candidate?.id || '').trim();
    if (!candidateId) {
      throw promotionError('LEARNING_ROLLBACK_CANDIDATE_REQUIRED', 'Rollback requires the Learning rollout candidate identity.');
    }
    requireRolloutAuthority();
    const receipt = Object.freeze({
      kind: 'LEARNING_ROLLBACK',
      rollout,
      candidate: rollout.candidate,
      evidenceId,
      rolledBackAt: new Date().toISOString(),
      OpenFeature: true,
      flagd: 'in-process-offline',
      automaticPromotion: false
    });
    await langfuse?.recordRollback?.({ rollout, evidence: input.evidence, receipt });
    return receipt;
  }

  return Object.freeze({ promote, rollback, authority: 'OpenFeature + flagd; Langfuse evidence' });
}

module.exports = { createLearningPromotionAdapter };
