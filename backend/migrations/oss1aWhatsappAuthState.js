'use strict';

const crypto = require('node:crypto');

const MIGRATION_ID = '023_oss1a_whatsapp_auth_state';
const TARGET_SCHEMA_VERSION = 23;

const SCHEMA_CONTRACT = Object.freeze({
  authority: 'WhatsAppAuthStateAuthority',
  schemaVersion: TARGET_SCHEMA_VERSION,
  tables: Object.freeze({
    whatsapp_auth_accounts: Object.freeze([
      'account_key', 'account_id', 'current_epoch', 'state',
      'creds_cipher_version', 'creds_key_version', 'creds_nonce', 'creds_ciphertext',
      'creds_auth_tag', 'creds_ciphertext_sha256', 'registered', 'identity_jid_hmac',
      'writer_generation', 'writer_socket_token', 'created_at', 'updated_at',
      'logged_out_at', 'quarantine_reason'
    ]),
    whatsapp_auth_keys: Object.freeze([
      'account_key', 'category', 'key_id', 'value_present', 'cipher_version',
      'key_version', 'nonce', 'ciphertext', 'auth_tag', 'ciphertext_sha256',
      'epoch', 'updated_at'
    ]),
    whatsapp_auth_import_receipts: Object.freeze([
      'receipt_id', 'account_key', 'source_directory_hmac', 'manifest_a_sha256',
      'manifest_b_sha256', 'manifest_c_sha256', 'staged_epoch', 'state',
      'activation_sha256', 'failure_code', 'cleanup_reference_hmac',
      'created_at', 'updated_at', 'activated_at', 'completed_at'
    ]),
    whatsapp_message_retry_counters: Object.freeze([
      'account_key', 'cache_key_hmac', 'value_json', 'expires_at', 'updated_at'
    ]),
    whatsapp_message_key_index: Object.freeze([
      'account_id', 'remote_jid_hmac', 'message_id_hmac', 'participant_hmac',
      'from_me', 'canonical_message_id', 'created_at', 'updated_at'
    ]),
    whatsapp_message_retry_payloads: Object.freeze([
      'canonical_message_id', 'account_id', 'cipher_version', 'key_version',
      'nonce', 'ciphertext', 'auth_tag', 'ciphertext_sha256', 'created_at', 'updated_at'
    ])
  }),
  primaryKeys: Object.freeze({
    whatsapp_auth_accounts: Object.freeze(['account_key']),
    whatsapp_auth_keys: Object.freeze(['account_key', 'category', 'key_id']),
    whatsapp_auth_import_receipts: Object.freeze(['receipt_id']),
    whatsapp_message_retry_counters: Object.freeze(['account_key', 'cache_key_hmac']),
    whatsapp_message_key_index: Object.freeze([
      'account_id', 'remote_jid_hmac', 'message_id_hmac', 'participant_hmac', 'from_me'
    ]),
    whatsapp_message_retry_payloads: Object.freeze(['canonical_message_id'])
  }),
  indexes: Object.freeze({
    idx_whatsapp_auth_accounts_account_id: true,
    idx_whatsapp_auth_accounts_state_epoch: false,
    idx_whatsapp_auth_keys_epoch: false,
    idx_whatsapp_auth_import_receipts_account_state: false,
    idx_whatsapp_auth_import_receipts_source_active: true,
    idx_whatsapp_message_retry_counters_expiry: false,
    idx_whatsapp_message_key_index_canonical: true,
    idx_whatsapp_message_key_index_lookup: false,
    idx_whatsapp_message_retry_payloads_account: false
  }),
  forbiddenPlaintextColumns: Object.freeze({
    whatsapp_auth_accounts: Object.freeze(['creds_json', 'identity_jid']),
    whatsapp_auth_keys: Object.freeze(['value_json', 'value_sha256']),
    whatsapp_message_key_index: Object.freeze([
      'remote_jid', 'message_id', 'participant', 'raw_message_json'
    ])
  }),
  contractVersion: 1
});

const MIGRATION_CHECKSUM = crypto.createHash('sha256')
  .update(JSON.stringify({ migrationId: MIGRATION_ID, contract: SCHEMA_CONTRACT }))
  .digest('hex');

