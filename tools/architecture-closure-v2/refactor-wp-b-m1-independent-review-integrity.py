#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return source.replace(before, after, 1)


def regex_replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one regex match, found {count}")
    return updated


def update_migration_engine() -> None:
    path = "backend/migrations/architectureClosureV2WpBEngine.js"
    source = read(path)

    source = replace_once(
        source,
        "const APPEND_ONLY_TABLES = Object.freeze([\n",
        """const EXTERNAL_ACTION_RECEIPT_COLUMNS = Object.freeze([
  'receipt_id',
  'intent_id',
  'attempt_id',
  'receipt_type',
  'provider_receipt_id',
  'evidence_reference',
  'receipt_content_sha256',
  'result_json',
  'authority_timestamp',
  'created_at'
]);
const EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS = Object.freeze([
  'reconciliation_id',
  'intent_id',
  'attempt_id',
  'observation_outcome',
  'evidence_reference',
  'remote_receipt_id',
  'observation_json',
  'reconciliation_content_sha256',
  'content_hash_version',
  'observed_at',
  'authority_timestamp',
  'created_at'
]);
const APPEND_ONLY_TABLES = Object.freeze([
""",
        "migration column contracts",
    )

    source = replace_once(
        source,
        "  durableExecutionStates: DURABLE_EXECUTION_STATES,\n  appendOnlyTables: APPEND_ONLY_TABLES,\n",
        """  durableExecutionStates: DURABLE_EXECUTION_STATES,
  externalActionReceiptColumns: EXTERNAL_ACTION_RECEIPT_COLUMNS,
  externalOutcomeReconciliationColumns: EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS,
  attemptIntentBindingPolicy: 'COMPOSITE_ATTEMPT_INTENT_FOREIGN_KEY',
  reconciliationHashPolicy: 'VERSION_ONE_SHA256_REQUIRED',
  appendOnlyTables: APPEND_ONLY_TABLES,
""",
        "migration schema contract",
    )

    source = replace_once(
        source,
        """      UNIQUE(intent_id,attempt_sequence),
      UNIQUE(intent_id,claim_id,generation)
""",
        """      UNIQUE(intent_id,attempt_sequence),
      UNIQUE(intent_id,claim_id,generation),
      UNIQUE(attempt_id,intent_id)
""",
        "attempt composite key",
    )

    source = regex_replace_once(
        source,
        r"""    CREATE TABLE external_action_receipts\(
.*?
    \) STRICT;""",
        """    CREATE TABLE external_action_receipts(
      receipt_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      attempt_id TEXT,
      receipt_type TEXT NOT NULL CHECK(receipt_type IN (
        'SUCCESS','FAILURE','UNKNOWN','LATE_RESULT','MANUAL_RESOLUTION'
      )),
      provider_receipt_id TEXT NOT NULL DEFAULT '',
      evidence_reference TEXT NOT NULL,
      receipt_content_sha256 TEXT NOT NULL CHECK(length(receipt_content_sha256)=64),
      result_json TEXT NOT NULL DEFAULT '{}',
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      FOREIGN KEY(attempt_id,intent_id)
        REFERENCES external_action_attempts(attempt_id,intent_id) ON DELETE RESTRICT,
      CHECK(lower(receipt_content_sha256)=receipt_content_sha256),
      CHECK(receipt_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      CHECK(
        (receipt_type='MANUAL_RESOLUTION' AND attempt_id IS NULL)
        OR
        (receipt_type<>'MANUAL_RESOLUTION' AND attempt_id IS NOT NULL)
      ),
      UNIQUE(intent_id,receipt_content_sha256)
    ) STRICT;""",
        "receipt table",
    )

    source = replace_once(
        source,
        "      ON external_action_receipts(attempt_id,created_at,receipt_id) WHERE attempt_id<>'';\n",
        "      ON external_action_receipts(attempt_id,created_at,receipt_id) WHERE attempt_id IS NOT NULL;\n",
        "receipt attempt index",
    )

    source = regex_replace_once(
        source,
        r"""    CREATE TABLE external_outcome_reconciliations\(
.*?
    \) STRICT;""",
        """    CREATE TABLE external_outcome_reconciliations(
      reconciliation_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      observation_outcome TEXT NOT NULL CHECK(observation_outcome IN (
        'REMOTE_SUCCESS_PROVEN','REMOTE_ABSENCE_PROVEN','REMOTE_RESULT_UNKNOWN'
      )),
      evidence_reference TEXT NOT NULL,
      remote_receipt_id TEXT NOT NULL DEFAULT '',
      observation_json TEXT NOT NULL DEFAULT '{}',
      reconciliation_content_sha256 TEXT NOT NULL CHECK(length(reconciliation_content_sha256)=64),
      content_hash_version INTEGER NOT NULL CHECK(content_hash_version=1),
      observed_at TEXT NOT NULL,
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      FOREIGN KEY(attempt_id,intent_id)
        REFERENCES external_action_attempts(attempt_id,intent_id) ON DELETE RESTRICT,
      CHECK(lower(reconciliation_content_sha256)=reconciliation_content_sha256),
      CHECK(reconciliation_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE(intent_id,reconciliation_content_sha256)
    ) STRICT;""",
        "reconciliation table",
    )

    source = replace_once(
        source,
        "  ensureExactColumns(db, 'durable_executions', DURABLE_EXECUTION_COLUMNS);\n\n",
        """  ensureExactColumns(db, 'durable_executions', DURABLE_EXECUTION_COLUMNS);
  ensureExactColumns(db, 'external_action_receipts', EXTERNAL_ACTION_RECEIPT_COLUMNS);
  ensureExactColumns(
    db,
    'external_outcome_reconciliations',
    EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS
  );

""",
        "exact fact columns",
    )

    source = replace_once(
        source,
        "  DURABLE_EXECUTION_COLUMNS,\n  APPEND_ONLY_TABLES,\n",
        """  DURABLE_EXECUTION_COLUMNS,
  EXTERNAL_ACTION_RECEIPT_COLUMNS,
  EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS,
  APPEND_ONLY_TABLES,
""",
        "migration exports",
    )
    write(path, source)


