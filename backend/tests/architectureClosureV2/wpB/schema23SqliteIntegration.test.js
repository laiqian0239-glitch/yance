'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../../../migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyArchitectureClosureV2WpA
} = require('../../../migrations/architectureClosureV2WpA');
const {
  MIGRATION_ID,
  MIGRATION_CHECKSUM,
  TARGET_SCHEMA_VERSION,
  WP_B_SCHEMA_CONTRACT,
  applyArchitectureClosureV2WpB,
  isArchitectureClosureV2WpBApplied
} = require('../../../migrations/architectureClosureV2WpB');
const {
  DurableExecutionAuthority
} = require('../../../services/durableExecutionAuthority');
const {
  ExternalActionOutboxAuthority
} = require('../../../services/externalActionOutboxAuthority');

function withDatabase(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-schema23-'));
  const dbPath = path.join(root, 'schema23.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    return work(db);
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function createSchema22(db) {
  db.exec(`CREATE TABLE r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  applyBatch41Fix6MArchitectureReferenceClosure(db);
  const result = applyArchitectureClosureV2WpA(db);
  assert.equal(result.targetSchemaVersion, 22);
  return result;
}

function installActiveHostLease(db, input = {}) {
  const hostId = String(input.hostId || 'host-1');
  const hostGeneration = Number(input.hostGeneration || 7);
  const fencingToken = Number(input.fencingToken || 19);
  const at = String(input.at || '2026-08-03T03:40:00.000Z');
  db.prepare(`INSERT INTO authority_write_host_lease(
    singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
    host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
    acquired_at,heartbeat_at,updated_at
  ) VALUES(1,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)
  ON CONFLICT(singleton_id) DO UPDATE SET
    owner_instance_id=excluded.owner_instance_id,
    owner_pid=excluded.owner_pid,
    owner_process_identity=excluded.owner_process_identity,
    startup_nonce=excluded.startup_nonce,
    host_generation=excluded.host_generation,
    fencing_token=excluded.fencing_token,
    state='ACTIVE',
    acquired_at_ms=excluded.acquired_at_ms,
    heartbeat_at_ms=excluded.heartbeat_at_ms,
    acquired_at=excluded.acquired_at,
    heartbeat_at=excluded.heartbeat_at,
    updated_at=excluded.updated_at`).run(
    hostId,
    1234,
    'wp-b-integration-host',
    'wp-b-integration-nonce',
    hostGeneration,
    fencingToken,
    Date.parse(at),
    Date.parse(at),
    at,
    at,
    at
  );
  return Object.freeze({ hostId, hostGeneration, fencingToken, at });
}

function createSchema23(db) {
  createSchema22(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:41:00.000Z' });
  return installActiveHostLease(db);
}

function createStore(db) {
  let transactionDepth = 0;
  return Object.freeze({
    db,
    transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('transaction callback required');
      if (transactionDepth > 0) return callback();
      db.exec('BEGIN IMMEDIATE');
      transactionDepth += 1;
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          throw Object.assign(new Error('async transaction forbidden'), {
            code: 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN'
          });
        }
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    }
  });
}

function insertLegacyExecution(db) {
  db.prepare(`INSERT INTO durable_executions(
    execution_id,trace_id,operation_kind,idempotency_key,state,generation,owner_id,
    lease_sequence,last_heartbeat_at,cancellation_requested_at,cancellation_actor,
    retry_count,max_attempts,next_attempt_at,failure_code,metadata_json,created_at,
    updated_at,completed_at
  ) VALUES(?,?,?,?,?,0,'',0,'','','',0,3,'','',?,?,?,'')`).run(
    'legacy-execution-1',
    'legacy-trace-1',
    'LEGACY_OPERATION',
    'legacy-idempotency-1',
    'CREATED',
    JSON.stringify({ checkpoint: 'legacy-checkpoint' }),
    '2026-08-03T03:30:00.000Z',
    '2026-08-03T03:30:00.000Z'
  );
  db.prepare(`INSERT INTO durable_execution_events(
    event_id,execution_id,sequence,event_type,from_state,to_state,generation,
    owner_id,reason_code,payload_json,created_at
  ) VALUES(?,?,1,'created','',?,0,'','',?,?)`).run(
    'legacy-event-1',
    'legacy-execution-1',
    'CREATED',
    JSON.stringify({ operationKind: 'LEGACY_OPERATION' }),
    '2026-08-03T03:30:00.000Z'
  );
}

function schemaVersion(db) {
  return Number(JSON.parse(db.prepare(
    "SELECT value_json FROM r32_meta WHERE key='schema_version'"
  ).get().value_json));
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map(row => String(row.name));
}

function executionCommand(overrides = {}) {
  return {
    executionId: 'execution-v2-1',
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    idempotencyKey: 'execution-v2-key-1',
    traceId: 'trace-v2-1',
    command: {
      recipientReference: 'recipient-ref-1',
      bodyReference: 'body-ref-1'
    },
    metadata: {
      platform: 'test-platform',
      checkpoint: 'created'
    },
    maxAttempts: 3,
    deadlineAt: '2026-08-03T04:30:00.000Z',
    authorityTimestamp: '2026-08-03T03:42:00.000Z',
    ...overrides
  };
}

test('Schema 23 upgrades a real Schema 22 database and preserves legacy durable history', () => withDatabase(db => {
  createSchema22(db);
  insertLegacyExecution(db);

  const result = applyArchitectureClosureV2WpB(db, {
    at: '2026-08-03T03:31:00.000Z'
  });
  assert.equal(result.migrationId, MIGRATION_ID);
  assert.equal(result.targetSchemaVersion, TARGET_SCHEMA_VERSION);
  assert.equal(result.checksum, MIGRATION_CHECKSUM);
  assert.equal(schemaVersion(db), 23);
  assert.equal(isArchitectureClosureV2WpBApplied(db), true);

  const migration = db.prepare(`SELECT target_schema_version,status,checksum
    FROM r32_schema_migrations WHERE migration_id=?`).get(MIGRATION_ID);
  assert.deepEqual({ ...migration }, {
    target_schema_version: 23,
    status: 'completed',
    checksum: MIGRATION_CHECKSUM
  });

  const legacy = db.prepare(`SELECT execution_id,state,command_content_sha256,
      content_hash_version,state_version,generation,owner_id,claim_id,
      host_generation,fencing_token,metadata_json
    FROM durable_executions WHERE execution_id='legacy-execution-1'`).get();
  assert.equal(legacy.execution_id, 'legacy-execution-1');
  assert.equal(legacy.state, 'CREATED');
  assert.equal(legacy.command_content_sha256, '');
  assert.equal(legacy.content_hash_version, 0);
  assert.equal(legacy.state_version, 0);
  assert.equal(legacy.generation, 0);
  assert.equal(legacy.owner_id, '');
  assert.equal(legacy.claim_id, '');
  assert.equal(legacy.host_generation, 0);
  assert.equal(legacy.fencing_token, 0);
  assert.deepEqual(JSON.parse(legacy.metadata_json), { checkpoint: 'legacy-checkpoint' });

  const event = db.prepare(`SELECT event_id,execution_id,sequence,event_type,to_state
    FROM durable_execution_events WHERE event_id='legacy-event-1'`).get();
  assert.deepEqual({ ...event }, {
    event_id: 'legacy-event-1',
    execution_id: 'legacy-execution-1',
    sequence: 1,
    event_type: 'created',
    to_state: 'CREATED'
  });

  const names = new Set(tableNames(db));
  for (const table of [
    ...WP_B_SCHEMA_CONTRACT.appendOnlyTables,
    ...WP_B_SCHEMA_CONTRACT.mutableCasTables
  ]) assert.equal(names.has(table), true, `missing ${table}`);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('Schema 23 reopen validation is idempotent and never downgrades metadata', () => withDatabase(db => {
  createSchema22(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:32:00.000Z' });
  db.exec(`CREATE TRIGGER reject_schema_22_reentry
    BEFORE UPDATE OF value_json ON r32_meta
    WHEN NEW.key IN ('schema_version','schemaVersion') AND NEW.value_json='22'
    BEGIN SELECT RAISE(ABORT,'schema 22 downgrade forbidden'); END;`);

  const second = applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:33:00.000Z' });
  assert.equal(second.targetSchemaVersion, 23);
  assert.equal(schemaVersion(db), 23);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM r32_schema_migrations
    WHERE migration_id=?`).get(MIGRATION_ID).count, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('Schema 23 rejects future schemas and tampered migration checksums', () => withDatabase(db => {
  createSchema22(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:34:00.000Z' });

  db.prepare("UPDATE r32_meta SET value_json='24' WHERE key IN ('schema_version','schemaVersion')").run();
  assert.throws(
    () => applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:35:00.000Z' }),
    error => error?.code === 'ACV2_WP_B_FUTURE_SCHEMA_UNSUPPORTED'
  );

  db.prepare("UPDATE r32_meta SET value_json='23' WHERE key IN ('schema_version','schemaVersion')").run();
  db.prepare(`UPDATE r32_schema_migrations SET checksum='tampered'
    WHERE migration_id=?`).run(MIGRATION_ID);
  assert.throws(
    () => isArchitectureClosureV2WpBApplied(db),
    error => error?.code === 'ACV2_WP_B_MIGRATION_CHECKSUM_MISMATCH'
  );
}));

test('DurableExecutionAuthority V2 persists canonical command hashes and rejects conflicting replay', () => withDatabase(db => {
  createSchema23(db);
  const store = createStore(db);
  const authority = new DurableExecutionAuthority({ storeProvider: () => store });

  const created = authority.createExecution(executionCommand());
  assert.equal(created.executionId, 'execution-v2-1');
  assert.equal(created.state, 'CREATED');
  assert.equal(created.stateVersion, 0);
  assert.equal(created.generation, 0);
  assert.match(created.commandContentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(created.contentHashVersion, 1);
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(created.metadata), true);
  assert.equal(Object.isFrozen(created.history), true);

  const replay = authority.createExecution(executionCommand({
    authorityTimestamp: '2026-08-03T03:43:00.000Z'
  }));
  assert.equal(replay.executionId, created.executionId);
  assert.equal(replay.commandContentSha256, created.commandContentSha256);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM durable_executions
    WHERE operation_kind='OUTBOUND_MESSAGE_SEND' AND idempotency_key='execution-v2-key-1'`).get().count, 1);

  assert.throws(
    () => authority.createExecution(executionCommand({
      command: {
        recipientReference: 'recipient-ref-1',
        bodyReference: 'different-body-ref'
      },
      authorityTimestamp: '2026-08-03T03:44:00.000Z'
    })),
    error => error?.code === 'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT'
  );
}));

test('DurableExecutionAuthority V2 executes one complete stale-writer CAS predicate', () => withDatabase(db => {
  const host = createSchema23(db);
  const store = createStore(db);
  const authority = new DurableExecutionAuthority({ storeProvider: () => store });
  const created = authority.createExecution(executionCommand());

  db.prepare(`UPDATE durable_executions SET
    state='CLAIMED',state_version=4,generation=2,owner_id=?,claim_id=?,
    host_generation=?,fencing_token=?,lease_started_at=?,lease_expires_at=?,
    heartbeat_sequence=1,last_heartbeat_at=?,updated_at=?
    WHERE execution_id=?`).run(
    host.hostId,
    'claim-v2-1',
    host.hostGeneration,
    host.fencingToken,
    '2026-08-03T03:45:00.000Z',
    '2026-08-03T03:55:00.000Z',
    '2026-08-03T03:45:00.000Z',
    '2026-08-03T03:45:00.000Z',
    created.executionId
  );

  const running = authority.transition({
    executionId: created.executionId,
    expectedStateVersion: 4,
    allowedStates: ['CLAIMED'],
    targetState: 'RUNNING',
    generation: 2,
    ownerId: host.hostId,
    claimId: 'claim-v2-1',
    hostId: host.hostId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    authorityTimestamp: '2026-08-03T03:46:00.000Z',
    eventType: 'started'
  });
  assert.equal(running.state, 'RUNNING');
  assert.equal(running.stateVersion, 5);
  assert.equal(running.generation, 2);
  assert.equal(running.ownerId, host.hostId);
  assert.equal(running.claimId, 'claim-v2-1');
  assert.equal(running.history.at(-1).eventType, 'started');
  assert.equal(Object.isFrozen(running), true);
  assert.equal(Object.isFrozen(running.history), true);
  assert.equal(Object.isFrozen(running.history.at(-1)), true);

  assert.throws(
    () => authority.transition({
      executionId: created.executionId,
      expectedStateVersion: 5,
      allowedStates: ['RUNNING'],
      targetState: 'WAITING_REMOTE',
      generation: 2,
      ownerId: 'stale-owner',
      claimId: 'claim-v2-1',
      hostId: host.hostId,
      hostGeneration: host.hostGeneration,
      fencingToken: host.fencingToken,
      authorityTimestamp: '2026-08-03T03:47:00.000Z',
      eventType: 'waiting-remote'
    }),
    error => error?.code === 'WP_B_EXECUTION_CAS_REJECTED'
  );
  assert.equal(db.prepare(`SELECT state_version FROM durable_executions
    WHERE execution_id=?`).get(created.executionId).state_version, 5);
}));

test('ExternalActionOutboxAuthority commits intent, claim, attempt and receipt with rollback safety', () => withDatabase(db => {
  const host = createSchema23(db);
  const store = createStore(db);
  const executionAuthority = new DurableExecutionAuthority({ storeProvider: () => store });
  const outbox = new ExternalActionOutboxAuthority({
    storeProvider: () => store,
    idFactory(prefix) {
      const ids = {
        'external-intent': 'intent-v2-1',
        'external-attempt': 'attempt-v2-1',
        'external-receipt': 'receipt-v2-1'
      };
      return ids[prefix] || `${prefix}-v2-1`;
    }
  });
  executionAuthority.createExecution(executionCommand());

  const intent = outbox.createIntent({
    intentId: 'intent-v2-1',
    executionId: 'execution-v2-1',
    actionKind: 'MESSAGE_SEND',
    idempotencyKey: 'intent-v2-key-1',
    payload: {
      recipientReference: 'recipient-ref-1',
      bodyReference: 'body-ref-1'
    },
    authorityTimestamp: '2026-08-03T03:48:00.000Z'
  });
  assert.equal(intent.claim.state, 'READY');
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(Object.isFrozen(intent.payload), true);
  assert.equal(Object.isFrozen(intent.claim), true);

  const claimed = outbox.claimIntent({
    intentId: intent.intentId,
    stateVersion: 0,
    generation: 0,
    ownerId: host.hostId,
    hostId: host.hostId,
    claimId: 'outbox-claim-v2-1',
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    leaseStartedAt: '2026-08-03T03:49:00.000Z',
    leaseExpiresAt: '2026-08-03T03:59:00.000Z'
  });
  assert.equal(claimed.claim.state, 'CLAIMED');
  assert.equal(claimed.claim.stateVersion, 1);
  assert.equal(claimed.claim.generation, 1);

  const attempt = outbox.startAttempt({
    intentId: intent.intentId,
    stateVersion: claimed.claim.stateVersion,
    generation: claimed.claim.generation,
    ownerId: host.hostId,
    hostId: host.hostId,
    claimId: claimed.claim.claimId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    request: { providerBodyReference: 'provider-body-ref-1' },
    authorityTimestamp: '2026-08-03T03:50:00.000Z'
  });
  assert.equal(attempt.attemptId, 'attempt-v2-1');
  assert.equal(attempt.state, 'ATTEMPTED');
  assert.equal(attempt.stateVersion, 2);
  assert.equal(Object.isFrozen(attempt), true);

  const receipt = outbox.recordReceipt({
    intentId: intent.intentId,
    attemptId: attempt.attemptId,
    stateVersion: attempt.stateVersion,
    generation: attempt.generation,
    ownerId: host.hostId,
    hostId: host.hostId,
    claimId: attempt.claimId,
    hostGeneration: host.hostGeneration,
    fencingToken: host.fencingToken,
    providerReceiptId: 'provider-receipt-v2-1',
    evidenceReference: 'provider:provider-receipt-v2-1',
    result: { accepted: true },
    authorityTimestamp: '2026-08-03T03:51:00.000Z'
  });
  assert.equal(receipt.receiptId, 'receipt-v2-1');
  assert.equal(receipt.receiptType, 'SUCCESS');
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.result), true);

  assert.throws(
    () => db.prepare(`UPDATE external_action_receipts SET evidence_reference='tampered'
      WHERE receipt_id=?`).run(receipt.receiptId),
    /append-only/u
  );
  assert.throws(
    () => outbox.startAttempt({
      intentId: intent.intentId,
      stateVersion: attempt.stateVersion,
      generation: attempt.generation,
      ownerId: host.hostId,
      hostId: host.hostId,
      claimId: attempt.claimId,
      hostGeneration: host.hostGeneration,
      fencingToken: host.fencingToken,
      request: { providerBodyReference: 'duplicate-call-ref' },
      authorityTimestamp: '2026-08-03T03:52:00.000Z'
    }),
    error => error?.code === 'WP_B_OUTBOX_ATTEMPT_CAS_REJECTED'
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM external_action_attempts
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));
