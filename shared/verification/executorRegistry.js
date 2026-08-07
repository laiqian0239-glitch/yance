'use strict';

const crypto = require('node:crypto');
const { REASON_CODES } = require('./reasonCodes');

const HASH_RE = /^[0-9a-f]{64}$/u;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/u;

function ok(executor) { return { pass: true, executor }; }
function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validUtc(value) { return typeof value === 'string' && UTC_RE.test(value) && Number.isFinite(Date.parse(value)); }
function validPublicKey(pem) {
  try { return crypto.createPublicKey(pem).asymmetricKeyType === 'ed25519'; } catch { return false; }
}
function validateIsolation(isolation) {
  if (!exactKeys(isolation, ['status', 'runnerPrincipal', 'signerPrincipal', 'keyCustody', 'evidenceSha256'])) return false;
  return isolation.status === 'VERIFIED'
    && typeof isolation.runnerPrincipal === 'string' && isolation.runnerPrincipal.length > 0
    && typeof isolation.signerPrincipal === 'string' && isolation.signerPrincipal.length > 0
    && isolation.runnerPrincipal !== isolation.signerPrincipal
    && typeof isolation.keyCustody === 'string' && isolation.keyCustody.length > 0
    && HASH_RE.test(isolation.evidenceSha256 || '');
}

function validateExecutorRegistry(registry) {
  if (!exactKeys(registry, ['schemaVersion', 'executors']) || registry.schemaVersion !== 1 || !Array.isArray(registry.executors)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const identities = new Set();
  for (const executor of registry.executors) {
    if (!exactKeys(executor, ['executorId', 'platform', 'architecture', 'keyAlgorithm', 'publicKeyPem', 'keyGeneration', 'status', 'validFrom', 'allowedCommandSetDigests', 'signerIsolation'])) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (!ID_RE.test(executor.executorId || '') || executor.executorId.startsWith('pvep-unenrolled-') || !['linux', 'windows'].includes(executor.platform) || typeof executor.architecture !== 'string' || executor.architecture.length === 0 || !Number.isSafeInteger(executor.keyGeneration) || executor.keyGeneration < 1 || !['ACTIVE', 'REVOKED'].includes(executor.status) || !validUtc(executor.validFrom) || !Array.isArray(executor.allowedCommandSetDigests) || executor.allowedCommandSetDigests.length === 0 || executor.allowedCommandSetDigests.some((digest) => !HASH_RE.test(digest))) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (executor.keyAlgorithm !== 'Ed25519' || !validPublicKey(executor.publicKeyPem)) return fail(REASON_CODES.EVIDENCE_EXECUTOR_ALGORITHM_INVALID);
    if (!validateIsolation(executor.signerIsolation)) return fail(REASON_CODES.EVIDENCE_SIGNER_ISOLATION_INVALID);
    const identity = `${executor.executorId}:${executor.keyGeneration}`;
    if (identities.has(identity)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    identities.add(identity);
  }
  return { pass: true, registry };
}

function resolveActiveExecutor({ registry, executorId, keyGeneration, platform, commandSetDigest }) {
  const validation = validateExecutorRegistry(registry);
  if (!validation.pass) return validation;
  const generations = registry.executors.filter((entry) => entry.executorId === executorId);
  if (generations.length === 0) return fail(REASON_CODES.EVIDENCE_EXECUTOR_UNKNOWN);
  const executor = generations.find((entry) => entry.keyGeneration === keyGeneration);
  if (!executor) return fail(REASON_CODES.EVIDENCE_KEY_GENERATION_INVALID);
  if (executor.status === 'REVOKED') return fail(REASON_CODES.EVIDENCE_EXECUTOR_REVOKED);
  if (executor.platform !== platform) return fail(REASON_CODES.EVIDENCE_PLATFORM_MISMATCH);
  if (!executor.allowedCommandSetDigests.includes(commandSetDigest)) return fail(REASON_CODES.EVIDENCE_EXECUTOR_COMMAND_SET_UNAUTHORIZED);
  return ok(executor);
}

module.exports = { resolveActiveExecutor, validateExecutorRegistry };
