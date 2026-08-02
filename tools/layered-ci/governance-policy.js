'use strict';

const REQUIRED_LIFECYCLE_STATES = Object.freeze([
  'SPEC_DRAFT',
  'SPEC_REVIEWED',
  'RED_LOCKED',
  'IMPLEMENTING',
  'GREEN_PROVISIONAL',
  'INDEPENDENT_REVIEW',
  'CLOSED',
  'POST_CLOSURE_DEFECT',
  'REOPENED_INVALID_EVIDENCE'
]);
const REQUIRED_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3']);

function verdict(values = {}) {
  return Object.freeze({
    pass: false,
    reasonCode: 'GOVERNANCE_POLICY_INVALID',
    readyForPromotion: false,
    ...values,
    readyForPromotion: false
  });
}

function fail(reasonCode, details = {}) {
  return verdict({ reasonCode, ...details });
}

function exactStringArray(values, pattern = /^[A-Za-z][A-Za-z0-9_]*$/u) {
  return Array.isArray(values)
    && values.every(value => typeof value === 'string' && pattern.test(value))
    && new Set(values).size === values.length;
}

function normalizeRepositoryPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  if (/[*?[\]]/u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function normalizeRule(value) {
  const raw = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//u.test(raw) || /[*?[\]]/u.test(raw)) return '';
  const withoutTrailing = raw.replace(/\/$/u, '');
  const segments = withoutTrailing.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return raw;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLifecyclePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return fail('TASK_LIFECYCLE_POLICY_INVALID');
  if (policy.schemaVersion !== 1 || policy.documentType !== 'YANCE_LAYERED_TASK_LIFECYCLE') {
    return fail('TASK_LIFECYCLE_SCHEMA_INVALID');
  }
  if (!exactStringArray(policy.states) || !sameArray(policy.states, REQUIRED_LIFECYCLE_STATES)) {
    return fail('TASK_LIFECYCLE_STATES_INVALID');
  }
  if (!Array.isArray(policy.transitions) || policy.transitions.length === 0) {
    return fail('TASK_LIFECYCLE_TRANSITIONS_INVALID');
  }
  const seen = new Set();
  for (const transition of policy.transitions) {
    if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
      return fail('TASK_LIFECYCLE_TRANSITION_INVALID');
    }
    if (!policy.states.includes(transition.from) || !policy.states.includes(transition.to)) {
      return fail('TASK_LIFECYCLE_TRANSITION_STATE_INVALID');
    }
    if (!exactStringArray(transition.requires, /^[a-z][A-Za-z0-9]*$/u)) {
      return fail('TASK_LIFECYCLE_REQUIREMENTS_INVALID');
    }
    const key = `${transition.from}->${transition.to}`;
    if (seen.has(key)) return fail('TASK_LIFECYCLE_TRANSITION_DUPLICATE');
    seen.add(key);
  }
  if (seen.has('GREEN_PROVISIONAL->CLOSED')) return fail('TASK_PROVISIONAL_CLOSE_FORBIDDEN');
  const closure = policy.transitions.find(item => item.from === 'INDEPENDENT_REVIEW' && item.to === 'CLOSED');
  const closureRequirements = ['candidateShaFrozen', 'independentReviewPassed', 'l2EvidencePassed'];
  if (!closure || !sameArray([...closure.requires].sort(), closureRequirements)) {
    return fail('TASK_CLOSURE_REQUIREMENTS_INVALID');
  }
  if (!exactStringArray(policy.reopenAllowedReasonCodes)) return fail('TASK_REOPEN_REASONS_INVALID');
  if (policy.greenProvisionalIsClosed !== false || policy.independentReviewBeforeClosed !== true) {
    return fail('TASK_CLOSURE_ORDER_INVALID');
  }
  if (policy.readyForPromotion !== false) return fail('TASK_PROMOTION_MUST_REMAIN_FALSE');
  return verdict({ pass: true, reasonCode: null });
}

function validateTransition(policy, from, to, context = {}) {
  const validation = validateLifecyclePolicy(policy);
  if (!validation.pass) return validation;
  if (!policy.states.includes(from) || !policy.states.includes(to)) {
    return fail('TASK_TRANSITION_STATE_INVALID', { from, to });
  }
  const transition = policy.transitions.find(item => item.from === from && item.to === to);
  if (!transition) return fail('TASK_TRANSITION_NOT_ALLOWED', { from, to });
  const missingRequirements = transition.requires.filter(requirement => context[requirement] !== true);
  if (missingRequirements.length) {
    return fail('TASK_TRANSITION_REQUIREMENT_MISSING', { from, to, missingRequirements });
  }
  if (
    to === 'REOPENED_INVALID_EVIDENCE'
    && !policy.reopenAllowedReasonCodes.includes(String(context.reopenReasonCode || ''))
  ) {
    return fail('TASK_REOPEN_REASON_INVALID', {
      from,
      to,
      reopenReasonCode: context.reopenReasonCode || null
    });
  }
  return verdict({ pass: true, reasonCode: null, previousState: from, nextState: to });
}

function validateRiskPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return fail('CI_RISK_POLICY_INVALID');
  if (policy.schemaVersion !== 1 || policy.documentType !== 'YANCE_LAYERED_CI_RISK_POLICY') {
    return fail('CI_RISK_SCHEMA_INVALID');
  }
  if (!Array.isArray(policy.levels) || !sameArray(policy.levels, REQUIRED_LEVELS)) {
    return fail('CI_RISK_LEVELS_INVALID');
  }
  if (policy.defaultCodeLevel !== 'L1') return fail('CI_RISK_DEFAULT_LEVEL_INVALID');
  for (const field of ['documentationPrefixes', 'l2ExactPaths', 'l2Prefixes']) {
    if (!Array.isArray(policy[field]) || new Set(policy[field]).size !== policy[field].length) {
      return fail('CI_RISK_RULES_INVALID', { field });
    }
    for (const rule of policy[field]) {
      if (!normalizeRule(rule)) return fail('CI_RISK_RULE_INVALID', { field, rule });
    }
  }
  if (policy.l3Automatic !== false || policy.unknownPathFailsClosed !== true) {
    return fail('CI_RISK_FAIL_CLOSED_INVALID');
  }
  if (policy.readyForPromotion !== false) return fail('CI_RISK_PROMOTION_MUST_REMAIN_FALSE');
  return verdict({ pass: true, reasonCode: null });
}

function ruleMatchesPath(rule, file) {
  if (rule.endsWith('/')) return file.startsWith(rule);
  return file === rule || file.startsWith(rule);
}

function documentationRuleMatches(rule, file) {
  if (rule.endsWith('/')) return file.startsWith(rule);
  return file === rule || file.startsWith(rule);
}

function classifyChangedFiles(policy, changedFiles = []) {
  const validation = validateRiskPolicy(policy);
  if (!validation.pass) return validation;
  if (!Array.isArray(changedFiles)) return fail('CI_CHANGED_FILES_INVALID');
  const normalized = changedFiles.map(normalizeRepositoryPath);
  const invalidIndex = normalized.findIndex(value => !value);
  if (invalidIndex >= 0) {
    return fail('CI_CHANGED_PATH_INVALID', { path: changedFiles[invalidIndex] });
  }
  const files = [...new Set(normalized)].sort();
  if (files.length === 0) {
    return verdict({
      pass: true,
      reasonCode: null,
      requiredLevel: 'L0',
      promotionRequired: false,
      changedFiles: [],
      reasons: ['NO_CHANGED_FILES']
    });
  }

  const l2Reasons = [];
  for (const file of files) {
    if (policy.l2ExactPaths.includes(file)) {
      l2Reasons.push({ file, rule: file, type: 'EXACT' });
      continue;
    }
    const matchedPrefix = policy.l2Prefixes.find(rule => ruleMatchesPath(rule, file));
    if (matchedPrefix) l2Reasons.push({ file, rule: matchedPrefix, type: 'PREFIX' });
  }
  if (l2Reasons.length) {
    return verdict({
      pass: true,
      reasonCode: null,
      requiredLevel: 'L2',
      promotionRequired: false,
      changedFiles: files,
      reasons: l2Reasons
    });
  }

  const documentationOnly = files.every(file =>
    policy.documentationPrefixes.some(rule => documentationRuleMatches(rule, file))
  );
  return verdict({
    pass: true,
    reasonCode: null,
    requiredLevel: documentationOnly ? 'L0' : policy.defaultCodeLevel,
    promotionRequired: false,
    changedFiles: files,
    reasons: [documentationOnly ? 'DOCUMENTATION_ONLY' : 'DEFAULT_CODE_LEVEL']
  });
}

module.exports = {
  REQUIRED_LEVELS,
  REQUIRED_LIFECYCLE_STATES,
  classifyChangedFiles,
  normalizeRepositoryPath,
  validateLifecyclePolicy,
  validateRiskPolicy,
  validateTransition
};
