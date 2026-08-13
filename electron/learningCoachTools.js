'use strict';

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'propose_persona_change', proposalKind: 'PERSONA_CHANGE', description: 'Propose a Persona-authority change for explicit review; never mutate Persona directly.' }),
  Object.freeze({ name: 'propose_relationship_policy_change', proposalKind: 'RELATIONSHIP_POLICY_CHANGE', description: 'Propose a relationship-policy change for explicit review; never mutate relationship authority directly.' }),
  Object.freeze({ name: 'propose_regression_case', proposalKind: 'REGRESSION_CASE', description: 'Propose a regression/evaluation case backed by Learning evidence.' }),
  Object.freeze({ name: 'propose_prompt_program_change', proposalKind: 'PROMPT_PROGRAM_CHANGE', description: 'Propose a prompt/program candidate for regression and shadow evaluation.' }),
  Object.freeze({ name: 'propose_tomorrow_journey', proposalKind: 'TOMORROW_JOURNEY', description: 'Propose a Parlant-owned tomorrow Journey/Goal adjustment for explicit review.' })
]);

function coachError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function normalizeEvidence(input) {
  const evidence = input && typeof input.evidence === 'object' ? input.evidence : {};
  return Object.freeze({
    source: String(evidence.source || 'Learning Coach').trim(),
    evidenceId: String(evidence.evidenceId || '').trim(),
    summary: String(evidence.summary || '').trim(),
    confidence: Number.isFinite(Number(evidence.confidence)) ? Number(evidence.confidence) : null
  });
}

function buildProposal(definition, input = {}) {
  const title = String(input.title || '').trim();
  const hypothesis = String(input.hypothesis || input.reason || '').trim();
  const candidate = input.candidate && typeof input.candidate === 'object' ? { ...input.candidate } : {};
  if (!title) throw coachError('LEARNING_COACH_TITLE_REQUIRED', `${definition.name} requires a proposal title.`);
  if (!hypothesis) throw coachError('LEARNING_COACH_HYPOTHESIS_REQUIRED', `${definition.name} requires a hypothesis/reason.`);
  return Object.freeze({
    kind: 'LEARNING_PROPOSAL',
    proposalKind: definition.proposalKind,
    toolName: definition.name,
    title,
    hypothesis,
    candidate: Object.freeze(candidate),
    evidence: normalizeEvidence(input),
    approvalRequired: true,
    mutationApplied: false,
    requestedAt: new Date().toISOString()
  });
}

function createLearningCoachTools(options = {}) {
  const submitProposal = typeof options.submitProposal === 'function' ? options.submitProposal : async proposal => proposal;
  const tools = {};
  for (const definition of TOOL_DEFINITIONS) {
    tools[definition.name] = Object.freeze({
      name: definition.name,
      description: definition.description,
      async invoke(input = {}) {
        const proposal = buildProposal(definition, input);
        const submitted = await submitProposal(proposal);
        return Object.freeze({
          proposal: submitted || proposal,
          approvalRequired: true,
          mutationApplied: false
        });
      }
    });
  }
  return Object.freeze(tools);
}

function learningCoachToolDescriptors() {
  return TOOL_DEFINITIONS.map(definition => Object.freeze({ ...definition }));
}

module.exports = {
  TOOL_DEFINITIONS,
  buildProposal,
  createLearningCoachTools,
  learningCoachToolDescriptors
};
