'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const DIGEST_ALGORITHM = 'sha256';

function clean(value) { return String(value == null ? '' : value).trim(); }

function invalidEnvelope() {
  return Object.assign(new Error('Model execution envelope is invalid'), {
    code: 'MODEL_EXECUTION_ENVELOPE_INVALID',
    status: 400
  });
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function credentialFingerprint(apiKey) {
  return crypto.createHash(DIGEST_ALGORITHM).update(clean(apiKey), 'utf8').digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(item => canonicalValue(item));
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) normalized[key] = canonicalValue(value[key]);
  }
  return normalized;
}

function digestPayload(value) {
  const payload = cloneValue(value);
  delete payload.integrity;
  if (payload.executionSpec?.credential) delete payload.executionSpec.credential.apiKey;
  return payload;
}

function canonicalizeExecutionEnvelopePayload(payload) {
  return JSON.stringify(canonicalValue(digestPayload(payload)));
}

function envelopeDigest(envelope) {
  return crypto.createHash(DIGEST_ALGORITHM)
    .update(canonicalizeExecutionEnvelopePayload(envelope), 'utf8')
    .digest('hex');
}

function requiredEnvelopeFields(value) {
  return Boolean(
    value && typeof value === 'object' &&
    clean(value.executionId) && clean(value.correlationId) && clean(value.task) &&
    value.executionSpec && typeof value.executionSpec === 'object' &&
    clean(value.executionSpec.provider) && clean(value.executionSpec.modelName) && clean(value.executionSpec.modelId) &&
    value.policySnapshot && typeof value.policySnapshot === 'object' &&
    value.routeReceipt && typeof value.routeReceipt === 'object' &&
    value.qualificationReceipt && typeof value.qualificationReceipt === 'object' &&
    Array.isArray(value.messages) && value.options && typeof value.options === 'object' &&
    Number.isFinite(Date.parse(clean(value.deadlineAt)))
  );
}

function createModelExecutionEnvelope(input = {}) {
  if (!requiredEnvelopeFields(input)) throw invalidEnvelope();
  const apiKey = clean(input.executionSpec?.credential?.apiKey);
  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    type: 'execute',
    executionId: clean(input.executionId),
    correlationId: clean(input.correlationId),
    task: clean(input.task),
    executionSpec: {
      provider: clean(input.executionSpec.provider).toLowerCase(),
      endpoint: clean(input.executionSpec.endpoint),
      modelName: clean(input.executionSpec.modelName),
      modelId: clean(input.executionSpec.modelId),
      credential: { apiKey },
      credentialFingerprint: credentialFingerprint(apiKey)
    },
    policySnapshot: cloneValue(input.policySnapshot),
    routeReceipt: cloneValue(input.routeReceipt),
    qualificationReceipt: cloneValue(input.qualificationReceipt),
    messages: cloneValue(input.messages),
    options: cloneValue(input.options),
    deadlineAt: clean(input.deadlineAt)
  };
  envelope.integrity = { algorithm: DIGEST_ALGORITHM, digest: envelopeDigest(envelope) };
  return deepFreeze(envelope);
}

function verifyModelExecutionEnvelope(value = {}) {
  if (Number(value.schemaVersion) !== SCHEMA_VERSION || value.type !== 'execute' || !requiredEnvelopeFields(value)) {
    throw invalidEnvelope();
  }
  if (value.integrity?.algorithm !== DIGEST_ALGORITHM || !/^[a-f0-9]{64}$/u.test(clean(value.integrity?.digest))) {
    throw invalidEnvelope();
  }
  const apiKey = clean(value.executionSpec?.credential?.apiKey);
  if (clean(value.executionSpec?.credentialFingerprint) !== credentialFingerprint(apiKey)) throw invalidEnvelope();
  const expected = envelopeDigest(value);
  const actual = clean(value.integrity.digest);
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) throw invalidEnvelope();
  return deepFreeze(value);
}

module.exports = {
  SCHEMA_VERSION,
  DIGEST_ALGORITHM,
  createModelExecutionEnvelope,
  verifyModelExecutionEnvelope,
  canonicalizeExecutionEnvelopePayload,
  credentialFingerprint
};