def update_migration_wrapper() -> None:
    path = "backend/migrations/architectureClosureV2WpB.js"
    source = read(path)

    source = replace_once(
        source,
        "  Object.freeze({ table: 'external_action_receipts', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),\n",
        """  Object.freeze({ table: 'external_action_receipts', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),
  Object.freeze({ table: 'external_action_receipts', from: 'attempt_id', target: 'external_action_attempts', to: 'attempt_id' }),
""",
        "receipt attempt foreign key fact",
    )

    source = replace_once(
        source,
        "]);\n\nfunction foreignKeyError",
        """]);
const REQUIRED_COMPOSITE_FOREIGN_KEYS = Object.freeze([
  Object.freeze({
    table: 'external_action_receipts',
    target: 'external_action_attempts',
    columns: Object.freeze([
      Object.freeze({ from: 'attempt_id', to: 'attempt_id' }),
      Object.freeze({ from: 'intent_id', to: 'intent_id' })
    ])
  }),
  Object.freeze({
    table: 'external_outcome_reconciliations',
    target: 'external_action_attempts',
    columns: Object.freeze([
      Object.freeze({ from: 'attempt_id', to: 'attempt_id' }),
      Object.freeze({ from: 'intent_id', to: 'intent_id' })
    ])
  })
]);

function foreignKeyError""",
        "composite foreign key contract",
    )

    source = replace_once(
        source,
        """  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => Object.freeze({
    table: String(row.table || ''),
    from: String(row.from || ''),
    to: String(row.to || '')
  }));
}
""",
        """  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => Object.freeze({
    id: Number(row.id),
    sequence: Number(row.seq),
    table: String(row.table || ''),
    from: String(row.from || ''),
    to: String(row.to || '')
  }));
}

function hasCompositeForeignKey(db, expected) {
  const groups = new Map();
  for (const row of normalizedForeignKeyRows(db, expected.table)) {
    const rows = groups.get(row.id) || [];
    rows.push(row);
    groups.set(row.id, rows);
  }
  return [...groups.values()].some(rows => {
    const ordered = [...rows].sort((left, right) => left.sequence - right.sequence);
    return ordered.length === expected.columns.length
      && ordered.every((row, index) => row.table === expected.target
        && row.from === expected.columns[index].from
        && row.to === expected.columns[index].to);
  });
}
""",
        "composite foreign key detector",
    )

    source = replace_once(
        source,
        """  if (contractViolations.length > 0) {
""",
        """  for (const expected of REQUIRED_COMPOSITE_FOREIGN_KEYS) {
    if (!hasCompositeForeignKey(db, expected)) {
      contractViolations.push(Object.freeze({
        ...expected,
        code: 'COMPOSITE_ATTEMPT_INTENT_FOREIGN_KEY_MISSING',
        actual: Object.freeze(normalizedForeignKeyRows(db, expected.table))
      }));
    }
  }

  if (contractViolations.length > 0) {
""",
        "composite foreign key validation",
    )

    source = replace_once(
        source,
        "  return Object.freeze({ ok: true, requiredForeignKeyCount: REQUIRED_FOREIGN_KEYS.length });\n",
        """  return Object.freeze({
    ok: true,
    requiredForeignKeyCount: REQUIRED_FOREIGN_KEYS.length,
    requiredCompositeForeignKeyCount: REQUIRED_COMPOSITE_FOREIGN_KEYS.length
  });
""",
        "foreign key report",
    )

    source = replace_once(
        source,
        "  REQUIRED_FOREIGN_KEYS,\n  ensureForeignKeyIntegrity,\n",
        """  REQUIRED_FOREIGN_KEYS,
  REQUIRED_COMPOSITE_FOREIGN_KEYS,
  ensureForeignKeyIntegrity,
""",
        "wrapper exports",
    )
    write(path, source)


