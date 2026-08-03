'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE_PATH = require.resolve('../../../services/durableExecutionAuthority');

function authorityModule() {
  delete require.cache[SOURCE_PATH];
  return require(SOURCE_PATH);
}

function source() {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

test('durable execution rows carry content hash, state version, claim and host fencing facts', () => {
  const text = source();
  for (const marker of [
    'command_content_sha256', 'content_hash_version', 'state_version', 'claim_id',
    'lease_expires_at', 'heartbeat_sequence', 'host_generation', 'fencing_token'
  ]) assert.match(text, new RegExp(marker, 'u'), `missing ${marker}`);
});

test('execution command canonicalization is stable and deeply immutable', () => {
  const { normalizeExecutionCommand } = authorityModule();
  assert.equal(typeof normalizeExecutionCommand, 'function');
  const left = normalizeExecutionCommand({
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: 'execution-key-1',
    traceId: 'trace-1',
    command: { recipient: 'r-1', options: { urgent: true }, parts: ['a', 'b'] }
  });
  const right = normalizeExecutionCommand({
    command: { parts: ['a', 'b'], options: { urgent: true }, recipient: 'r-1' },
    traceId: 'trace-1',
    idempotencyKey: 'execution-key-1',
    operationKind: 'OUTBOUND_MESSAGE_SEND'
  });
  assert.equal(left.commandContentSha256, right.commandContentSha256);
  assert.match(left.commandContentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(left.contentHashVersion, 1);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.command), true);
  assert.equal(Object.isFrozen(left.command.options), true);
  assert.equal(Object.isFrozen(left.command.parts), true);
  assert.throws(() => { left.command.options.urgent = false; }, TypeError);
});

test('authoritative transition SQL predicates every stale-writer fact in one UPDATE', () => {
  const text = source();
  const update = text.match(/UPDATE\s+durable_executions[\s\S]*?WHERE[\s\S]*?`/iu)?.[0] || '';
  assert.match(update, /execution_id\s*=\s*\?/iu);
  assert.match(update, /state_version\s*=\s*\?/iu);
  assert.match(update, /generation\s*=\s*\?/iu);
  assert.match(update, /owner_id\s*=\s*\?/iu);
  assert.match(update, /claim_id\s*=\s*\?/iu);
  assert.match(update, /host_generation\s*=\s*\?/iu);
  assert.match(update, /fencing_token\s*=\s*\?/iu);
  assert.match(update, /authority_write_host_lease/iu);
});

test('executable transition CAS binds all stale-writer facts and returns an immutable version advance', () => {
  const { executeExecutionTransitionCas } = authorityModule();
  assert.equal(typeof executeExecutionTransitionCas, 'function');
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        run(...parameters) {
          calls.push({ sql, parameters });
          return { changes: 1 };
        }
      };
    }
  };
  const result = executeExecutionTransitionCas(db, {
    executionId: 'execution-1',
    fromState: 'RUNNING',
    targetState: 'WAITING_REMOTE',
    stateVersion: 7,
    generation: 3,
    ownerId: 'host-1',
    claimId: 'claim-1',
    hostId: 'host-1',
    hostGeneration: 4,
    fencingToken: 5,
    authorityTimestamp: '2026-08-03T03:20:00.000Z'
  });
  assert.equal(calls.length, 1);
  for (const marker of [
    'execution_id=?', 'state_version=?', 'generation=?', 'owner_id=?', 'claim_id=?',
    'host_generation=?', 'fencing_token=?', 'authority_write_host_lease'
  ]) assert.match(calls[0].sql.replace(/\s+/gu, ' '), new RegExp(marker.replace(/[?]/gu, '\\?'), 'u'));
  assert.deepEqual(result, {
    executionId: 'execution-1',
    fromState: 'RUNNING',
    targetState: 'WAITING_REMOTE',
    stateVersion: 8,
    generation: 3,
    ownerId: 'host-1',
    claimId: 'claim-1',
    hostGeneration: 4,
    fencingToken: 5,
    authorityTimestamp: '2026-08-03T03:20:00.000Z'
  });
  assert.equal(Object.isFrozen(result), true);
});

test('unconditional execution update is forbidden', () => {
  const text = source();
  assert.doesNotMatch(
    text,
    /UPDATE\s+durable_executions[\s\S]*?WHERE\s+execution_id\s*=\s*\?\s*`/iu
  );
});

test('CAS rejection is based on affected row count', () => {
  const text = source();
  assert.match(text, /changes[^\n]*!==?\s*1/iu);
  assert.match(text, /WP_B_EXECUTION_CAS_REJECTED/u);

  const { executeExecutionTransitionCas } = authorityModule();
  const db = { prepare: () => ({ run: () => ({ changes: 0 }) }) };
  assert.throws(
    () => executeExecutionTransitionCas(db, {
      executionId: 'execution-stale',
      fromState: 'RUNNING',
      targetState: 'WAITING_REMOTE',
      stateVersion: 2,
      generation: 1,
      ownerId: 'host-1',
      claimId: 'claim-stale',
      hostId: 'host-1',
      hostGeneration: 4,
      fencingToken: 5,
      authorityTimestamp: '2026-08-03T03:21:00.000Z'
    }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );
});

test('same idempotency key with different canonical content hash fails closed', () => {
  const text = source();
  assert.match(text, /WP_B_EXECUTION_IDEMPOTENCY_CONFLICT/u);
  assert.match(text, /canonicalHash|commandContentSha256|command_content_sha256/u);

  const { assertExecutionIdempotency, normalizeExecutionCommand } = authorityModule();
  const command = normalizeExecutionCommand({
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: 'execution-key-conflict',
    command: { bodyReference: 'body-a' }
  });
  assert.throws(
    () => assertExecutionIdempotency({
      execution_id: 'existing-execution',
      command_content_sha256: 'a'.repeat(64),
      content_hash_version: 1
    }, command),
    error => error?.code === 'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT'
  );
});
