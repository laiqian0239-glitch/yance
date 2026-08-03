'use strict';

const crypto = require('node:crypto');

const MIGRATION_ID = '022_architecture_closure_v2_wp_a_integrity';
const TARGET_SCHEMA_VERSION = 22;
const RECEIPT_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_HASH_INSERT_TRIGGER = 'trg_authority_command_receipts_content_hash_insert';
const INTEGRITY_CONTRACT = Object.freeze({
  authority: 'AuthorityWriteHost',
  schemaVersion: TARGET_SCHEMA_VERSION,
  canonicalEventHeaderColumns: Object.freeze(['retention_class']),
  authorityCommandReceiptColumns: Object.freeze([
    'command_content_sha256',
    'event_content_sha256',
    'content_hash_version'
  ]),
  uniqueIndexes: Object.freeze({
    canonical_event_headers: Object.freeze(['payload_id'])
  }),
  appendOnlyTables: Object.freeze([
    'canonical_event_headers',
    'authority_payload_store',
    'event_type_registry',
    'authority_command_receipts'
  ]),
  receiptHashInsertTrigger: RECEIPT_HASH_INSERT_TRIGGER,
  legacyReceiptPolicy: 'FAIL_CLOSED_WHEN_EVENT_CONTENT_HASH_IS_UNAVAILABLE'
});
const MIGRATION_CHECKSUM = crypto.createHash('sha256')
  .update(JSON.stringify({ migrationId: MIGRATION_ID, contract: INTEGRITY_CONTRACT }))
  .digest('hex');

function nowIso() {
  return new Date().toISOString();
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

function hasColumn(db, table, column) {
  return columns(db, table).includes(column);
}

function ensureColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,
    target_schema_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}

function setSchemaVersion(db, value, at) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}

function appendOnlyTriggerName(table, operation) {
  return `trg_${table}_append_only_${operation}`;
}