def update_outbox() -> None:
    path = "backend/services/externalActionOutboxAuthority.js"
    source = read(path)

    source = replace_once(
        source,
        "const RECEIPT_TYPES = Object.freeze({\n",
        """const RECONCILIATION_OUTCOMES = Object.freeze({
  REMOTE_SUCCESS_PROVEN: 'REMOTE_SUCCESS_PROVEN',
  REMOTE_ABSENCE_PROVEN: 'REMOTE_ABSENCE_PROVEN',
  REMOTE_RESULT_UNKNOWN: 'REMOTE_RESULT_UNKNOWN'
});
const RECONCILIATION_OUTCOME_VALUES = new Set(Object.values(RECONCILIATION_OUTCOMES));
const RECEIPT_TYPES = Object.freeze({
""",
        "reconciliation outcome constants",
    )

    source = replace_once(
        source,
        """function receiptSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    receiptId: String(row.receipt_id || ''),
    intentId: String(row.intent_id || ''),
    attemptId: String(row.attempt_id || ''),
    receiptType: String(row.receipt_type || ''),
    providerReceiptId: String(row.provider_receipt_id || ''),
    evidenceReference: String(row.evidence_reference || ''),
    receiptContentSha256: String(row.receipt_content_sha256 || ''),
    result: canonicalPlainData(parseJson(row.result_json, {}), 'persistedReceipt.result'),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || '')
  });
}
""",
        """function receiptSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    receiptId: String(row.receipt_id || ''),
    intentId: String(row.intent_id || ''),
    attemptId: String(row.attempt_id || ''),
    receiptType: String(row.receipt_type || ''),
    providerReceiptId: String(row.provider_receipt_id || ''),
    evidenceReference: String(row.evidence_reference || ''),
    receiptContentSha256: String(row.receipt_content_sha256 || ''),
    result: canonicalPlainData(parseJson(row.result_json, {}), 'persistedReceipt.result'),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || '')
  });
}

function reconciliationSnapshot(row = {}) {
  return deepFreeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    reconciliationId: String(row.reconciliation_id || ''),
    intentId: String(row.intent_id || ''),
    attemptId: String(row.attempt_id || ''),
    observationOutcome: String(row.observation_outcome || ''),
    evidenceReference: String(row.evidence_reference || ''),
    remoteReceiptId: String(row.remote_receipt_id || ''),
    observation: canonicalPlainData(
      parseJson(row.observation_json, {}),
      'persistedReconciliation.observation'
    ),
    reconciliationContentSha256: String(row.reconciliation_content_sha256 || ''),
    contentHashVersion: Number(row.content_hash_version || 0),
    observedAt: String(row.observed_at || ''),
    authorityTimestamp: String(row.authority_timestamp || ''),
    createdAt: String(row.created_at || '')
  });
}
""",
        "reconciliation snapshot",
    )

    source = regex_replace_once(
        source,
        r"""  recordTerminalReceipt\(input, receiptType, targetState\) \{
.*?
  \}

  recordLateResult\(input = \{\}\) \{""",
        """  recordTerminalReceipt(input, receiptType, targetState) {
    const facts = this.normalizeClaimFacts(input, `record${receiptType}`);
    const attemptId = requiredString(input.attemptId, 'attemptId');
    const providerReceiptId = optionalString(input.providerReceiptId, 'providerReceiptId');
    const evidenceReference = requiredString(input.evidenceReference, 'evidenceReference');
    const resultDocument = canonicalPlainData(input.result || {}, 'result');
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const receiptContentSha256 = canonicalHash({
      schemaVersion: 1,
      receiptType,
      intentId: facts.intentId,
      attemptId,
      providerReceiptId,
      evidenceReference,
      result: resultDocument,
      authorityTimestamp
    });
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_action_receipts
        WHERE intent_id=? AND receipt_content_sha256=?`).get(facts.intentId, receiptContentSha256);
      if (existing) return receiptSnapshot(existing);

      const update = store.db.prepare(`UPDATE external_action_claims SET
          state=?,state_version=state_version+1,updated_at=?
        WHERE intent_id=? AND state='ATTEMPTED' AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND lease_expires_at>=?
          AND EXISTS(
            SELECT 1 FROM external_action_attempts
            WHERE attempt_id=? AND intent_id=? AND claim_id=? AND generation=?
              AND host_generation=? AND fencing_token=?
          )
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        authorityTimestamp,
        facts.intentId,
        facts.stateVersion,
        facts.generation,
        facts.ownerId,
        facts.claimId,
        facts.hostGeneration,
        facts.fencingToken,
        authorityTimestamp,
        attemptId,
        facts.intentId,
        facts.claimId,
        facts.generation,
        facts.hostGeneration,
        facts.fencingToken,
        facts.hostId,
        facts.hostGeneration,
        facts.fencingToken
      );
      if (Number(update.changes || 0) !== 1) {
        throw outboxError('WP_B_OUTBOX_RECEIPT_CAS_REJECTED', 'External action receipt CAS rejected', {
          intentId: facts.intentId,
          attemptId,
          receiptType
        });
      }

      const receiptId = optionalString(input.receiptId, 'receiptId') || this.idFactory('external-receipt');
      const inserted = store.db.prepare(`INSERT INTO external_action_receipts(
          receipt_id,intent_id,attempt_id,receipt_type,provider_receipt_id,evidence_reference,
          receipt_content_sha256,result_json,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        receiptId,
        receiptType,
        providerReceiptId,
        evidenceReference,
        receiptContentSha256,
        canonicalSerialize(resultDocument),
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        facts.intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_OUTBOX_ATTEMPT_BINDING_REJECTED',
          'External action receipt attempt does not belong to the claimed intent',
          { intentId: facts.intentId, attemptId }
        );
      }
      return receiptSnapshot(store.db.prepare(
        'SELECT * FROM external_action_receipts WHERE receipt_id=?'
      ).get(receiptId));
    });
  }

  recordReconciliation(input = {}) {
    const reconciliationId = optionalString(input.reconciliationId, 'reconciliationId')
      || this.idFactory('external-reconciliation');
    const intentId = requiredString(input.intentId, 'intentId');
    const attemptId = requiredString(input.attemptId, 'attemptId');
    const observationOutcome = requiredString(
      input.observationOutcome || input.outcome,
      'observationOutcome',
      64
    );
    if (!RECONCILIATION_OUTCOME_VALUES.has(observationOutcome)) {
      throw outboxError(
        'WP_B_RECONCILIATION_OUTCOME_INVALID',
        'External outcome reconciliation has an unregistered outcome',
        { observationOutcome }
      );
    }
    const evidenceReference = requiredString(input.evidenceReference, 'evidenceReference');
    const remoteReceiptId = optionalString(input.remoteReceiptId, 'remoteReceiptId');
    const observation = canonicalPlainData(input.observation || {}, 'observation');
    const observedAt = normalizedTimestamp(input.observedAt, 'observedAt');
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp, 'authorityTimestamp');
    const reconciliationContentSha256 = canonicalHash({
      schemaVersion: 1,
      intentId,
      attemptId,
      observationOutcome,
      evidenceReference,
      remoteReceiptId,
      observation,
      observedAt,
      authorityTimestamp
    });
    const store = this.store();
    this.assertSchema23(store);
    return store.transaction(() => {
      const existing = store.db.prepare(`SELECT * FROM external_outcome_reconciliations
        WHERE intent_id=? AND reconciliation_content_sha256=?`)
        .get(intentId, reconciliationContentSha256);
      if (existing) return reconciliationSnapshot(existing);

      const inserted = store.db.prepare(`INSERT INTO external_outcome_reconciliations(
          reconciliation_id,intent_id,attempt_id,observation_outcome,evidence_reference,
          remote_receipt_id,observation_json,reconciliation_content_sha256,
          content_hash_version,observed_at,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,1,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        reconciliationId,
        observationOutcome,
        evidenceReference,
        remoteReceiptId,
        canonicalSerialize(observation),
        reconciliationContentSha256,
        observedAt,
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_RECONCILIATION_ATTEMPT_BINDING_REJECTED',
          'External outcome reconciliation attempt does not belong to its intent',
          { intentId, attemptId }
        );
      }
      return reconciliationSnapshot(store.db.prepare(
        'SELECT * FROM external_outcome_reconciliations WHERE reconciliation_id=?'
      ).get(reconciliationId));
    });
  }

  recordLateResult(input = {}) {""",
        "terminal receipt and reconciliation methods",
    )

    source = replace_once(
        source,
        """      store.db.prepare(`INSERT INTO external_action_receipts(
        receipt_id,intent_id,attempt_id,receipt_type,provider_receipt_id,evidence_reference,
        receipt_content_sha256,result_json,authority_timestamp,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        receiptId,
        intentId,
        attemptId,
        RECEIPT_TYPES.LATE_RESULT,
        providerReceiptId,
        evidenceReference,
        receiptContentSha256,
        canonicalSerialize(resultDocument),
        authorityTimestamp,
        authorityTimestamp
      );
""",
        """      const inserted = store.db.prepare(`INSERT INTO external_action_receipts(
          receipt_id,intent_id,attempt_id,receipt_type,provider_receipt_id,evidence_reference,
          receipt_content_sha256,result_json,authority_timestamp,created_at
        )
        SELECT ?,a.intent_id,a.attempt_id,?,?,?,?,?,?,?
        FROM external_action_attempts a
        WHERE a.attempt_id=? AND a.intent_id=?`).run(
        receiptId,
        RECEIPT_TYPES.LATE_RESULT,
        providerReceiptId,
        evidenceReference,
        receiptContentSha256,
        canonicalSerialize(resultDocument),
        authorityTimestamp,
        authorityTimestamp,
        attemptId,
        intentId
      );
      if (Number(inserted.changes || 0) !== 1) {
        throw outboxError(
          'WP_B_OUTBOX_ATTEMPT_BINDING_REJECTED',
          'Late-result attempt does not belong to the supplied intent',
          { intentId, attemptId }
        );
      }
""",
        "late result binding",
    )

    source = replace_once(
        source,
        "  RECEIPT_TYPES,\n  ExternalActionOutboxAuthority,\n",
        """  RECEIPT_TYPES,
  RECONCILIATION_OUTCOMES,
  ExternalActionOutboxAuthority,
""",
        "outbox exports",
    )
    write(path, source)


