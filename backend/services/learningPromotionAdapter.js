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

  async function promote(proposal = {}, input = {}) {
    if (input.approved !== true) throw promotionError('LEARNING_APPROVAL_REQUIRED', 'Explicit approval is required before Promotion.');
    if (proposal.status !== 'READY_FOR_REVIEW') throw promotionError('LEARNING_EVALUATION_INCOMPLETE', 'Regression and Shadow evidence must pass before Promotion.');
    if (!proposal.Regression?.passed || !proposal.Shadow?.passed) throw promotionError('LEARNING_EVIDENCE_REJECTED', 'Regression and Shadow must both pass.');
    if (!openFeature || typeof openFeature.setEvaluationContext !== 'function') {
      throw promotionError('OPENFEATURE_UNAVAILABLE', 'OpenFeature runtime is required for staged rollout.');
    }
    if (!flagd || flagd.mode !== 'in-process-offline') {
      throw promotionError('FLAGD_OFFLINE_PROVIDER_REQUIRED', 'flagd must run in-process/offline for Learning P0.');
    }
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

  return Object.freeze({ promote, authority: 'OpenFeature + flagd; Langfuse evidence' });
}

module.exports = { createLearningPromotionAdapter };