function ensureAppendOnlyTriggers(db, table) {
  for (const operation of ['update', 'delete']) {
    const trigger = appendOnlyTriggerName(table, operation);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${trigger}
      BEFORE ${operation.toUpperCase()} ON ${table}
      BEGIN SELECT RAISE(ABORT,'${table} append-only'); END;`);
  }
}

function ensureReceiptHashInsertTrigger(db) {
  db.exec(`CREATE TRIGGER IF NOT EXISTS ${RECEIPT_HASH_INSERT_TRIGGER}
    BEFORE INSERT ON authority_command_receipts
    WHEN NEW.content_hash_version<>1
      OR LENGTH(NEW.command_content_sha256)<>64
      OR LOWER(NEW.command_content_sha256)<>NEW.command_content_sha256
      OR NEW.command_content_sha256 GLOB '*[^0-9a-f]*'
      OR LENGTH(NEW.event_content_sha256)<>64
      OR LOWER(NEW.event_content_sha256)<>NEW.event_content_sha256
      OR NEW.event_content_sha256 GLOB '*[^0-9a-f]*'
    BEGIN SELECT RAISE(ABORT,'authority_command_receipts requires verified content hashes'); END;`);
}

function isArchitectureClosureV2WpAIntegrityApplied(db) {
  if (!tableExists(db, 'r32_schema_migrations')) return false;
  const row = db.prepare('SELECT status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!row) return false;
  if (String(row.checksum || '') !== MIGRATION_CHECKSUM) {
    const error = new Error('Schema 22 WP-A integrity migration checksum mismatch');
    error.code = 'ACV2_WP_A_INTEGRITY_MIGRATION_CHECKSUM_MISMATCH';
    error.expectedChecksum = MIGRATION_CHECKSUM;
    error.actualChecksum = String(row.checksum || '');
    throw error;
  }
  if (String(row.status || '') !== 'completed') {
    const error = new Error('Schema 22 WP-A integrity migration is not completed');
    error.code = 'ACV2_WP_A_INTEGRITY_MIGRATION_INCOMPLETE';
    throw error;
  }
  return true;
}

function assertNoDuplicatePayloadIds(db) {
  const duplicate = db.prepare(`SELECT payload_id,COUNT(*) AS count
    FROM canonical_event_headers
    GROUP BY payload_id HAVING COUNT(*)>1 LIMIT 1`).get();
  if (duplicate) {
    const error = new Error('Cannot enforce one-to-one canonical payload identity because duplicate payload IDs exist');
    error.code = 'ACV2_WP_A_DUPLICATE_PAYLOAD_ID';
    error.payloadId = String(duplicate.payload_id || '');
    error.count = Number(duplicate.count || 0);
    throw error;
  }
}

function installIntegrityObjects(db) {
  for (const table of INTEGRITY_CONTRACT.appendOnlyTables) {
    if (!tableExists(db, table)) {
      const error = new Error(`Schema 22 integrity migration requires ${table}`);
      error.code = 'ACV2_WP_A_INTEGRITY_BASE_TABLE_MISSING';
      error.table = table;
      throw error;
    }
  }

  ensureColumn(
    db,
    'canonical_event_headers',
    'retention_class',
    "TEXT NOT NULL DEFAULT 'LEGACY_UNRECORDED'"
  );
  ensureColumn(
    db,
    'authority_command_receipts',
    'command_content_sha256',
    "TEXT NOT NULL DEFAULT '' CHECK(length(command_content_sha256) IN (0,64))"
  );
  ensureColumn(
    db,
    'authority_command_receipts',
    'event_content_sha256',
    "TEXT NOT NULL DEFAULT '' CHECK(length(event_content_sha256) IN (0,64))"
  );
  ensureColumn(
    db,
    'authority_command_receipts',
    'content_hash_version',
    'INTEGER NOT NULL DEFAULT 0 CHECK(content_hash_version IN (0,1))'
  );

  db.exec(`UPDATE authority_command_receipts
    SET command_content_sha256=LOWER(COALESCE(json_extract(result_json,'$.commandContentSha256'),''))
    WHERE command_content_sha256=''
      AND LENGTH(COALESCE(json_extract(result_json,'$.commandContentSha256'),''))=64
      AND LOWER(COALESCE(json_extract(result_json,'$.commandContentSha256'),''))
          NOT GLOB '*[^0-9a-f]*';`);

  assertNoDuplicatePayloadIds(db);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_event_headers_payload_id
    ON canonical_event_headers(payload_id);`);

  ensureReceiptHashInsertTrigger(db);
  for (const table of INTEGRITY_CONTRACT.appendOnlyTables) ensureAppendOnlyTriggers(db, table);
}

function triggerExists(db, name, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?")
    .get(name, table));
}

function assertReceiptHashes(db) {
  const rows = db.prepare(`SELECT command_id,command_content_sha256,event_content_sha256,content_hash_version
    FROM authority_command_receipts`).all();
  for (const row of rows) {
    const commandId = String(row.command_id || '');
    const commandHash = String(row.command_content_sha256 || '');
    const eventHash = String(row.event_content_sha256 || '');
    const version = Number(row.content_hash_version);
    const commandValid = RECEIPT_HASH_PATTERN.test(commandHash);
    const eventValid = RECEIPT_HASH_PATTERN.test(eventHash);
    if (version === 1 && commandValid && eventValid) continue;
    if (version === 0 && (!commandHash || commandValid) && (!eventHash || eventValid)) continue;
    const error = new Error('Schema 22 receipt content hash contract is invalid');
    error.code = 'ACV2_WP_A_RECEIPT_CONTENT_HASH_INVALID';
    error.commandId = commandId;
    error.contentHashVersion = version;
    throw error;
  }
}