function migrationError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'Oss1aWhatsappAuthMigrationError';
  error.code = code;
  error.reasonCode = code;
  Object.assign(error, details);
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function ensureBaseTables(db) {
  for (const table of ['r32_meta', 'r32_schema_migrations', 'r32_accounts', 'communication_canonical_messages']) {
    if (!tableExists(db, table)) {
      throw migrationError(
        'OSS1A_WHATSAPP_AUTH_BASE_TABLE_MISSING',
        `Schema 23 migration requires ${table}`,
        { table }
      );
    }
  }
}

function readSchemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  if (!rows.length) return 0;
  const versions = rows.map(row => {
    let value;
    try { value = JSON.parse(row.value_json); } catch (_) { value = row.value_json; }
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw migrationError(
        'OSS1A_WHATSAPP_AUTH_SCHEMA_METADATA_INVALID',
        `Schema version metadata ${row.key} is invalid`,
        { key: String(row.key), value: row.value_json }
      );
    }
    return numeric;
  });
  return Math.max(...versions);
}

function assertSchemaNotAhead(db) {
  const current = readSchemaVersion(db);
  if (current > TARGET_SCHEMA_VERSION) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_SCHEMA_AHEAD',
      `Database schema ${current} is newer than OSS-1A Schema ${TARGET_SCHEMA_VERSION}`,
      { databaseVersion: current, supportedVersion: TARGET_SCHEMA_VERSION }
    );
  }
  return current;
}

function setSchemaVersion(db, value, at) {
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}

