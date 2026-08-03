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

function literalPattern(value) {
  return new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u');
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
  assert.match(update, /\bstate\s*=\s*\?/iu);
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
    'execution_id=?', 'state=?', 'state_version=?', 'generation=?', 'owner_id=?', 'claim_id=?',
    'host_generation=?', 'fencing_token=?', 'authority_write_host_lease'
  ]) assert.match(calls[0].sql.replace(/\s+/gu, ' '), literalPattern(marker));
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

test('V2 unowned transition CAS schedules an execution without inventing a worker lease', () => {
  const { executeUnownedExecutionTransitionCas } = authorityModule();
  assert.equal(
    typeof executeUnownedExecutionTransitionCas,
    'function',
    'durableExecutionAuthority V2 unowned transition CAS missing'
  );
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
  const result = executeUnownedExecutionTransitionCas(db, {
    executionId: 'execution-unowned-schedule',
    fromState: 'CREATED',
    targetState: 'SCHEDULED',
    stateVersion: 0,
    generation: 0,
    hostId: 'write-host-schedule',
    hostGeneration: 9,
    fencingToken: 27,
    authorityTimestamp: '2026-08-03T03:59:00.000Z'
  });

  assert.equal(calls.length, 1);
  const sql = calls[0].sql.replace(/\s+/gu, ' ');
  for (const marker of [
    'state_version=state_version+1',
    'execution_id=?',
    'state=?',
    'state_version=?',
    'generation=?',
    "owner_id=''",
    "claim_id=''",
    'host_generation=0',
    'fencing_token=0',
    'authority_write_host_lease'
  ]) assert.match(sql, literalPattern(marker), marker);
  assert.doesNotMatch(sql, /lease_expires_at\s*>=\s*\?/u);
  assert.deepEqual(calls[0].parameters, [
    'SCHEDULED',
    '2026-08-03T03:59:00.000Z',
    'execution-unowned-schedule',
    'CREATED',
    0,
    0,
    'write-host-schedule',
    9,
    27
  ]);
  assert.deepEqual(result, {
    executionId: 'execution-unowned-schedule',
    fromState: 'CREATED',
    targetState: 'SCHEDULED',
    stateVersion: 1,
    generation: 0,
    authorityTimestamp: '2026-08-03T03:59:00.000Z'
  });
  assert.equal(Object.isFrozen(result), true);
});

test('V2 first-claim CAS atomically assigns ownership and starts a lease', () => {
  const { executeExecutionClaimCas } = authorityModule();
  assert.equal(
    typeof executeExecutionClaimCas,
    'function',
    'durableExecutionAuthority V2 claim CAS missing'
  );
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
  const result = executeExecutionClaimCas(db, {
    executionId: 'execution-first-claim',
    fromState: 'SCHEDULED',
    stateVersion: 2,
    generation: 0,
    ownerId: 'host-first-claim',
    claimId: 'claim-first-claim',
    hostId: 'host-first-claim',
    hostGeneration: 9,
    fencingToken: 27,
    leaseStartedAt: '2026-08-03T04:00:00.000Z',
    leaseExpiresAt: '2026-08-03T04:05:00.000Z'
  });

  assert.equal(calls.length, 1);
  const sql = calls[0].sql.replace(/\s+/gu, ' ');
  for (const marker of [
    'state=?',
    'state_version=state_version+1',
    'generation=generation+1',
    'owner_id=?',
    'claim_id=?',
    'host_generation=?',
    'fencing_token=?',
    'lease_started_at=?',
    'lease_expires_at=?',
    'execution_id=?',
    'state=?',
    'state_version=?',
    'generation=?',
    "owner_id=''",
    "claim_id=''",
    'host_generation=0',
    'fencing_token=0',
    'authority_write_host_lease'
  ]) assert.match(sql, literalPattern(marker), marker);
  assert.doesNotMatch(sql, /lease_expires_at\s*>=\s*\?/u);
  assert.deepEqual(result, {
    executionId: 'execution-first-claim',
    fromState: 'SCHEDULED',
    targetState: 'CLAIMED',
    stateVersion: 3,
    generation: 1,
    ownerId: 'host-first-claim',
    claimId: 'claim-first-claim',
    hostGeneration: 9,
    fencingToken: 27,
    leaseStartedAt: '2026-08-03T04:00:00.000Z',
    leaseExpiresAt: '2026-08-03T04:05:00.000Z'
  });
  assert.equal(Object.isFrozen(result), true);
});

test('Schema 23 CAS requires an explicit write-host identity before preparing SQL', () => {
  const {
    executeExecutionClaimCas,
    executeExecutionTransitionCas
  } = authorityModule();
  const db = {
    prepare() {
      throw new Error('SQL must not be prepared when hostId is absent');
    }
  };
  assert.throws(
    () => executeExecutionClaimCas(db, {
      executionId: 'execution-host-required-claim',
      fromState: 'SCHEDULED',
      stateVersion: 0,
      generation: 0,
      ownerId: 'owner-not-host',
      claimId: 'claim-host-required',
      hostGeneration: 1,
      fencingToken: 1,
      leaseStartedAt: '2026-08-03T04:00:00.000Z',
      leaseExpiresAt: '2026-08-03T04:05:00.000Z'
    }),
    error => error?.code === 'WP_B_EXECUTION_FIELD_REQUIRED'
      && error?.field === 'hostId'
  );
  assert.throws(
    () => executeExecutionTransitionCas(db, {
      executionId: 'execution-host-required-transition',
      fromState: 'RUNNING',
      targetState: 'WAITING_REMOTE',
      stateVersion: 1,
      generation: 1,
      ownerId: 'owner-not-host',
      claimId: 'claim-host-required',
      hostGeneration: 1,
      fencingToken: 1,
      authorityTimestamp: '2026-08-03T04:01:00.000Z'
    }),
    error => error?.code === 'WP_B_EXECUTION_FIELD_REQUIRED'
      && error?.field === 'hostId'
  );
});

test('Schema 23 detection treats only the absent migration table as not applied', () => {
  const { schema23Applied } = authorityModule();
  const missingTable = Object.assign(
    new Error('no such table: r32_schema_migrations'),
    { code: 'ERR_SQLITE_ERROR' }
  );
  assert.equal(schema23Applied({
    db: { prepare: () => ({ get: () => { throw missingTable; } }) }
  }), false);

  const closedDatabase = Object.assign(
    new Error('database is not open'),
    { code: 'ERR_SQLITE_ERROR' }
  );
  assert.throws(
    () => schema23Applied({
      db: { prepare: () => ({ get: () => { throw closedDatabase; } }) }
    }),
    error => error === closedDatabase
  );
});

test('Schema 23 authority owns schedule and claim facades instead of inheriting legacy command shapes', () => {
  const { DurableExecutionAuthority } = authorityModule();
  for (const method of ['schedule', 'claim']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DurableExecutionAuthority.prototype, method),
      true,
      `durableExecutionAuthority Schema 23 ${method} facade missing`
    );
  }
});

test('unconditional execution update is forbidden', () => {
  const updates = source().match(/UPDATE\s+durable_executions[\s\S]*?`/giu) || [];
  assert.ok(updates.length > 0, 'durable execution UPDATE missing');
  for (const update of updates) {
    assert.doesNotMatch(
      update,
      /WHERE\s+execution_id\s*=\s*\?\s*`$/iu,
      `unconditional execution update found:\n${update}`
    );
  }
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
