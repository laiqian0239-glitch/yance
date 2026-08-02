'use strict';

const { canonicalSerialize, canonicalHash } = require('./canonicalSerialization');
const { CLASSIFICATIONS } = require('./dataClassificationRegistry');
const { assertAuthorityCommandEnvelope } = require('./authorityCommandProtocol');
const { runWithAuthorityWriteTransaction } = require('./authorityTransactionContext');
const { validateProjectorSql } = require('./projectorSqlPolicy');

const EVENT_FIELDS = new Set([
  'eventId', 'eventType', 'schemaVersion', 'payloadClassification', 'occurredAt', 'payload',
  'platform', 'sourceAccountId', 'generation', 'redactionVersion', 'retentionClass', 'ledgerSegmentId'
]);
const PROJECTOR_FIELDS = new Set(['projectorId', 'projectorVersion', 'apply']);
const CLASSIFICATION_VALUES = new Set(Object.values(CLASSIFICATIONS));

function coordinatorError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertExactPlainObject(input, fields, name) {
  if (!isPlainObject(input)) {
    throw coordinatorError('AUTHORITY_TRANSACTION_INPUT_INVALID', `${name} must be a plain object`, { name });
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw coordinatorError('AUTHORITY_TRANSACTION_INPUT_INVALID', `${name} cannot contain symbol keys`, { name });
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const field of Object.getOwnPropertyNames(input)) {
    const descriptor = descriptors[field];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw coordinatorError('AUTHORITY_TRANSACTION_INPUT_INVALID', `${name} cannot contain accessors`, { name, field });
    }
    if (!fields.has(field)) {
      throw coordinatorError('AUTHORITY_TRANSACTION_INPUT_INVALID', `${name} field ${field} is not registered`, { name, field });
    }
  }
  return descriptors;
}

function requiredString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (!result) throw coordinatorError('AUTHORITY_TRANSACTION_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw coordinatorError('AUTHORITY_TRANSACTION_FIELD_INVALID', `${field} is invalid`, {
      field,
      length: result.length,
      maximum
    });
  }
  return result;
}

function optionalString(value, field, maximum = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw coordinatorError('AUTHORITY_TRANSACTION_FIELD_INVALID', `${field} is invalid`, {
      field,
      length: result.length,
      maximum
    });
  }
  return result;
}

function normalizeTimestamp(value, field) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) {
    throw coordinatorError('AUTHORITY_TRANSACTION_TIMESTAMP_INVALID', `${field} is invalid`, { field });
  }
  return new Date(milliseconds).toISOString();
}

function normalizeEvent(input) {
  const descriptors = assertExactPlainObject(input, EVENT_FIELDS, 'event');
  for (const field of ['eventId', 'eventType', 'schemaVersion', 'payloadClassification', 'occurredAt', 'payload']) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
      throw coordinatorError('AUTHORITY_TRANSACTION_FIELD_REQUIRED', `event.${field} is required`, {
        field: `event.${field}`
      });
    }
  }

  const eventId = requiredString(descriptors.eventId.value, 'event.eventId');
  const eventType = requiredString(descriptors.eventType.value, 'event.eventType', 256);
  const schemaVersion = Number(descriptors.schemaVersion.value);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw coordinatorError(
      'AUTHORITY_TRANSACTION_EVENT_SCHEMA_INVALID',
      'event.schemaVersion must be a positive safe integer'
    );
  }
  const payloadClassification = requiredString(
    descriptors.payloadClassification.value,
    'event.payloadClassification',
    64
  );
  if (!CLASSIFICATION_VALUES.has(payloadClassification)) {
    throw coordinatorError(
      'AUTHORITY_TRANSACTION_EVENT_CLASSIFICATION_INVALID',
      'event.payloadClassification is not registered',
      { payloadClassification }
    );
  }

  let payloadCanonical;
  try {
    payloadCanonical = canonicalSerialize(descriptors.payload.value);
  } catch (error) {
    throw coordinatorError(
      'AUTHORITY_TRANSACTION_EVENT_PAYLOAD_INVALID',
      'event.payload is not canonical plain data',
      { causeCode: error?.code || '', causeMessage: error?.message || String(error) }
    );
  }
  const payload = deepFreeze(JSON.parse(payloadCanonical));
  const generation = descriptors.generation ? Number(descriptors.generation.value) : 0;
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw coordinatorError(
      'AUTHORITY_TRANSACTION_EVENT_GENERATION_INVALID',
      'event.generation must be a non-negative safe integer'
    );
  }

  return Object.freeze({
    eventId,
    eventType,
    schemaVersion,
    payloadClassification,
    occurredAt: normalizeTimestamp(descriptors.occurredAt.value, 'event.occurredAt'),
    payload,
    payloadCanonical,
    payloadSha256: canonicalHash(payload),
    platform: optionalString(descriptors.platform?.value, 'event.platform', 64),
    sourceAccountId: optionalString(descriptors.sourceAccountId?.value, 'event.sourceAccountId', 1024),
    generation,
    redactionVersion: optionalString(descriptors.redactionVersion?.value, 'event.redactionVersion', 128)
      || 'classification-v1',
    retentionClass: optionalString(descriptors.retentionClass?.value, 'event.retentionClass', 128)
      || 'ACTIVE_REPLAY',
    ledgerSegmentId: optionalString(descriptors.ledgerSegmentId?.value, 'event.ledgerSegmentId', 512)
      || 'segment-active-v1'
  });
}

