'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  validateExecutorRegistry,
  resolveActiveExecutor
} = require('../../shared/verification/executorRegistry');

const DIGEST = 'b'.repeat(64);

function activeEntry(overrides = {}) {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    executorId: 'linux-executor-01',
    platform: 'linux',
    architecture: 'x64',
    keyAlgorithm: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    keyGeneration: 1,
    status: 'ACTIVE',
    validFrom: '2026-08-07T00:00:00.000Z',
    allowedCommandSetDigests: [DIGEST],
    signerIsolation: {
      status: 'VERIFIED',
      runnerPrincipal: 'svc-yance-runner',
      signerPrincipal: 'svc-yance-signer',
      keyCustody: 'OS_KEYSTORE_NON_EXPORTABLE',
      evidenceSha256: 'c'.repeat(64)
    },
    ...overrides
  };
}

function registry(entry = activeEntry()) {
  return { schemaVersion: 1, executors: [entry] };
}

test('ACTIVE exact generation/platform/command digest with verified isolation resolves', () => {
  const value = registry();
  assert.equal(validateExecutorRegistry(value).pass, true);
  const resolved = resolveActiveExecutor({ registry: value, executorId: 'linux-executor-01', keyGeneration: 1, platform: 'linux', commandSetDigest: DIGEST });
  assert.equal(resolved.pass, true);
  assert.equal(resolved.executor.executorId, 'linux-executor-01');
});

test('unknown, revoked, generation, platform and command authorization fail closed', () => {
  assert.equal(resolveActiveExecutor({ registry: registry(), executorId: 'missing', keyGeneration: 1, platform: 'linux', commandSetDigest: DIGEST }).reasonCode, 'EVIDENCE_EXECUTOR_UNKNOWN');
  assert.equal(resolveActiveExecutor({ registry: registry(activeEntry({ status: 'REVOKED' })), executorId: 'linux-executor-01', keyGeneration: 1, platform: 'linux', commandSetDigest: DIGEST }).reasonCode, 'EVIDENCE_EXECUTOR_REVOKED');
  assert.equal(resolveActiveExecutor({ registry: registry(), executorId: 'linux-executor-01', keyGeneration: 2, platform: 'linux', commandSetDigest: DIGEST }).reasonCode, 'EVIDENCE_KEY_GENERATION_INVALID');
  assert.equal(resolveActiveExecutor({ registry: registry(), executorId: 'linux-executor-01', keyGeneration: 1, platform: 'windows', commandSetDigest: DIGEST }).reasonCode, 'EVIDENCE_PLATFORM_MISMATCH');
  assert.equal(resolveActiveExecutor({ registry: registry(), executorId: 'linux-executor-01', keyGeneration: 1, platform: 'linux', commandSetDigest: 'd'.repeat(64) }).reasonCode, 'EVIDENCE_EXECUTOR_COMMAND_SET_UNAUTHORIZED');
});

test('invalid signer isolation and non-Ed25519 algorithms are rejected', () => {
  const samePrincipal = activeEntry();
  samePrincipal.signerIsolation.signerPrincipal = samePrincipal.signerIsolation.runnerPrincipal;
  assert.equal(validateExecutorRegistry(registry(samePrincipal)).reasonCode, 'EVIDENCE_SIGNER_ISOLATION_INVALID');

  const missingEvidence = activeEntry();
  missingEvidence.signerIsolation.evidenceSha256 = 'bad';
  assert.equal(validateExecutorRegistry(registry(missingEvidence)).reasonCode, 'EVIDENCE_SIGNER_ISOLATION_INVALID');

  const wrongAlgorithm = activeEntry({ keyAlgorithm: 'RSA' });
  assert.equal(validateExecutorRegistry(registry(wrongAlgorithm)).reasonCode, 'EVIDENCE_EXECUTOR_ALGORITHM_INVALID');
});

test('production registry may be intentionally empty but duplicate identities are forbidden', () => {
  assert.equal(validateExecutorRegistry({ schemaVersion: 1, executors: [] }).pass, true);
  const entry = activeEntry();
  assert.equal(validateExecutorRegistry({ schemaVersion: 1, executors: [entry, structuredClone(entry)] }).reasonCode, 'EVIDENCE_SCHEMA_INVALID');
});