function ensureConsistency(db) {
  for (const column of INTEGRITY_CONTRACT.canonicalEventHeaderColumns) {
    if (!hasColumn(db, 'canonical_event_headers', column)) {
      const error = new Error(`Schema 22 canonical_event_headers.${column} is missing`);
      error.code = 'ACV2_WP_A_INTEGRITY_COLUMN_MISSING';
      throw error;
    }
  }
  for (const column of INTEGRITY_CONTRACT.authorityCommandReceiptColumns) {
    if (!hasColumn(db, 'authority_command_receipts', column)) {
      const error = new Error(`Schema 22 authority_command_receipts.${column} is missing`);
      error.code = 'ACV2_WP_A_INTEGRITY_COLUMN_MISSING';
      throw error;
    }
  }

  const payloadIndex = db.prepare(`SELECT il.name
    FROM pragma_index_list('canonical_event_headers') il
    WHERE il.[unique]=1
      AND (SELECT GROUP_CONCAT(ii.name,',') FROM pragma_index_info(il.name) ii)='payload_id'
    LIMIT 1`).get();
  if (!payloadIndex) {
    const error = new Error('Schema 22 canonical payload one-to-one index is missing');
    error.code = 'ACV2_WP_A_PAYLOAD_ID_UNIQUE_INDEX_MISSING';
    throw error;
  }

  if (!triggerExists(db, RECEIPT_HASH_INSERT_TRIGGER, 'authority_command_receipts')) {
    const error = new Error('Schema 22 verified receipt hash insert trigger is missing');
    error.code = 'ACV2_WP_A_RECEIPT_HASH_TRIGGER_MISSING';
    throw error;
  }

  for (const table of INTEGRITY_CONTRACT.appendOnlyTables) {
    for (const operation of ['update', 'delete']) {
      const name = appendOnlyTriggerName(table, operation);
      if (!triggerExists(db, name, table)) {
        const error = new Error(`Schema 22 append-only trigger is missing: ${name}`);
        error.code = 'ACV2_WP_A_APPEND_ONLY_TRIGGER_MISSING';
        error.table = table;
        error.operation = operation;
        throw error;
      }
    }
  }

  assertReceiptHashes(db);
}

function result() {
  return Object.freeze({
    migrationId: MIGRATION_ID,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    checksum: MIGRATION_CHECKSUM,
    legacyReceiptPolicy: INTEGRITY_CONTRACT.legacyReceiptPolicy
  });
}

function applyArchitectureClosureV2WpAIntegrity(db) {
  ensureMigrationTable(db);
  const existing = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (existing && String(existing.checksum || '') !== MIGRATION_CHECKSUM) {
    const error = new Error('Schema 22 WP-A integrity migration checksum mismatch');
    error.code = 'ACV2_WP_A_INTEGRITY_MIGRATION_CHECKSUM_MISMATCH';
    error.expectedChecksum = MIGRATION_CHECKSUM;
    error.actualChecksum = String(existing.checksum || '');
    throw error;
  }
  if (existing && String(existing.status || '') === 'completed') {
    ensureConsistency(db);
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, nowIso());
    return result();
  }

  const at = nowIso();
  db.exec('SAVEPOINT acv2_wp_a_integrity_v22');
  try {
    installIntegrityObjects(db);
    ensureConsistency(db);
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
    const report = JSON.stringify({
      authority: 'AuthorityWriteHost',
      schemaVersion: TARGET_SCHEMA_VERSION,
      migrationChecksum: MIGRATION_CHECKSUM,
      legacyReceiptPolicy: INTEGRITY_CONTRACT.legacyReceiptPolicy,
      appendOnlyTables: INTEGRITY_CONTRACT.appendOnlyTables.length,
      verifiedReceiptHashVersion: 1
    });
    db.prepare(`INSERT INTO r32_schema_migrations(
      migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
    ) VALUES(?,?,?,?,?,?,?)`)
      .run(MIGRATION_ID, TARGET_SCHEMA_VERSION, 'completed', MIGRATION_CHECKSUM, at, at, report);
    db.exec('RELEASE SAVEPOINT acv2_wp_a_integrity_v22');
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT acv2_wp_a_integrity_v22'); } catch (_) {}
    try { db.exec('RELEASE SAVEPOINT acv2_wp_a_integrity_v22'); } catch (_) {}
    throw error;
  }

  return result();
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  INTEGRITY_CONTRACT,
  MIGRATION_CHECKSUM,
  RECEIPT_HASH_PATTERN,
  RECEIPT_HASH_INSERT_TRIGGER,
  appendOnlyTriggerName,
  isArchitectureClosureV2WpAIntegrityApplied,
  installIntegrityObjects,
  ensureConsistency,
  applyArchitectureClosureV2WpAIntegrity
};
