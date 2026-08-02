'use strict';

const TABLE = 'domain_projection_receipts';
const INSERT_TRIGGER = 'acv2_projection_receipt_canonical_insert';
const UPDATE_TRIGGER = 'acv2_projection_receipt_canonical_update';

function schemaError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}
function foreignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all();
}
function installCanonicalTriggers(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS ${INSERT_TRIGGER};
    DROP TRIGGER IF EXISTS ${UPDATE_TRIGGER};
    CREATE TRIGGER ${INSERT_TRIGGER}
    BEFORE INSERT ON ${TABLE}
    WHEN NOT EXISTS (
      SELECT 1 FROM canonical_event_headers
      WHERE event_id=NEW.event_id AND ledger_sequence=NEW.ledger_sequence
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_PROJECTION_RECEIPT_EVENT_REQUIRED');
    END;
    CREATE TRIGGER ${UPDATE_TRIGGER}
    BEFORE UPDATE OF event_id, ledger_sequence ON ${TABLE}
    WHEN NOT EXISTS (
      SELECT 1 FROM canonical_event_headers
      WHERE event_id=NEW.event_id AND ledger_sequence=NEW.ledger_sequence
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_PROJECTION_RECEIPT_EVENT_REQUIRED');
    END;
  `);
}
function createCanonicalTableSql(tableName) {
  return `
    CREATE TABLE ${tableName} (
      projector_name TEXT NOT NULL,
      projector_version TEXT NOT NULL,
      event_id TEXT NOT NULL,
      ledger_sequence INTEGER NOT NULL DEFAULT 0,
      projection_status TEXT NOT NULL,
      projection_hash TEXT NOT NULL DEFAULT '',
      target_refs_json TEXT NOT NULL DEFAULT '[]',
      failure_code TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL DEFAULT 1,
      projected_at TEXT NOT NULL,
      PRIMARY KEY(projector_name, projector_version, event_id),
      CHECK(ledger_sequence >= 0),
      CHECK(projection_status IN ('shadow-match','shadow-mismatch','applied','failed','skipped'))
    ) STRICT;
  `;
}
function rebuildCanonicalTable(db, hasLedgerSequence) {
  const replacement = 'domain_projection_receipts_acv2_next';
  const sequence = hasLedgerSequence
    ? `COALESCE(old.ledger_sequence, (SELECT ledger_sequence FROM canonical_event_headers WHERE event_id=old.event_id), 0)`
    : `COALESCE((SELECT ledger_sequence FROM canonical_event_headers WHERE event_id=old.event_id), 0)`;
  db.exec('SAVEPOINT acv2_projection_receipt_schema');
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS ${INSERT_TRIGGER};
      DROP TRIGGER IF EXISTS ${UPDATE_TRIGGER};
      DROP TABLE IF EXISTS ${replacement};
      ${createCanonicalTableSql(replacement)}
      INSERT OR REPLACE INTO ${replacement}(
        projector_name,projector_version,event_id,ledger_sequence,projection_status,projection_hash,
        target_refs_json,failure_code,failure_reason,attempt,projected_at
      )
      SELECT
        old.projector_name,old.projector_version,old.event_id,${sequence},old.projection_status,old.projection_hash,
        old.target_refs_json,old.failure_code,old.failure_reason,old.attempt,old.projected_at
      FROM ${TABLE} old;
      DROP TABLE ${TABLE};
      ALTER TABLE ${replacement} RENAME TO ${TABLE};
    `);
    db.exec('RELEASE SAVEPOINT acv2_projection_receipt_schema');
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT acv2_projection_receipt_schema'); } catch (_) {}
    try { db.exec('RELEASE SAVEPOINT acv2_projection_receipt_schema'); } catch (_) {}
    throw schemaError('PROJECTION_RECEIPT_SCHEMA_MIGRATION_FAILED', 'Projection receipt authority schema migration failed', { cause: error });
  }
}
function ensureCanonicalProjectionReceiptSchema(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new TypeError('Projection receipt schema authority requires a SQLite database capability');
  }
  if (!tableExists(db, 'canonical_event_headers')) {
    throw schemaError('CANONICAL_EVENT_SCHEMA_NOT_READY', 'Canonical event headers must exist before projection receipt authority migration');
  }
  if (!tableExists(db, TABLE)) {
    db.exec(createCanonicalTableSql(TABLE));
  }
  const currentColumns = columns(db, TABLE);
  const hasLedgerSequence = currentColumns.some(row => row.name === 'ledger_sequence');
  const legacyForeignKey = foreignKeys(db, TABLE).some(row => row.table === 'domain_events');
  if (!hasLedgerSequence || legacyForeignKey) rebuildCanonicalTable(db, hasLedgerSequence);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projection_receipts_status ON ${TABLE}(projection_status, projected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projection_receipts_ledger ON ${TABLE}(ledger_sequence, projector_name, projector_version);
  `);
  installCanonicalTriggers(db);
  const finalColumns = columns(db, TABLE);
  const finalForeignKeys = foreignKeys(db, TABLE);
  if (!finalColumns.some(row => row.name === 'ledger_sequence') || finalForeignKeys.some(row => row.table === 'domain_events')) {
    throw schemaError('PROJECTION_RECEIPT_SCHEMA_NOT_CANONICAL', 'Projection receipt schema remains bound to the legacy event table');
  }
  return Object.freeze({
    authority: 'CanonicalProjectionReceiptSchemaAuthority',
    table: TABLE,
    ledgerSequence: true,
    legacyForeignKeyRemoved: true,
    triggers: Object.freeze([INSERT_TRIGGER, UPDATE_TRIGGER])
  });
}

module.exports = {
  TABLE,
  INSERT_TRIGGER,
  UPDATE_TRIGGER,
  ensureCanonicalProjectionReceiptSchema
};