function ensureObjects(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth_accounts(
      account_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      current_epoch INTEGER NOT NULL CHECK(current_epoch>=1),
      state TEXT NOT NULL CHECK(state IN ('ACTIVE','LOGGED_OUT','QUARANTINED','IMPORT_PENDING')),
      creds_cipher_version INTEGER,
      creds_key_version INTEGER,
      creds_nonce BLOB,
      creds_ciphertext BLOB,
      creds_auth_tag BLOB,
      creds_ciphertext_sha256 TEXT NOT NULL DEFAULT '',
      registered INTEGER NOT NULL DEFAULT 0 CHECK(registered IN (0,1)),
      identity_jid_hmac TEXT NOT NULL DEFAULT '' CHECK(length(identity_jid_hmac) IN (0,64)),
      writer_generation INTEGER NOT NULL DEFAULT 0 CHECK(writer_generation>=0),
      writer_socket_token TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      logged_out_at TEXT NOT NULL DEFAULT '',
      quarantine_reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE CASCADE,
      CHECK(
        (state IN ('ACTIVE','QUARANTINED')
          AND creds_cipher_version>=1
          AND creds_key_version>=1
          AND length(creds_nonce)=12
          AND length(creds_ciphertext)>0
          AND length(creds_auth_tag)=16
          AND length(creds_ciphertext_sha256)=64)
        OR
        (state IN ('LOGGED_OUT','IMPORT_PENDING')
          AND creds_cipher_version IS NULL
          AND creds_key_version IS NULL
          AND creds_nonce IS NULL
          AND creds_ciphertext IS NULL
          AND creds_auth_tag IS NULL
          AND creds_ciphertext_sha256='')
      )
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_auth_accounts_account_id
      ON whatsapp_auth_accounts(account_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_accounts_state_epoch
      ON whatsapp_auth_accounts(state,current_epoch,updated_at,account_key);

    CREATE TABLE IF NOT EXISTS whatsapp_auth_keys(
      account_key TEXT NOT NULL,
      category TEXT NOT NULL,
      key_id TEXT NOT NULL,
      value_present INTEGER NOT NULL CHECK(value_present IN (0,1)),
      cipher_version INTEGER,
      key_version INTEGER,
      nonce BLOB,
      ciphertext BLOB,
      auth_tag BLOB,
      ciphertext_sha256 TEXT NOT NULL DEFAULT '',
      epoch INTEGER NOT NULL CHECK(epoch>=1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_key,category,key_id),
      FOREIGN KEY(account_key) REFERENCES whatsapp_auth_accounts(account_key) ON DELETE CASCADE,
      CHECK(
        (value_present=0
          AND cipher_version IS NULL
          AND key_version IS NULL
          AND nonce IS NULL
          AND ciphertext IS NULL
          AND auth_tag IS NULL
          AND ciphertext_sha256='')
        OR
        (value_present=1
          AND cipher_version>=1
          AND key_version>=1
          AND length(nonce)=12
          AND length(ciphertext)>0
          AND length(auth_tag)=16
          AND length(ciphertext_sha256)=64)
      )
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_keys_epoch
      ON whatsapp_auth_keys(account_key,epoch,category,key_id);

    CREATE TABLE IF NOT EXISTS whatsapp_auth_import_receipts(
      receipt_id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      source_directory_hmac TEXT NOT NULL CHECK(length(source_directory_hmac)=64),
      manifest_a_sha256 TEXT NOT NULL CHECK(length(manifest_a_sha256)=64),
      manifest_b_sha256 TEXT NOT NULL DEFAULT '' CHECK(length(manifest_b_sha256) IN (0,64)),
      manifest_c_sha256 TEXT NOT NULL DEFAULT '' CHECK(length(manifest_c_sha256) IN (0,64)),
      staged_epoch INTEGER NOT NULL CHECK(staged_epoch>=1),
      state TEXT NOT NULL CHECK(state IN ('IMPORT_PENDING','STAGED','ACTIVATED','CLEANUP_REQUIRED','COMPLETED','FAILED')),
      activation_sha256 TEXT NOT NULL DEFAULT '' CHECK(length(activation_sha256) IN (0,64)),
      failure_code TEXT NOT NULL DEFAULT '',
      cleanup_reference_hmac TEXT NOT NULL DEFAULT '' CHECK(length(cleanup_reference_hmac) IN (0,64)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      activated_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(account_key) REFERENCES whatsapp_auth_accounts(account_key) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_import_receipts_account_state
      ON whatsapp_auth_import_receipts(account_key,state,updated_at,receipt_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_auth_import_receipts_source_active
      ON whatsapp_auth_import_receipts(source_directory_hmac)
      WHERE state<>'FAILED';

    CREATE TABLE IF NOT EXISTS whatsapp_message_retry_counters(
      account_key TEXT NOT NULL,
      cache_key_hmac TEXT NOT NULL CHECK(length(cache_key_hmac)=64),
      value_json TEXT NOT NULL CHECK(json_valid(value_json)),
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_key,cache_key_hmac),
      FOREIGN KEY(account_key) REFERENCES whatsapp_auth_accounts(account_key) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_message_retry_counters_expiry
      ON whatsapp_message_retry_counters(expires_at,account_key,cache_key_hmac);

    CREATE TABLE IF NOT EXISTS whatsapp_message_key_index(
      account_id TEXT NOT NULL,
      remote_jid_hmac TEXT NOT NULL CHECK(length(remote_jid_hmac)=64),
      message_id_hmac TEXT NOT NULL CHECK(length(message_id_hmac)=64),
      participant_hmac TEXT NOT NULL DEFAULT '' CHECK(length(participant_hmac) IN (0,64)),
      from_me INTEGER NOT NULL CHECK(from_me IN (0,1)),
      canonical_message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id,remote_jid_hmac,message_id_hmac,participant_hmac,from_me),
      FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY(canonical_message_id) REFERENCES communication_canonical_messages(message_id) ON DELETE CASCADE
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_key_index_canonical
      ON whatsapp_message_key_index(canonical_message_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_message_key_index_lookup
      ON whatsapp_message_key_index(account_id,message_id_hmac,remote_jid_hmac,from_me);

    CREATE TABLE IF NOT EXISTS whatsapp_message_retry_payloads(
      canonical_message_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      cipher_version INTEGER NOT NULL CHECK(cipher_version>=1),
      key_version INTEGER NOT NULL CHECK(key_version>=1),
      nonce BLOB NOT NULL CHECK(length(nonce)=12),
      ciphertext BLOB NOT NULL CHECK(length(ciphertext)>0),
      auth_tag BLOB NOT NULL CHECK(length(auth_tag)=16),
      ciphertext_sha256 TEXT NOT NULL CHECK(length(ciphertext_sha256)=64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(canonical_message_id) REFERENCES communication_canonical_messages(message_id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_message_retry_payloads_account
      ON whatsapp_message_retry_payloads(account_id,updated_at,canonical_message_id);
  `);
}

function actualColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

function actualPrimaryKey(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .filter(row => Number(row.pk || 0) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map(row => String(row.name));
}

function assertExactList(actual, expected, code, message, details = {}) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw migrationError(code, message, { ...details, expected, actual });
  }
}

function ensureTableContract(db, table, expectedColumns, expectedPrimaryKey) {
  if (!tableExists(db, table)) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_TABLE_MISSING',
      `Schema 23 table ${table} is missing`,
      { table }
    );
  }
  assertExactList(
    actualColumns(db, table),
    expectedColumns,
    'OSS1A_WHATSAPP_AUTH_COLUMN_CONTRACT_MISMATCH',
    `Schema 23 table ${table} does not match its frozen column contract`,
    { table }
  );
  assertExactList(
    actualPrimaryKey(db, table),
    expectedPrimaryKey,
    'OSS1A_WHATSAPP_AUTH_PRIMARY_KEY_MISMATCH',
    `Schema 23 table ${table} does not match its frozen primary-key contract`,
    { table }
  );
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '');
  if (!/\bSTRICT\b/iu.test(sql)) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_STRICT_TABLE_REQUIRED',
      `Schema 23 table ${table} is not STRICT`,
      { table }
    );
  }
}

function ensureForeignKey(db, table, expected) {
  const present = db.prepare(`PRAGMA foreign_key_list(${table})`).all().some(row =>
    String(row.from) === expected.from
    && String(row.table) === expected.table
    && String(row.to) === expected.to
    && String(row.on_delete).toUpperCase() === expected.onDelete
  );
  if (!present) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_FOREIGN_KEY_MISSING',
      `Schema 23 foreign key ${table}.${expected.from} is missing`,
      { table, ...expected }
    );
  }
}

function ensureIndex(db, name, unique) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name);
  if (!row) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_INDEX_MISSING',
      `Schema 23 index ${name} is missing`,
      { index: name }
    );
  }
  const actualUnique = /CREATE\s+UNIQUE\s+INDEX/iu.test(String(row.sql || ''));
  if (actualUnique !== unique) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_INDEX_CONTRACT_MISMATCH',
      `Schema 23 index ${name} has incorrect uniqueness`,
      { index: name, expectedUnique: unique, actualUnique }
    );
  }
}

function ensureConsistency(db) {
  ensureBaseTables(db);
  for (const [table, expectedColumns] of Object.entries(SCHEMA_CONTRACT.tables)) {
    ensureTableContract(db, table, expectedColumns, SCHEMA_CONTRACT.primaryKeys[table]);
    const actual = new Set(actualColumns(db, table));
    for (const forbidden of SCHEMA_CONTRACT.forbiddenPlaintextColumns[table] || []) {
      if (actual.has(forbidden)) {
        throw migrationError(
          'OSS1A_WHATSAPP_AUTH_PLAINTEXT_COLUMN_FORBIDDEN',
          `Schema 23 table ${table} contains forbidden plaintext column ${forbidden}`,
          { table, column: forbidden }
        );
      }
    }
  }

  const foreignKeys = Object.freeze({
    whatsapp_auth_accounts: Object.freeze([
      { from: 'account_id', table: 'r32_accounts', to: 'id', onDelete: 'CASCADE' }
    ]),
    whatsapp_auth_keys: Object.freeze([
      { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
    ]),
    whatsapp_auth_import_receipts: Object.freeze([
      { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
    ]),
    whatsapp_message_retry_counters: Object.freeze([
      { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
    ]),
    whatsapp_message_key_index: Object.freeze([
      { from: 'account_id', table: 'r32_accounts', to: 'id', onDelete: 'CASCADE' },
      { from: 'canonical_message_id', table: 'communication_canonical_messages', to: 'message_id', onDelete: 'CASCADE' }
    ]),
    whatsapp_message_retry_payloads: Object.freeze([
      { from: 'account_id', table: 'r32_accounts', to: 'id', onDelete: 'CASCADE' },
      { from: 'canonical_message_id', table: 'communication_canonical_messages', to: 'message_id', onDelete: 'CASCADE' }
    ])
  });
  for (const [table, expectedList] of Object.entries(foreignKeys)) {
    for (const expected of expectedList) ensureForeignKey(db, table, expected);
  }
  for (const [name, unique] of Object.entries(SCHEMA_CONTRACT.indexes)) ensureIndex(db, name, unique);
  return { ok: true, tables: Object.keys(SCHEMA_CONTRACT.tables).length };
}

function injectedFault(point) {
  throw migrationError(
    'OSS1A_WHATSAPP_AUTH_TEST_FAULT',
    `Injected Schema 23 migration fault at ${point}`,
    { faultPoint: point }
  );
}

function verifyExistingReceipt(db, row) {
  if (String(row.checksum || '') !== MIGRATION_CHECKSUM) {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_MIGRATION_CHECKSUM_MISMATCH',
      'Schema 23 migration checksum mismatch',
      { expectedChecksum: MIGRATION_CHECKSUM, actualChecksum: String(row.checksum || '') }
    );
  }
  if (String(row.status || '') !== 'completed') {
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_MIGRATION_INCOMPLETE',
      'Schema 23 migration receipt is not completed',
      { status: String(row.status || '') }
    );
  }
}

function applyOss1aWhatsappAuthState(db, options = {}) {
  ensureBaseTables(db);
  const current = assertSchemaNotAhead(db);
  const existing = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (existing) {
    verifyExistingReceipt(db, existing);
    ensureConsistency(db);
    const persistedVersion = readSchemaVersion(db);
    if (persistedVersion !== TARGET_SCHEMA_VERSION) {
      throw migrationError(
        'OSS1A_WHATSAPP_AUTH_SCHEMA_METADATA_MISMATCH',
        'Completed Schema 23 receipt is not bound to exact schema metadata',
        { databaseVersion: persistedVersion, supportedVersion: TARGET_SCHEMA_VERSION }
      );
    }
    return {
      ok: true,
      executed: false,
      migrationId: MIGRATION_ID,
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      checksum: MIGRATION_CHECKSUM
    };
  }

  const at = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(
      migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
    ) VALUES(?,?,'running',?,?,'','{}')`).run(
      MIGRATION_ID, TARGET_SCHEMA_VERSION, MIGRATION_CHECKSUM, at
    );
    if (options.testFaultAt === 'AFTER_RECEIPT_RUNNING') injectedFault('AFTER_RECEIPT_RUNNING');

    ensureObjects(db);
    if (options.testFaultAt === 'AFTER_OBJECTS') injectedFault('AFTER_OBJECTS');

    ensureConsistency(db);
    if (options.testFaultAt === 'AFTER_CONSISTENCY') injectedFault('AFTER_CONSISTENCY');
    if (options.testFaultAt === 'BEFORE_SCHEMA_VERSION') injectedFault('BEFORE_SCHEMA_VERSION');

    setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
    if (options.testFaultAt === 'BEFORE_RECEIPT_COMPLETED') injectedFault('BEFORE_RECEIPT_COMPLETED');

    const report = {
      authority: SCHEMA_CONTRACT.authority,
      migrationId: MIGRATION_ID,
      fromSchemaVersion: current,
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      schemaContractVersion: SCHEMA_CONTRACT.contractVersion,
      tables: Object.keys(SCHEMA_CONTRACT.tables).length,
      checksum: MIGRATION_CHECKSUM,
      completedAt: at
    };
    const completed = db.prepare(`UPDATE r32_schema_migrations
      SET status='completed',completed_at=?,report_json=?
      WHERE migration_id=? AND status='running' AND checksum=?`).run(
      at, JSON.stringify(report), MIGRATION_ID, MIGRATION_CHECKSUM
    );
    if (Number(completed.changes || 0) !== 1) {
      throw migrationError(
        'OSS1A_WHATSAPP_AUTH_RECEIPT_CAS_FAILED',
        'Schema 23 migration receipt completion compare-and-swap failed'
      );
    }
    db.exec('COMMIT');
    return {
      ok: true,
      executed: true,
      migrationId: MIGRATION_ID,
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      checksum: MIGRATION_CHECKSUM,
      report
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (error?.code) throw error;
    throw migrationError(
      'OSS1A_WHATSAPP_AUTH_MIGRATION_FAILED',
      'Schema 23 WhatsApp auth migration failed',
      { cause: error }
    );
  }
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  MIGRATION_CHECKSUM,
  SCHEMA_CONTRACT,
  ensureObjects,
  ensureConsistency,
  applyOss1aWhatsappAuthState
};