function normalizeProjector(input) {
  const descriptors = assertExactPlainObject(input, PROJECTOR_FIELDS, 'projector');
  for (const field of PROJECTOR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
      throw coordinatorError('AUTHORITY_TRANSACTION_FIELD_REQUIRED', `projector.${field} is required`, {
        field: `projector.${field}`
      });
    }
  }
  const projectorId = requiredString(descriptors.projectorId.value, 'projector.projectorId', 256);
  const projectorVersion = requiredString(descriptors.projectorVersion.value, 'projector.projectorVersion', 128);
  const apply = descriptors.apply.value;
  if (typeof apply !== 'function') {
    throw coordinatorError('AUTHORITY_TRANSACTION_PROJECTOR_INVALID', 'projector.apply must be a function');
  }
  return Object.freeze({ projectorId, projectorVersion, apply });
}

function parseJson(value, fallback = null) {
  try {
    return value == null || value === '' ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function canonicalResult(value) {
  const result = value == null ? {} : value;
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(result)));
  } catch (error) {
    throw coordinatorError(
      'AUTHORITY_TRANSACTION_RESULT_INVALID',
      'Projector result must be canonical plain data',
      { causeCode: error?.code || '', causeMessage: error?.message || String(error) }
    );
  }
}

function receiptFromRow(row, replayed) {
  const resultDocument = parseJson(row?.result_json, {}) || {};
  const receipt = resultDocument.receipt || {};
  return Object.freeze({
    status: String(row?.status || receipt.status || ''),
    replayed: replayed === true,
    commandId: String(row?.command_id || receipt.commandId || ''),
    authorityScope: String(row?.authority_scope || receipt.authorityScope || ''),
    idempotencyKey: String(row?.idempotency_key || receipt.idempotencyKey || ''),
    eventId: String(row?.last_event_id || receipt.eventId || ''),
    aggregateType: String(receipt.aggregateType || ''),
    aggregateId: String(receipt.aggregateId || ''),
    aggregateVersion: Number(row?.aggregate_version || receipt.aggregateVersion || 0),
    hostGeneration: Number(row?.host_generation || receipt.hostGeneration || 0),
    fencingToken: Number(row?.fencing_token || receipt.fencingToken || 0),
    committedAt: String(row?.committed_at || receipt.committedAt || ''),
    result: deepFreeze(resultDocument.result || {})
  });
}

function createProjectorDatabaseCapability(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Projector database capability requires a SQLite database');
  }
  let active = true;
  const statements = new Set();
  const assertActive = () => {
    if (!active) {
      throw coordinatorError(
        'AUTHORITY_PROJECTOR_CAPABILITY_EXPIRED',
        'Projector database capability expired when the transaction callback returned'
      );
    }
  };

  function wrapStatement(statement) {
    const facade = Object.freeze({
      run(...args) {
        assertActive();
        return statement.run(...args);
      },
      get(...args) {
        assertActive();
        return statement.get(...args);
      },
      all(...args) {
        assertActive();
        return statement.all(...args);
      },
      iterate(...args) {
        assertActive();
        return statement.iterate(...args);
      }
    });
    statements.add(facade);
    return facade;
  }

  const facade = Object.freeze({
    prepare(sql) {
      assertActive();
      const policy = validateProjectorSql(sql);
      return wrapStatement(db.prepare(policy.sql));
    },
    exec() {
      assertActive();
      throw coordinatorError(
        'AUTHORITY_PROJECTOR_SQL_FORBIDDEN',
        'Projector database capability cannot execute transaction or multi-statement SQL'
      );
    }
  });

  return Object.freeze({
    facade,
    revoke() {
      active = false;
      statements.clear();
    }
  });
}