def update_reconciliation() -> None:
    path = "backend/services/externalOutcomeReconciliation.js"
    source = read(path)

    source = regex_replace_once(
        source,
        r"""function reconcileExternalOutcome\(options = \{\}\) \{
.*?
\}

function createManualResolutionReceipt""",
        """function reconcileExternalOutcome(options = {}) {
  if (!isPlainObject(options)) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_OPTIONS_INVALID',
      'Reconciliation options must be a plain object'
    );
  }
  const intentId = requiredString(
    options.intentId,
    'intentId',
    'WP_B_RECONCILIATION_FIELD_REQUIRED'
  );
  const attemptId = requiredString(
    options.attemptId,
    'attemptId',
    'WP_B_RECONCILIATION_FIELD_REQUIRED'
  );
  const observation = normalizeReconciliationObservation(options.observation);
  const authorityTimestamp = normalizeTimestamp(
    options.authorityTimestamp,
    'authorityTimestamp',
    'WP_B_RECONCILIATION_AUTHORITY_TIMESTAMP_INVALID'
  );

  if (typeof options.transaction !== 'function') {
    throw reconciliationError(
      'WP_B_RECONCILIATION_TRANSACTION_REQUIRED',
      'Reconciliation requires one Authority transaction for its durable observation'
    );
  }
  if (typeof options.recordReconciliation !== 'function') {
    throw reconciliationError(
      'WP_B_RECONCILIATION_RECORD_REQUIRED',
      'Reconciliation requires the durable recordReconciliation authority'
    );
  }
  if (observation.outcome === OUTCOMES.REMOTE_SUCCESS_PROVEN) {
    if (typeof options.recordReceipt !== 'function') {
      throw reconciliationError(
        'WP_B_RECONCILIATION_RECORD_RECEIPT_REQUIRED',
        'Remote success requires the durable recordReceipt authority'
      );
    }
    if (typeof options.transitionExecution !== 'function') {
      throw reconciliationError(
        'WP_B_RECONCILIATION_TRANSITION_REQUIRED',
        'Remote success requires the durable execution transition authority'
      );
    }
  }

  return assertSynchronous(options.transaction(() => {
    const persistedReconciliation = assertSynchronous(
      options.recordReconciliation(deepFreeze({
        schemaVersion: 1,
        authority: 'ExternalOutcomeReconciliation',
        intentId,
        attemptId,
        observationOutcome: observation.outcome,
        evidenceReference: observation.evidenceReference,
        remoteReceiptId: observation.remoteReceiptId,
        observation: deepFreeze({
          provider: observation.provider,
          operationId: observation.operationId,
          result: observation.result
        }),
        observedAt: observation.observedAt,
        authorityTimestamp
      })),
      'recordReconciliation'
    );
    const reconciliationId = requiredString(
      persistedReconciliation?.reconciliationId,
      'recordReconciliation.reconciliationId',
      'WP_B_RECONCILIATION_TRUSTED_RECORD_INVALID'
    );

    if (observation.outcome !== OUTCOMES.REMOTE_SUCCESS_PROVEN) {
      return deepFreeze({
        schemaVersion: 1,
        authority: 'ExternalOutcomeReconciliation',
        operationId: observation.operationId,
        outcome: observation.outcome,
        terminal: false,
        state: observation.outcome === OUTCOMES.REMOTE_RESULT_UNKNOWN
          ? 'REMOTE_RESULT_UNKNOWN'
          : 'REMOTE_ABSENCE_PROVEN',
        retryAllowed: canScheduleAnotherAttempt(observation.outcome),
        reconciliationId,
        authorityTimestamp
      });
    }

    const trustedReceipt = deepFreeze({
      schemaVersion: 1,
      receiptType: 'REMOTE_SUCCESS_PROVEN',
      authority: 'ExternalOutcomeReconciliation',
      operationId: observation.operationId,
      provider: observation.provider,
      remoteReceiptId: observation.remoteReceiptId,
      evidenceReference: observation.evidenceReference,
      observedAt: observation.observedAt,
      authorityTimestamp,
      result: observation.result,
      appendOnly: true
    });
    const persisted = assertSynchronous(options.recordReceipt(trustedReceipt), 'recordReceipt');
    const trustedReceiptId = requiredString(
      persisted?.receiptId,
      'recordReceipt.receiptId',
      'WP_B_RECONCILIATION_TRUSTED_RECEIPT_INVALID'
    );
    const transition = deepFreeze({
      schemaVersion: 1,
      authority: 'DurableExecutionAuthority',
      operationId: observation.operationId,
      state: 'SUCCEEDED',
      trustedReceiptId,
      authorityTimestamp
    });
    assertSynchronous(options.transitionExecution(transition), 'transitionExecution');

    return deepFreeze({
      schemaVersion: 1,
      authority: 'ExternalOutcomeReconciliation',
      operationId: observation.operationId,
      outcome: observation.outcome,
      terminal: true,
      state: 'SUCCEEDED',
      retryAllowed: false,
      reconciliationId,
      trustedReceiptId,
      authorityTimestamp
    });
  }), 'transaction');
}

function createManualResolutionReceipt""",
        "reconciliation orchestration",
    )
    write(path, source)


