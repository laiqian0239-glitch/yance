'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA64 = /^[a-f0-9]{64}$/u;
const PREDICATE_TYPE = 'https://yance.dev/attestations/pvep-verification/v1';
const RECORD_TYPE = 'YANCE_PVEP_ATTESTED_VERIFICATION';
const SUBJECT_VERSION = 'YANCE_PVEP_SUBJECT_V2';
const REQUIRED_PLATFORMS = Object.freeze(['linux', 'windows']);

const REASON_CODES = Object.freeze({
  EVIDENCE_SCHEMA_INVALID: 'EVIDENCE_SCHEMA_INVALID',
  EVIDENCE_BASE_MISMATCH: 'EVIDENCE_BASE_MISMATCH',
  EVIDENCE_HEAD_MISMATCH: 'EVIDENCE_HEAD_MISMATCH',
  EVIDENCE_REQUIREMENT_SET_MISMATCH: 'EVIDENCE_REQUIREMENT_SET_MISMATCH',
  EVIDENCE_ATTESTATION_VERIFICATION_FAILED: 'EVIDENCE_ATTESTATION_VERIFICATION_FAILED',
  EVIDENCE_ATTESTATION_OUTPUT_INVALID: 'EVIDENCE_ATTESTATION_OUTPUT_INVALID',
  EVIDENCE_ATTESTATION_TIMESTAMP_MISSING: 'EVIDENCE_ATTESTATION_TIMESTAMP_MISSING',
  EVIDENCE_ATTESTATION_STATUS_INVALID: 'EVIDENCE_ATTESTATION_STATUS_INVALID',
  EVIDENCE_TRUSTED_SOURCE_CONFLICT: 'EVIDENCE_TRUSTED_SOURCE_CONFLICT'
});

function exactObjectKeys(value, keys) {
  return Boolean(value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()));
}

function failure(reasonCode, details = {}) {
  return Object.freeze({ pass: false, reasonCode, ...details });
}

function validateRequirementSet(value) {
  if (!exactObjectKeys(value, [
    'schemaVersion',
    'requirementSetId',
    'repository',
    'workPackage',
    'predicateType',
    'signerWorkflow',
    'sourceRef',
    'requirements'
  ])
    || value.schemaVersion !== 1
    || value.requirementSetId !== 'pvep-selftest-v1'
    || value.repository !== 'laiqian0239-glitch/yance'
    || value.workPackage !== 'PVEP'
    || value.predicateType !== PREDICATE_TYPE
    || value.signerWorkflow !== 'laiqian0239-glitch/yance/.github/workflows/pvep-attested-evidence.yml'
    || value.sourceRef !== 'refs/heads/main'
    || !Array.isArray(value.requirements)
    || value.requirements.length !== REQUIRED_PLATFORMS.length) return false;

  const byPlatform = new Map();
  for (const requirement of value.requirements) {
    if (!exactObjectKeys(requirement, [
      'gateId', 'platform', 'commandSetPath', 'commandSetSha256'
    ])
      || !REQUIRED_PLATFORMS.includes(requirement.platform)
      || byPlatform.has(requirement.platform)
      || requirement.gateId !== `pvep-${requirement.platform}-selftest`
      || requirement.commandSetPath !== `governance/verification/command-sets/pvep-${requirement.platform}-selftest-v1.json`
      || !SHA64.test(String(requirement.commandSetSha256 || ''))) return false;
    byPlatform.set(requirement.platform, requirement);
  }
  return REQUIRED_PLATFORMS.every(platform => byPlatform.has(platform));
}

function expectedRequirementMap(requirementSet) {
  return new Map(requirementSet.requirements.map(requirement => [requirement.platform, requirement]));
}

function buildSubject(requirementSet, expected) {
  if (!validateRequirementSet(requirementSet)
    || expected?.repository !== requirementSet.repository
    || !SHA40.test(String(expected?.baseCommit || ''))
    || !SHA40.test(String(expected?.headCommit || ''))) {
    throw new TypeError('invalid PVEP subject inputs');
  }
  const byPlatform = expectedRequirementMap(requirementSet);
  return [
    SUBJECT_VERSION,
    `repository=${expected.repository}`,
    `base=${expected.baseCommit}`,
    `head=${expected.headCommit}`,
    ...REQUIRED_PLATFORMS.map(platform => `${platform}CommandSetSha256=${byPlatform.get(platform).commandSetSha256}`),
    ''
  ].join('\n');
}

function buildGhVerificationArgs(subjectPath, requirementSet, expected, options = {}) {
  const args = [
    'attestation', 'verify', subjectPath,
    '--repo', expected.repository,
    '--signer-workflow', requirementSet.signerWorkflow,
    '--signer-digest', expected.baseCommit,
    '--source-digest', expected.baseCommit,
    '--source-ref', requirementSet.sourceRef,
    '--predicate-type', requirementSet.predicateType,
    '--deny-self-hosted-runners',
    '--format', 'json'
  ];
  if (options.bundlePath) args.push('--bundle', options.bundlePath);
  if (options.trustedRootPath) args.push('--custom-trusted-root', options.trustedRootPath);
  return args;
}

function defaultGhRunner({ command, args }) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env
  });
}