class AuthorityTransactionCoordinator {
  constructor(options = {}) {
    if (!options.store || !options.store.db || typeof options.store.transaction !== 'function') {
      throw new TypeError('AuthorityTransactionCoordinator requires an AuthorityWriteHost store');
    }
    this.store = options.store;
    this.db = options.store.db;
    this.eventBus = options.eventBus || null;
    this.clock = typeof options.clock === 'function' ? options.clock : (() => Date.now());
    this.onTransactionTelemetry = typeof options.onTransactionTelemetry === 'function'
      ? options.onTransactionTelemetry
      : (() => {});
  }

  tokenSnapshot() {
    this.store.assertOwnership();
    const capability = this.store.authorityWriteHostCapability;
    if (!capability || typeof capability.tokenSnapshot !== 'function') {
      throw coordinatorError(
        'AUTHORITY_WRITE_HOST_CAPABILITY_REQUIRED',
        'Coordinator store has no current AuthorityWriteHost capability'
      );
    }
    const token = capability.tokenSnapshot();
    const hostId = String(token?.instanceId || '').trim();
    if (!hostId
      || !Number.isSafeInteger(Number(token?.hostGeneration))
      || Number(token.hostGeneration) < 1
      || !Number.isSafeInteger(Number(token?.fencingToken))
      || Number(token.fencingToken) < 1) {
      throw coordinatorError('AUTHORITY_WRITE_HOST_CAPABILITY_INVALID', 'Coordinator host token is invalid');
    }
    return Object.freeze({
      hostId,
      hostGeneration: Number(token.hostGeneration),
      fencingToken: Number(token.fencingToken)
    });
  }

  existingReceipt(authorityScope, idempotencyKey) {
    return this.db.prepare(`SELECT * FROM authority_command_receipts
      WHERE authority_scope=? AND idempotency_key=?`).get(authorityScope, idempotencyKey) || null;
  }

  assertIdempotency(existing, command) {
    const document = parseJson(existing.result_json, {}) || {};
    if (String(document.commandContentSha256 || '') !== command.contentSha256) {
      throw coordinatorError(
        'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT',
        'The idempotency key already belongs to different command content',
        {
          authorityScope: command.authorityScope,
          idempotencyKey: command.idempotencyKey,
          existingCommandId: String(existing.command_id || ''),
          incomingCommandId: command.commandId,
          existingContentSha256: String(document.commandContentSha256 || ''),
          incomingContentSha256: command.contentSha256
        }
      );
    }
    return receiptFromRow(existing, true);
  }

  observe(observation) {
    try {
      this.onTransactionTelemetry(Object.freeze({ ...observation }));
    } catch (_) {}
  }

