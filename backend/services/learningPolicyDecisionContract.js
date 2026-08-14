'use strict';

const { canonicalHash } = require('./canonicalSerialization');
const personContextAuthority = require('./personContextAuthority').singleton;

const AUTHORITY = 'LearningPolicyDecisionContract';
const ACTION_ENCODING_VERSION = 'candidate-strategy-branch-v1';
const ALLOWED_ACTIONS = Object.freeze([
  'natural_hook',
  'playful_attraction',
  'direct_advance',
  'screen_and_advance',
  'leave_aftertaste'
]);
const FEATURE_SCHEMA = Object.freeze([
  'interactionBand',
  'performanceMode',
  'questionPolicy',
  'relationshipStage',
  'targetLanguage'
]);
const PRIVATE_FEATURE_PATTERN = /(raw|chat|message|body|text|memory|name|email|phone|address|credential|api[_-]?key|secret|token|prompt)/iu;
const SAFE_ENUM_TOKEN = /^[\p{L}\p{N}_-]{1,64}$/u;

function clean(value) { return String(value == null ? '' : value).trim(); }
function policyError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message || reasonCode), { reasonCode, code: reasonCode, ...details });
}
function unique(values = []) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeFeatureBundle(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw policyError('LEARNING_POLICY_FEATURE_BUNDLE_INVALID', 'Learned Policy featureBundle must be a plain object.');
  }
  const keys = Object.keys(input);
  for (const key of keys) {
    if (PRIVATE_FEATURE_PATTERN.test(key)) {
      throw policyError(
        'LEARNING_POLICY_FEATURE_BUNDLE_PRIVATE_BODY_FORBIDDEN',
        `Private/free-form feature field ${key} is forbidden.`
      );
    }
    if (!FEATURE_SCHEMA.includes(key)) {
      throw policyError('LEARNING_POLICY_FEATURE_BUNDLE_FIELD_FORBIDDEN', `Feature field ${key} is outside the fixed P1 schema.`);
    }
  }
  const output = {};
  for (const key of FEATURE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (typeof value === 'boolean') output[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else {
      const token = clean(value);
      if (!SAFE_ENUM_TOKEN.test(token)) {
        throw policyError('LEARNING_POLICY_FEATURE_BUNDLE_VALUE_INVALID', `Feature ${key} must be a bounded enum/numeric/boolean value.`);
      }
      output[key] = token;
    }
  }
  return deepFreeze(output);
}

function normalizeGeneration(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  for (const key of ['modelBrainExecutionId', 'candidatePlanId', 'directorStrategyId', 'contextVersion', 'conversationRevision']) {
    if (source[key] == null || source[key] === '') continue;
    if (['contextVersion', 'conversationRevision'].includes(key)) {
      const numeric = Number(source[key]);
      if (Number.isFinite(numeric)) output[key] = numeric;
    } else {
      const token = clean(source[key]);
      if (token) output[key] = token.slice(0, 256);
    }
  }
  return deepFreeze(output);
}