def update_uncertain_tests() -> None:
    path = "backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js"
    content = """'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function reconciliationModule() {
  delete require.cache[require.resolve('../../../services/externalOutcomeReconciliation')];
  return require('../../../services/externalOutcomeReconciliation');
}

function provenSuccess() {
  return {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    provider: 'facebook',
    operationId: 'operation-1',
    evidenceReference: 'provider-receipt:remote-1',
    remoteReceiptId: 'remote-1',
    observedAt: '2026-08-03T02:45:00.000Z',
    result: { postId: 'post-1' }
  };
}

test('reconciliation accepts only success, absence or unknown observations', () => {
  const { OUTCOMES, normalizeReconciliationObservation } = reconciliationModule();
  assert.deepEqual(OUTCOMES, {
    REMOTE_SUCCESS_PROVEN: 'REMOTE_SUCCESS_PROVEN',
    REMOTE_ABSENCE_PROVEN: 'REMOTE_ABSENCE_PROVEN',
    REMOTE_RESULT_UNKNOWN: 'REMOTE_RESULT_UNKNOWN'
  });
  assert.throws(
    () => normalizeReconciliationObservation({ outcome: 'FAILED' }),
    error => error?.code === 'WP_B_RECONCILIATION_OUTCOME_INVALID'
  );
});

test('normalized observations are exact, canonical and deeply immutable', () => {
  const { normalizeReconciliationObservation } = reconciliationModule();
  const observation = normalizeReconciliationObservation(provenSuccess());
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.result), true);
  assert.equal(observation.observedAt, '2026-08-03T02:45:00.000Z');
  assert.throws(
    () => normalizeReconciliationObservation({ ...provenSuccess(), unregistered: true }),
    error => error?.code === 'WP_B_RECONCILIATION_OBSERVATION_INVALID'
  );
  assert.throws(
    () => normalizeReconciliationObservation({ ...provenSuccess(), remoteReceiptId: '' }),
    error => error?.code === 'WP_B_RECONCILIATION_PROOF_REQUIRED'
  );
});

test('remote success persists reconciliation and receipt before terminal transition in one transaction', () => {
  const { reconcileExternalOutcome } = reconciliationModule();
  const calls = [];
  const result = reconcileExternalOutcome({
    intentId: 'intent-1',
    attemptId: 'attempt-1',
    observation: provenSuccess(),
    authorityTimestamp: '2026-08-03T02:45:01.000Z',
    transaction(callback) {
      calls.push(['transaction-begin']);
      const value = callback();
      calls.push(['transaction-commit']);
      return value;
    },
    recordReconciliation(reconciliation) {
      calls.push(['recordReconciliation', reconciliation]);
      return { reconciliationId: 'reconciliation-1' };
    },
    recordReceipt(receipt) {
      calls.push(['recordReceipt', receipt]);
      return { receiptId: 'trusted-receipt-1' };
    },
    transitionExecution(transition) {
      calls.push(['transitionExecution', transition]);
      return { state: transition.state };
    }
  });

  assert.deepEqual(calls.map(([name]) => name), [
    'transaction-begin',
    'recordReconciliation',
    'recordReceipt',
    'transitionExecution',
    'transaction-commit'
  ]);
  assert.equal(calls[3][1].state, 'SUCCEEDED');
  assert.equal(calls[3][1].trustedReceiptId, 'trusted-receipt-1');
  assert.equal(result.reconciliationId, 'reconciliation-1');
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(Object.isFrozen(result), true);
});

test('receipt persistence failure prevents a terminal transition', () => {
  const { reconcileExternalOutcome } = reconciliationModule();
  let transitionCount = 0;
  assert.throws(
    () => reconcileExternalOutcome({
      intentId: 'intent-1',
      attemptId: 'attempt-1',
      observation: provenSuccess(),
      authorityTimestamp: '2026-08-03T02:45:01.000Z',
      transaction(callback) { return callback(); },
      recordReconciliation() { return { reconciliationId: 'reconciliation-1' }; },
      recordReceipt() {
        throw Object.assign(new Error('storage failed'), { code: 'STORAGE_FAILED' });
      },
      transitionExecution() {
        transitionCount += 1;
      }
    }),
    error => error?.code === 'STORAGE_FAILED'
  );
  assert.equal(transitionCount, 0);
});

test('remote absence is the only observation that permits another physical attempt', () => {
  const { canScheduleAnotherAttempt, OUTCOMES } = reconciliationModule();
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_ABSENCE_PROVEN), true);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_SUCCESS_PROVEN), false);
  assert.equal(canScheduleAnotherAttempt(OUTCOMES.REMOTE_RESULT_UNKNOWN), false);
  assert.throws(
    () => canScheduleAnotherAttempt('FAILED'),
    error => error?.code === 'WP_B_RECONCILIATION_OUTCOME_INVALID'
  );
});

test('absence and unknown outcomes persist one reconciliation and remain nonterminal', () => {
  const { reconcileExternalOutcome, OUTCOMES } = reconciliationModule();
  for (const [outcome, retryAllowed] of [
    [OUTCOMES.REMOTE_ABSENCE_PROVEN, true],
    [OUTCOMES.REMOTE_RESULT_UNKNOWN, false]
  ]) {
    const calls = [];
    const result = reconcileExternalOutcome({
      intentId: 'intent-1',
      attemptId: 'attempt-1',
      observation: {
        outcome,
        provider: 'facebook',
        operationId: 'operation-1',
        evidenceReference: 'query:remote-1',
        observedAt: '2026-08-03T02:45:00.000Z',
        result: {}
      },
      authorityTimestamp: '2026-08-03T02:45:01.000Z',
      transaction(callback) {
        calls.push('transaction-begin');
        const value = callback();
        calls.push('transaction-commit');
        return value;
      },
      recordReconciliation() {
        calls.push('recordReconciliation');
        return { reconciliationId: `reconciliation-${outcome}` };
      },
      recordReceipt() { calls.push('recordReceipt'); },
      transitionExecution() { calls.push('transitionExecution'); }
    });
    assert.deepEqual(calls, [
      'transaction-begin',
      'recordReconciliation',
      'transaction-commit'
    ]);
    assert.equal(result.terminal, false);
    assert.equal(result.retryAllowed, retryAllowed);
    assert.equal(result.reconciliationId, `reconciliation-${outcome}`);
  }
});

test('manual resolution is an append-only deeply immutable receipt', () => {
  const { createManualResolutionReceipt } = reconciliationModule();
  const receipt = createManualResolutionReceipt({
    operationId: 'operation-1',
    outcome: 'REMOTE_ABSENCE_PROVEN',
    actor: 'operator:alice',
    reasonCode: 'PROVIDER_CONFIRMED_ABSENCE',
    evidenceReference: 'ticket:123',
    authorityTimestamp: '2026-08-03T02:46:00.000Z'
  });
  assert.equal(receipt.receiptType, 'MANUAL_RESOLUTION');
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(receipt.appendOnly, true);
  assert.throws(
    () => createManualResolutionReceipt({
      operationId: 'operation-1',
      outcome: 'REMOTE_RESULT_UNKNOWN',
      actor: '',
      reasonCode: 'UNKNOWN',
      evidenceReference: 'ticket:123',
      authorityTimestamp: '2026-08-03T02:46:00.000Z'
    }),
    error => error?.code === 'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
  );
});
"""
    write(path, content)