  execute(input = {}) {
    const startedAtMs = Number(this.clock());
    const command = assertAuthorityCommandEnvelope(input.command);
    const event = normalizeEvent(input.event);
    const projector = normalizeProjector(input.projector);
    const token = this.tokenSnapshot();
    let committed;
    let notificationPublished = false;

    try {
      committed = this.store.transaction(() => runWithAuthorityWriteTransaction({
        commandId: command.commandId,
        authorityScope: command.authorityScope,
        startedAtMs: Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : Date.now(),
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken
      }, () => {
        const existing = this.existingReceipt(command.authorityScope, command.idempotencyKey);
        if (existing) return { receipt: this.assertIdempotency(existing, command), replayed: true };

        const recordedAt = new Date(Number.isFinite(startedAtMs) ? startedAtMs : Date.now()).toISOString();
        const nextVersion = command.expectedVersion + 1;
        const ledgerSequence = Number(this.db.prepare(`
          SELECT COALESCE(MAX(ledger_sequence),0)+1 AS next_sequence
          FROM canonical_event_headers
        `).get()?.next_sequence || 1);
        const payloadId = `payload:${event.eventId}`;

        const insertHeader = this.db.prepare(`
          INSERT INTO canonical_event_headers(
            ledger_sequence,event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
            command_id,idempotency_key,trace_id,correlation_id,causation_id,platform,source_account_id,
            generation,occurred_at,recorded_at,payload_id,payload_sha256,redaction_version,schema_version,
            canonicalization_version,writer_authority,host_generation,fencing_token,ledger_segment_id
          )
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE COALESCE((
            SELECT MAX(aggregate_version) FROM canonical_event_headers
            WHERE aggregate_type=? AND aggregate_id=?
          ),0)=?
            AND EXISTS(
              SELECT 1 FROM authority_write_host_lease
              WHERE singleton_id=1 AND owner_instance_id=?
                AND host_generation=? AND fencing_token=? AND state='ACTIVE'
            )
        `).run(
          ledgerSequence,
          event.eventId,
          event.eventType,
          command.aggregateType,
          command.aggregateId,
          nextVersion,
          command.commandId,
          command.idempotencyKey,
          command.traceId,
          command.correlationId,
          command.causationId,
          event.platform,
          event.sourceAccountId,
          event.generation,
          event.occurredAt,
          recordedAt,
          payloadId,
          event.payloadSha256,
          event.redactionVersion,
          event.schemaVersion,
          1,
          command.authorityScope,
          token.hostGeneration,
          token.fencingToken,
          event.ledgerSegmentId,
          command.aggregateType,
          command.aggregateId,
          command.expectedVersion,
          token.hostId,
          token.hostGeneration,
          token.fencingToken
        );

        if (Number(insertHeader.changes || 0) !== 1) {
          this.store.assertOwnership();
          const currentVersion = Number(this.db.prepare(`
            SELECT COALESCE(MAX(aggregate_version),0) AS version
            FROM canonical_event_headers WHERE aggregate_type=? AND aggregate_id=?
          `).get(command.aggregateType, command.aggregateId)?.version || 0);
          throw coordinatorError(
            'AUTHORITY_AGGREGATE_VERSION_CONFLICT',
            'Aggregate expected version did not match the current ledger version',
            {
              aggregateType: command.aggregateType,
              aggregateId: command.aggregateId,
              expectedVersion: command.expectedVersion,
              currentVersion
            }
          );
        }

        this.db.prepare(`INSERT INTO authority_payload_store(
          payload_id,classification,canonical_json,payload_sha256,encryption_key_ref,created_at
        ) VALUES(?,?,?,?,?,?)`).run(
          payloadId,
          event.payloadClassification,
          event.payloadCanonical,
          event.payloadSha256,
          '',
          recordedAt
        );

        const projectorCapability = createProjectorDatabaseCapability(this.db);
        let projectionOutput;
        try {
          projectionOutput = projector.apply(Object.freeze({
            db: projectorCapability.facade,
            eventId: event.eventId,
            eventType: event.eventType,
            ledgerSequence,
            aggregateType: command.aggregateType,
            aggregateId: command.aggregateId,
            aggregateVersion: nextVersion,
            command,
            payload: event.payload
          }));
          if (projectionOutput && typeof projectionOutput.then === 'function') {
            projectionOutput.catch?.(() => undefined);
            throw coordinatorError(
              'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN',
              'Authority transaction projector returned a Promise'
            );
          }
        } finally {
          projectorCapability.revoke();
        }

        if (!isPlainObject(projectionOutput)) {
          throw coordinatorError(
            'AUTHORITY_TRANSACTION_PROJECTOR_RESULT_INVALID',
            'Projector must return a plain result object'
          );
        }
        const stateHash = requiredString(projectionOutput.stateHash, 'projector.stateHash', 64).toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(stateHash)) {
          throw coordinatorError(
            'AUTHORITY_TRANSACTION_PROJECTOR_HASH_INVALID',
            'Projector stateHash must be SHA-256'
          );
        }
        const result = canonicalResult(projectionOutput.result || {});

        const checkpoint = this.db.prepare(`
          INSERT INTO projection_checkpoints_v2(
            projector_id,projector_version,ledger_sequence,lease_owner,generation,
            fencing_token,output_hash,lag,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(projector_id) DO UPDATE SET
            projector_version=excluded.projector_version,
            ledger_sequence=excluded.ledger_sequence,
            lease_owner=excluded.lease_owner,
            generation=excluded.generation,
            fencing_token=excluded.fencing_token,
            output_hash=excluded.output_hash,
            lag=excluded.lag,
            updated_at=excluded.updated_at
          WHERE projection_checkpoints_v2.ledger_sequence < excluded.ledger_sequence
        `).run(
          projector.projectorId,
          projector.projectorVersion,
          ledgerSequence,
          token.hostId,
          token.hostGeneration,
          token.fencingToken,
          stateHash,
          0,
          recordedAt
        );
        if (Number(checkpoint.changes || 0) !== 1) {
          throw coordinatorError(
            'AUTHORITY_PROJECTION_CHECKPOINT_STALE',
            'Projection checkpoint did not advance atomically',
            { projectorId: projector.projectorId, ledgerSequence }
          );
        }

        const receiptDocument = {
          commandContentSha256: command.contentSha256,
          receipt: {
            status: 'COMMITTED',
            commandId: command.commandId,
            authorityScope: command.authorityScope,
            idempotencyKey: command.idempotencyKey,
            eventId: event.eventId,
            aggregateType: command.aggregateType,
            aggregateId: command.aggregateId,
            aggregateVersion: nextVersion,
            hostGeneration: token.hostGeneration,
            fencingToken: token.fencingToken,
            committedAt: recordedAt
          },
          result
        };
        this.db.prepare(`INSERT INTO authority_command_receipts(
          command_id,authority_scope,idempotency_key,status,first_event_id,last_event_id,aggregate_version,
          host_generation,fencing_token,result_json,committed_at
        ) VALUES(?,?,?,'COMMITTED',?,?,?,?,?,?,?)`).run(
          command.commandId,
          command.authorityScope,
          command.idempotencyKey,
          event.eventId,
          event.eventId,
          nextVersion,
          token.hostGeneration,
          token.fencingToken,
          canonicalSerialize(receiptDocument),
          recordedAt
        );

        const row = this.db.prepare(
          'SELECT * FROM authority_command_receipts WHERE command_id=?'
        ).get(command.commandId);
        return { receipt: receiptFromRow(row, false), replayed: false };
      }));
    } catch (error) {
      const finishedAtMs = Number(this.clock());
      this.observe({
        status: 'ROLLED_BACK',
        commandId: command.commandId,
        authorityScope: command.authorityScope,
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken,
        durationMs: Math.max(
          0,
          (Number.isFinite(finishedAtMs) ? finishedAtMs : startedAtMs) - startedAtMs
        ),
        reasonCode: String(error?.code || 'AUTHORITY_TRANSACTION_FAILED')
      });
      throw error;
    }

