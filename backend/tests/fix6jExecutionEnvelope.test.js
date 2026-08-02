'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createModelExecutionEnvelope,
  verifyModelExecutionEnvelope,
  canonicalizeExecutionEnvelopePayload,
  credentialFingerprint
} = require('../services/modelExecutionEnvelopeAuthority');

function validInput(overrides = {}) {
  return {
    executionId: 'exec-fix6j-v2-1',
    correlationId: 'corr-fix6j-v2-1',
    task: 'quick_reply',
    executionSpec: {
      provider: 'cloud',
      endpoint: 'https://openrouter.ai/api/v1',
      modelName: 'openai/gpt-5.6-sol',
      modelId: 'cloud-1',
      credential: { apiKey: 'fix6j-v2-secret-canary' }
    },
    policySnapshot: { schemaVersion: 1, emergencyStop: false, privacyMode: true, sourceVersion: 7 },
    routeReceipt: { schemaVersion: 1, routeId: 'route-1', resolvedModelId: 'cloud-1' },
    qualificationReceipt: { schemaVersion: 1, modelId: 'cloud-1', qualified: true },
    messages: [{ role: 'user', content: 'hello' }],
    options: { temperature: 0.2, maxTokens: 64 },
    deadlineAt: '2030-01-01T00:00:00.000Z',
    ...overrides
  };
}

function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

test('creates and verifies a schema-v1 deeply frozen execution envelope', () => {
  const envelope = createModelExecutionEnvelope(validInput());
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.type, 'execute');
  assert.equal(envelope.integrity.algorithm, 'sha256');
  assert.match(envelope.integrity.digest, /^[a-f0-9]{64}$/u);
  assert.match(envelope.executionSpec.credentialFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(envelope.executionSpec.credential.apiKey, 'fix6j-v2-secret-canary');
  assert.equal(deeplyFrozen(envelope), true);
  assert.equal(verifyModelExecutionEnvelope(envelope), envelope);
});

test('rejects missing required fields', () => {
  assert.throws(
    () => createModelExecutionEnvelope(validInput({ executionId: '' })),
    error => error.code === 'MODEL_EXECUTION_ENVELOPE_INVALID'
  );
});

test('rejects unsupported schema versions', () => {
  const envelope = createModelExecutionEnvelope(validInput());
  const unsupported = { ...envelope, schemaVersion: 2 };
  assert.throws(
    () => verifyModelExecutionEnvelope(unsupported),
    error => error.code === 'MODEL_EXECUTION_ENVELOPE_INVALID'
  );
});

test('rejects digest tampering without exposing the API key', () => {
  const envelope = createModelExecutionEnvelope(validInput());
  const tampered = { ...envelope, task: 'director' };
  assert.throws(
    () => verifyModelExecutionEnvelope(tampered),
    error => error.code === 'MODEL_EXECUTION_ENVELOPE_INVALID' && !JSON.stringify(error).includes('fix6j-v2-secret-canary')
  );
});

test('canonicalization sorts object keys recursively and preserves array order', () => {
  const first = { z: 1, nested: { b: 2, a: 1 }, rows: [{ y: 2, x: 1 }, 'second'] };
  const reordered = { rows: [{ x: 1, y: 2 }, 'second'], nested: { a: 1, b: 2 }, z: 1 };
  const reversedArray = { rows: ['second', { x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(canonicalizeExecutionEnvelopePayload(first), canonicalizeExecutionEnvelopePayload(reordered));
  assert.notEqual(canonicalizeExecutionEnvelopePayload(first), canonicalizeExecutionEnvelopePayload(reversedArray));
});

test('credential fingerprint changes with the credential and plaintext is excluded from digest input', () => {
  const first = createModelExecutionEnvelope(validInput());
  const second = createModelExecutionEnvelope(validInput({
    executionSpec: { ...validInput().executionSpec, credential: { apiKey: 'fix6j-v2-other-secret' } }
  }));
  assert.notEqual(credentialFingerprint('fix6j-v2-secret-canary'), credentialFingerprint('fix6j-v2-other-secret'));
  assert.notEqual(first.integrity.digest, second.integrity.digest);
  const canonical = canonicalizeExecutionEnvelopePayload(first);
  assert.equal(canonical.includes('fix6j-v2-secret-canary'), false);
  assert.equal(canonical.includes(first.executionSpec.credentialFingerprint), true);
});
