'use strict';

function proposalError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function createLearningProposalService(options = {}) {
  const evaluation = options.evaluation;
  const evidenceStore = options.evidenceStore || null; // Langfuse projection/store adapter.
  if (!evaluation || typeof evaluation.evaluate !== 'function') throw new TypeError('Learning proposal service requires an evaluation adapter.');

  async function propose(input = {}) {
    const Evidence = Array.isArray(input.Evidence || input.evidence) ? (input.Evidence || input.evidence) : [];
    const Hypothesis = String(input.Hypothesis || input.hypothesis || '').trim();
    const Candidate = input.Candidate || input.candidate;
    if (!Hypothesis) throw proposalError('LEARNING_HYPOTHESIS_REQUIRED', 'Hypothesis is required.');
    if (!Candidate || typeof Candidate !== 'object') throw proposalError('LEARNING_CANDIDATE_REQUIRED', 'Candidate is required.');
    if (Evidence.length < 1) return Object.freeze({ status: 'DATA_INSUFFICIENT', Evidence, Hypothesis, Candidate, approvalRequired: true });

    const evaluationResult = await evaluation.evaluate(Candidate, Evidence);
    const proposal = Object.freeze({
      kind: 'LEARNING_PROPOSAL',
      Evidence,
      Hypothesis,
      Candidate: Object.freeze({ ...Candidate }),
      Regression: evaluationResult.Regression || null,
      Shadow: evaluationResult.Shadow || null,
      status: evaluationResult.status,
      approvalRequired: true,
      promotionApplied: false
    });
    await evidenceStore?.recordProposal?.(proposal); // Langfuse-backed when configured.
    return proposal;
  }

  return Object.freeze({ propose, authority: 'Evidence → Hypothesis → Candidate → Regression → Shadow' });
}

module.exports = { createLearningProposalService };
