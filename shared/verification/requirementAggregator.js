'use strict';

const { REASON_CODES } = require('./reasonCodes');

const HASH_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;
const FACT_KEYS = Object.freeze([
  'repository', 'workPackage', 'gateId', 'baseCommit', 'headCommit', 'platform',
  'commandSetId', 'commandSetDigest', 'verificationStatus', 'adapterType',
  'receiptSha256', 'producerIdentity'
]);
const REQUIREMENT_KEYS = Object.freeze(['gateId', 'platform', 'commandSetDigest']);

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validRequirement(requirement) {
  return exactKeys(requirement, REQUIREMENT_KEYS) &&
    typeof requirement.gateId === 'string' && requirement.gateId.length > 0 &&
    ['linux', 'windows'].includes(requirement.platform) &&
    HASH_RE.test(requirement.commandSetDigest || '');
}
function validFact(fact) {
  return exactKeys(fact, FACT_KEYS) &&
    typeof fact.repository === 'string' && /^[^/]+\/[^/]+$/u.test(fact.repository) &&
    typeof fact.workPackage === 'string' && fact.workPackage.length > 0 &&
    typeof fact.gateId === 'string' && fact.gateId.length > 0 &&
    COMMIT_RE.test(fact.baseCommit || '') && COMMIT_RE.test(fact.headCommit || '') &&
    ['linux', 'windows'].includes(fact.platform) &&
    typeof fact.commandSetId === 'string' && fact.commandSetId.length > 0 &&
    HASH_RE.test(fact.commandSetDigest || '') &&
    ['VERIFIED_PASS', 'VERIFIED_FAIL'].includes(fact.verificationStatus) &&
    ['github-actions-v1', 'signed-executor-v1'].includes(fact.adapterType) &&
    HASH_RE.test(fact.receiptSha256 || '') &&
    typeof fact.producerIdentity === 'string' && fact.producerIdentity.length > 0;
}
function semanticKey(fact) {
  return [fact.repository, fact.workPackage, fact.gateId, fact.baseCommit, fact.headCommit, fact.platform, fact.commandSetDigest].join('\u0000');
}
function requirementKey(requirement) {
  return [requirement.gateId, requirement.platform, requirement.commandSetDigest].join('\u0000');
}

function aggregateRequirementSet({ requirements, facts, expectedBaseCommit, expectedHeadCommit }) {
  if (!Array.isArray(requirements) || requirements.length === 0 || requirements.some((requirement) => !validRequirement(requirement))) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (!Array.isArray(facts) || facts.some((fact) => !validFact(fact))) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (!COMMIT_RE.test(expectedBaseCommit || '') || !COMMIT_RE.test(expectedHeadCommit || '')) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);

  const requirementIds = new Set();
  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    if (requirementIds.has(key)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID, { duplicateRequirement: key });
    requirementIds.add(key);
  }

  const receiptIds = new Set();
  for (const fact of facts) {
    if (fact.baseCommit !== expectedBaseCommit || fact.headCommit !== expectedHeadCommit) return fail(REASON_CODES.EVIDENCE_MIXED_HEADS);
    if (receiptIds.has(fact.receiptSha256)) return fail(REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT, { duplicateReceipt: fact.receiptSha256 });
    receiptIds.add(fact.receiptSha256);
  }

  const repositories = new Set(facts.map((fact) => fact.repository));
  const workPackages = new Set(facts.map((fact) => fact.workPackage));
  if (repositories.size > 1 || workPackages.size > 1) return fail(REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT, { stage: 'scope' });

  const groups = new Map();
  for (const fact of facts) {
    const key = semanticKey(fact);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }
  for (const group of groups.values()) {
    const statuses = new Set(group.map((fact) => fact.verificationStatus));
    if (statuses.size > 1) return fail(REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT, { stage: 'status' });
  }

  const matchedFacts = [];
  for (const requirement of requirements) {
    const matches = facts.filter((fact) =>
      fact.gateId === requirement.gateId &&
      fact.platform === requirement.platform &&
      fact.commandSetDigest === requirement.commandSetDigest &&
      fact.verificationStatus === 'VERIFIED_PASS'
    );
    if (matches.length === 0) return fail(REASON_CODES.EVIDENCE_REQUIREMENT_SET_INCOMPLETE, { requirement });
    matchedFacts.push(...matches);
  }
  return { pass: true, matchedFacts };
}

module.exports = { aggregateRequirementSet };