    const finishedAtMs = Number(this.clock());
    this.observe({
      status: committed.replayed ? 'REPLAYED' : 'COMMITTED',
      commandId: command.commandId,
      authorityScope: command.authorityScope,
      hostGeneration: token.hostGeneration,
      fencingToken: token.fencingToken,
      durationMs: Math.max(
        0,
        (Number.isFinite(finishedAtMs) ? finishedAtMs : startedAtMs) - startedAtMs
      ),
      reasonCode: ''
    });

    if (!committed.replayed && this.eventBus && typeof this.eventBus.publish === 'function') {
      try {
        this.eventBus.publish('canonical-event:committed', Object.freeze({
          commandId: committed.receipt.commandId,
          eventId: committed.receipt.eventId,
          aggregateType: committed.receipt.aggregateType,
          aggregateId: committed.receipt.aggregateId,
          aggregateVersion: committed.receipt.aggregateVersion,
          hostGeneration: committed.receipt.hostGeneration,
          fencingToken: committed.receipt.fencingToken
        }));
        notificationPublished = true;
      } catch (error) {
        this.observe({
          status: 'POST_COMMIT_NOTIFICATION_FAILED',
          commandId: command.commandId,
          authorityScope: command.authorityScope,
          hostGeneration: token.hostGeneration,
          fencingToken: token.fencingToken,
          durationMs: Math.max(0, Number(this.clock()) - startedAtMs),
          reasonCode: String(error?.code || 'POST_COMMIT_NOTIFICATION_FAILED')
        });
      }
    }

    return Object.freeze({ ...committed.receipt, notificationPublished });
  }
}

module.exports = {
  AuthorityTransactionCoordinator,
  createProjectorDatabaseCapability,
  coordinatorError
};