function createLearningPolicyDecisionContract(options = {}) {
  const identityAuthority = options.personContextAuthority || personContextAuthority;
  if (!identityAuthority || typeof identityAuthority.resolve !== 'function') {
    throw new TypeError('personContextAuthority.resolve is required');
  }

  function createDecisionRecord(input = {}) {
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    const personaProfileId = clean(input.personaProfileId);
    if (!contactId || !conversationId || !personaProfileId) {
      throw policyError('LEARNING_POLICY_DECISION_SCOPE_REQUIRED', 'contactId, conversationId and personaProfileId are required.');
    }

    const resolved = identityAuthority.resolve({ contactId, conversationId });
    const personId = clean(resolved?.personId);
    const contactIds = unique(resolved?.contactIds);
    const conversationIds = unique(resolved?.conversationIds);
    const expectedPersonId = clean(input.expectedPersonId);
    if (
      resolved?.authority !== 'PersonContextAuthority' || resolved?.found !== true || !personId ||
      !contactIds.includes(contactId) || !conversationIds.includes(conversationId) ||
      (expectedPersonId && expectedPersonId !== personId)
    ) {
      throw policyError(
        'LEARNING_POLICY_IDENTITY_BINDING_MISMATCH',
        'Learned Policy decision identity must resolve to one canonical Person/Contact/Conversation binding.',
        { contactId, conversationId, resolvedPersonId: personId, expectedPersonId }
      );
    }

    const featureBundle = normalizeFeatureBundle(input.featureBundle || {});
    const candidateStrategyBranch = clean(input.candidateStrategyBranch);
    if (!ALLOWED_ACTIONS.includes(candidateStrategyBranch)) {
      throw policyError('LEARNING_POLICY_ACTION_NOT_ALLOWED', 'candidateStrategyBranch is outside the exact P1 action set.', { candidateStrategyBranch });
    }
    const behaviorPolicyVersion = clean(input.behaviorPolicyVersion || input.policyVersion) || 'vw-p1-baseline-v1';
    const policyVersion = clean(input.policyVersion) || behaviorPolicyVersion;
    const policyArtifactId = clean(input.policyArtifactId) || 'baseline';
    const generation = normalizeGeneration(input.generation);
    const contributingPolicyVersions = deepFreeze({
      relationship: clean(input.contributingPolicyVersions?.relationship) || 'relationship-current-v1',
      memory: clean(input.contributingPolicyVersions?.memory) || 'memory-current-v1',
      strategy: clean(input.contributingPolicyVersions?.strategy) || 'director-strategy-current-v1',
      candidateRanker: clean(input.contributingPolicyVersions?.candidateRanker) || ACTION_ENCODING_VERSION,
      routing: clean(input.contributingPolicyVersions?.routing) || 'model-brain-routing-current-v1',
      promptProgram: clean(input.contributingPolicyVersions?.promptProgram) || 'context-aware-reply-current-v1',
      behaviorPolicy: behaviorPolicyVersion
    });
    const stateSnapshotRef = canonicalHash({
      personId, contactId, conversationId, personaProfileId, featureBundle,
      generation, contributingPolicyVersions
    });
    const featureSchemaRef = canonicalHash({ schemaVersion: 1, fields: FEATURE_SCHEMA });
    const contextCandidateSetRef = canonicalHash({
      candidatePlanId: generation.candidatePlanId || '',
      directorStrategyId: generation.directorStrategyId || '',
      actions: ALLOWED_ACTIONS
    });
    const actionSetRef = canonicalHash({ encoding: ACTION_ENCODING_VERSION, actions: ALLOWED_ACTIONS });
    const actionId = `candidateStrategyBranch:${candidateStrategyBranch}`;
    const recordCore = {
      schemaVersion: 1,
      authority: AUTHORITY,
      scopeType: 'conversation',
      scopeId: conversationId,
      contactId,
      conversationId,
      personId,
      contactIds,
      conversationIds,
      personaProfileId,
      featureBundle,
      stateSnapshotRef,
      featureSchemaRef,
      contextCandidateSetRef,
      actionId,
      actionEncodingVersion: ACTION_ENCODING_VERSION,
      allowedActionSet: ALLOWED_ACTIONS,
      actionSetRef,
      chosenAction: { kind: 'candidateStrategyBranch', value: candidateStrategyBranch },
      candidateStrategyBranch,
      behaviorPolicyVersion,
      policyVersion,
      policyArtifactId,
      actionProbability: 1,
      exploration: false,
      generation,
      contributingPolicyVersions,
      rawPrivateChatPersisted: false
    };
    const decisionId = `decision:${canonicalHash(recordCore)}`;
    return deepFreeze({ ...recordCore, decisionId });
  }

  return Object.freeze({
    authority: AUTHORITY,
    allowedActions: ALLOWED_ACTIONS,
    featureSchema: FEATURE_SCHEMA,
    createDecisionRecord
  });
}

module.exports = {
  AUTHORITY,
  ACTION_ENCODING_VERSION,
  ALLOWED_ACTIONS,
  FEATURE_SCHEMA,
  createLearningPolicyDecisionContract,
  normalizeFeatureBundle
};