def update_existing_tests() -> None:
    path = "backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js"
    source = read(path)
    source = replace_once(
        source,
        """    'createIntent', 'claimIntent', 'startAttempt', 'recordReceipt',
    'recordFailureReceipt', 'markUncertain', 'recordLateResult'
""",
        """    'createIntent', 'claimIntent', 'startAttempt', 'recordReceipt',
    'recordFailureReceipt', 'markUncertain', 'recordReconciliation', 'recordLateResult'
""",
        "outbox method contract",
    )
    write(path, source)

    path = "backend/tests/architectureClosureV2/wpB/schema23StartupRegistration.test.js"
    source = read(path)
    source = regex_replace_once(
        source,
        r"""test\('remote success reconciliation requires one caller-supplied authority transaction', \(\) => \{
.*?
\}\);

test\('real SQLite reclaim""",
        """test('remote success reconciliation requires one caller-supplied authority transaction', () => {
  const modulePath = require.resolve('../../../services/externalOutcomeReconciliation');
  delete require.cache[modulePath];
  const { reconcileExternalOutcome } = require(modulePath);
  const observation = {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    provider: 'facebook',
    operationId: 'operation-review-transaction',
    evidenceReference: 'provider-receipt:review-transaction',
    remoteReceiptId: 'remote-review-transaction',
    observedAt: '2026-08-03T05:10:00.000Z',
    result: { postId: 'post-review-transaction' }
  };

  assert.throws(
    () => reconcileExternalOutcome({
      intentId: 'intent-review-transaction',
      attemptId: 'attempt-review-transaction',
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      recordReconciliation: () => ({ reconciliationId: 'reconciliation-review-transaction' }),
      recordReceipt: () => ({ receiptId: 'receipt-review-transaction' }),
      transitionExecution: () => ({ state: 'SUCCEEDED' })
    }),
    error => error?.code === 'WP_B_RECONCILIATION_TRANSACTION_REQUIRED'
  );

  const calls = [];
  const result = reconcileExternalOutcome({
    intentId: 'intent-review-transaction',
    attemptId: 'attempt-review-transaction',
    observation,
    authorityTimestamp: '2026-08-03T05:10:01.000Z',
    transaction(callback) {
      calls.push('transaction-begin');
      const value = callback();
      calls.push('transaction-commit');
      return value;
    },
    recordReconciliation() {
      calls.push('recordReconciliation');
      return { reconciliationId: 'reconciliation-review-transaction' };
    },
    recordReceipt() {
      calls.push('recordReceipt');
      return { receiptId: 'receipt-review-transaction' };
    },
    transitionExecution() {
      calls.push('transitionExecution');
      return { state: 'SUCCEEDED' };
    }
  });
  assert.deepEqual(calls, [
    'transaction-begin',
    'recordReconciliation',
    'recordReceipt',
    'transitionExecution',
    'transaction-commit'
  ]);
  assert.equal(result.reconciliationId, 'reconciliation-review-transaction');
  assert.equal(result.state, 'SUCCEEDED');

  const durable = { reconciliation: false, receipt: false };
  assert.throws(
    () => reconcileExternalOutcome({
      intentId: 'intent-review-transaction',
      attemptId: 'attempt-review-transaction',
      observation,
      authorityTimestamp: '2026-08-03T05:10:01.000Z',
      transaction(callback) {
        const before = { ...durable };
        try {
          return callback();
        } catch (error) {
          durable.reconciliation = before.reconciliation;
          durable.receipt = before.receipt;
          throw error;
        }
      },
      recordReconciliation() {
        durable.reconciliation = true;
        return { reconciliationId: 'reconciliation-review-rollback' };
      },
      recordReceipt() {
        durable.receipt = true;
        return { receiptId: 'receipt-review-rollback' };
      },
      transitionExecution() {
        throw Object.assign(new Error('transition rejected'), { code: 'TRANSITION_REJECTED' });
      }
    }),
    error => error?.code === 'TRANSITION_REJECTED'
  );
  assert.deepEqual(durable, { reconciliation: false, receipt: false });
});

test('real SQLite reclaim""",
        "startup reconciliation unit contract",
    )

    for marker in [
        """    () => reconcileExternalOutcome({
      observation,
""",
        """  const success = reconcileExternalOutcome({
    observation,
""",
    ]:
        if marker not in source:
            raise SystemExit(f"real SQLite reconciliation anchor missing: {marker}")

    source = replace_once(
        source,
        """    () => reconcileExternalOutcome({
      observation,
      authorityTimestamp: '2026-08-03T06:10:09.000Z',
      transaction: callback => store.transaction(callback),
      recordReceipt: trusted => outbox.recordReceipt({
""",
        """    () => reconcileExternalOutcome({
      intentId: intent.intentId,
      attemptId: attempt.attemptId,
      observation,
      authorityTimestamp: '2026-08-03T06:10:09.000Z',
      transaction: callback => store.transaction(callback),
      recordReconciliation: reconciliation => outbox.recordReconciliation(reconciliation),
      recordReceipt: trusted => outbox.recordReceipt({
""",
        "real rollback reconciliation input",
    )
    source = replace_once(
        source,
        """  const success = reconcileExternalOutcome({
    observation,
    authorityTimestamp: '2026-08-03T06:10:10.000Z',
    transaction: callback => store.transaction(callback),
    recordReceipt: trusted => outbox.recordReceipt({
""",
        """  const success = reconcileExternalOutcome({
    intentId: intent.intentId,
    attemptId: attempt.attemptId,
    observation,
    authorityTimestamp: '2026-08-03T06:10:10.000Z',
    transaction: callback => store.transaction(callback),
    recordReconciliation: reconciliation => outbox.recordReconciliation(reconciliation),
    recordReceipt: trusted => outbox.recordReceipt({
""",
        "real success reconciliation input",
    )
    source = replace_once(
        source,
        """  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 0);
  const claimAfterRollback""",
        """  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 0);
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_outcome_reconciliations
    WHERE intent_id=?`).get(intent.intentId).count, 0);
  const claimAfterRollback""",
        "rollback reconciliation assertion",
    )
    source = replace_once(
        source,
        """  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(store.db.prepare(`SELECT state FROM external_action_claims
""",
        """  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_action_receipts
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM external_outcome_reconciliations
    WHERE intent_id=?`).get(intent.intentId).count, 1);
  assert.equal(store.db.prepare(`SELECT state FROM external_action_claims
""",
        "success reconciliation assertion",
    )
    write(path, source)


def main() -> None:
    update_migration_engine()
    update_migration_wrapper()
    update_outbox()
    update_reconciliation()
    update_uncertain_tests()
    update_existing_tests()
    print("WP_B_M1_INDEPENDENT_REVIEW_INTEGRITY_REFACTOR_APPLIED")


if __name__ == "__main__":
    main()