function validateAttestedRequirements(actualRequirements, requirementSet) {
  if (!Array.isArray(actualRequirements) || actualRequirements.length !== REQUIRED_PLATFORMS.length) return false;
  const expectedByPlatform = expectedRequirementMap(requirementSet);
  const seen = new Set();
  for (const actual of actualRequirements) {
    if (!exactObjectKeys(actual, [
      'gateId', 'platform', 'commandSetPath', 'commandSetSha256', 'verificationStatus', 'evidenceSource'
    ])
      || !REQUIRED_PLATFORMS.includes(actual.platform)
      || seen.has(actual.platform)) return false;
    seen.add(actual.platform);
    const expected = expectedByPlatform.get(actual.platform);
    if (!expected
      || actual.gateId !== expected.gateId
      || actual.commandSetPath !== expected.commandSetPath
      || actual.commandSetSha256 !== expected.commandSetSha256
      || actual.verificationStatus !== 'VERIFIED_PASS'
      || actual.evidenceSource !== 'github-job-result') return false;
  }
  return REQUIRED_PLATFORMS.every(platform => seen.has(platform));
}

function validateVerifiedEntry(entry, requirementSet, expected) {
  const result = entry?.verificationResult;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return failure(REASON_CODES.EVIDENCE_ATTESTATION_OUTPUT_INVALID);
  }
  if (!Array.isArray(result.verifiedTimestamps) || result.verifiedTimestamps.length === 0) {
    return failure(REASON_CODES.EVIDENCE_ATTESTATION_TIMESTAMP_MISSING);
  }
  const statement = result.statement;
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)
    || statement.predicateType !== requirementSet.predicateType) {
    return failure(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  }
  const predicate = statement.predicate;
  if (!exactObjectKeys(predicate, [
    'schemaVersion',
    'recordType',
    'repository',
    'workPackage',
    'trustedPolicyCommit',
    'baseCommit',
    'headCommit',
    'verificationStatus',
    'requirements'
  ])
    || predicate.schemaVersion !== 1
    || predicate.recordType !== RECORD_TYPE
    || predicate.repository !== expected.repository
    || predicate.workPackage !== requirementSet.workPackage) {
    return failure(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  }
  if (predicate.trustedPolicyCommit !== expected.baseCommit || predicate.baseCommit !== expected.baseCommit) {
    return failure(REASON_CODES.EVIDENCE_BASE_MISMATCH);
  }
  if (predicate.headCommit !== expected.headCommit) {
    return failure(REASON_CODES.EVIDENCE_HEAD_MISMATCH);
  }
  if (predicate.verificationStatus !== 'VERIFIED_PASS') {
    return failure(REASON_CODES.EVIDENCE_ATTESTATION_STATUS_INVALID);
  }
  if (!validateAttestedRequirements(predicate.requirements, requirementSet)) {
    return failure(REASON_CODES.EVIDENCE_REQUIREMENT_SET_MISMATCH);
  }
  const normalizedRequirements = REQUIRED_PLATFORMS.map(platform => (
    predicate.requirements.find(value => value.platform === platform)
  ));
  return Object.freeze({
    pass: true,
    reasonCode: null,
    fact: Object.freeze({
      repository: predicate.repository,
      workPackage: predicate.workPackage,
      baseCommit: predicate.baseCommit,
      headCommit: predicate.headCommit,
      verificationStatus: predicate.verificationStatus,
      requirements: Object.freeze(normalizedRequirements.map(value => Object.freeze({ ...value })))
    })
  });
}

function sameFact(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyGitHubAttestation(options = {}) {
  const requirementSet = options.requirementSet;
  const expected = options.expected;
  if (!validateRequirementSet(requirementSet)
    || expected?.repository !== requirementSet.repository
    || !SHA40.test(String(expected?.baseCommit || ''))
    || !SHA40.test(String(expected?.headCommit || ''))
    || Boolean(options.bundlePath) !== Boolean(options.trustedRootPath)) {
    return failure(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  }

  let root;
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-pvep-attestation-'));
    const subjectPath = path.join(root, 'subject.txt');
    fs.writeFileSync(subjectPath, buildSubject(requirementSet, expected), { encoding: 'utf8', mode: 0o600 });
    const args = buildGhVerificationArgs(subjectPath, requirementSet, expected, options);
    const runner = options.ghRunner || defaultGhRunner;
    let execution;
    try {
      execution = runner({ command: 'gh', args: Object.freeze([...args]) });
    } catch (error) {
      return failure(REASON_CODES.EVIDENCE_ATTESTATION_VERIFICATION_FAILED, { message: String(error?.message || error) });
    }
    if (!execution || execution.error || execution.signal || execution.status !== 0) {
      return failure(REASON_CODES.EVIDENCE_ATTESTATION_VERIFICATION_FAILED, {
        message: String(execution?.stderr || execution?.error?.message || 'gh attestation verify failed')
      });
    }

    let entries;
    try {
      entries = JSON.parse(String(execution.stdout || ''));
    } catch (_) {
      return failure(REASON_CODES.EVIDENCE_ATTESTATION_OUTPUT_INVALID);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return failure(REASON_CODES.EVIDENCE_ATTESTATION_OUTPUT_INVALID);
    }

    const validated = entries.map(entry => validateVerifiedEntry(entry, requirementSet, expected));
    if (entries.length > 1 && validated.some(result => !result.pass)) {
      return failure(REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT);
    }
    const rejected = validated.find(result => !result.pass);
    if (rejected) return rejected;
    const fact = validated[0].fact;
    if (!validated.every(result => sameFact(result.fact, fact))) {
      return failure(REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT);
    }
    return Object.freeze({ pass: true, reasonCode: null, fact });
  } catch (error) {
    return failure(REASON_CODES.EVIDENCE_ATTESTATION_VERIFICATION_FAILED, { message: String(error?.message || error) });
  } finally {
    if (root) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

module.exports = {
  PREDICATE_TYPE,
  RECORD_TYPE,
  SUBJECT_VERSION,
  REASON_CODES,
  validateRequirementSet,
  buildSubject,
  buildGhVerificationArgs,
  verifyGitHubAttestation
};
