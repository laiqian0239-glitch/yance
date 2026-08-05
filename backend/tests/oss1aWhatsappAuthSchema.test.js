'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore, SCHEMA_VERSION } = require('../lib/r32SqliteStore');
const { registerFaultMatrix } = require('./oss1aWhatsappAuthMigrationFaultMatrix.test');

const MIGRATION_ID = '023_oss1a_whatsapp_auth_state';
const TABLE_COLUMNS = Object.freeze({
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
});

const EXPECTED_PRIMARY_KEYS = Object.freeze({
  whatsapp_auth_accounts: Object.freeze(['account_key']),
  whatsapp_auth_keys: Object.freeze(['account_key', 'category', 'key_id']),
  whatsapp_auth_import_receipts: Object.freeze(['receipt_id']),
  whatsapp_message_retry_counters: Object.freeze(['account_key', 'cache_key_hmac']),
  whatsapp_message_key_index: Object.freeze([
    'account_id', 'remote_jid_hmac', 'message_id_hmac', 'participant_hmac', 'from_me'
  ]),
  whatsapp_message_retry_payloads: Object.freeze(['canonical_message_id'])
});

function withStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-schema23-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    return callback(store, { root, dbPath });
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

function primaryKeyColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .filter(row => Number(row.pk || 0) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map(row => String(row.name));
}

function tableSql(db, table) {
  return String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '');
}

function foreignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => ({
    from: String(row.from),
    table: String(row.table),
    to: String(row.to),
    onDelete: String(row.on_delete).toUpperCase()
  }));
}

function index(db, name) {
  return db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name=?").get(name) || null;
}

function validEnvelope(seed = 1) {
  return {
    cipherVersion: 1,
    keyVersion: 1,
    nonce: Buffer.alloc(12, seed),
    ciphertext: Buffer.from(`ciphertext-${seed}`),
    authTag: Buffer.alloc(16, seed + 1),
    ciphertextSha256: seed.toString(16).padStart(64, '0').slice(-64)
  };
}

function insertCanonicalMessage(store, messageId = 'canonical-message-1') {
  const at = new Date().toISOString();
  store.db.prepare(`INSERT INTO communication_canonical_messages(
    message_id,trace_id,platform,source_account_id,external_conversation_id,
    external_message_id,direction,sender_external_id,occurred_at,content_kind,
    raw_event_ref_json,normalized_content_json,render_projection_json,
    idempotency_key,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    messageId, '', 'whatsapp', 'wa-account-1', 'conversation-1', 'remote-message-1',
    'inbound', '', at, 'text', '{}', '{"kind":"text","text":"hello"}',
    '{"kind":"text","text":"hello"}', 'whatsapp:wa-account-1:conversation-1:remote-message-1', at, at
  );
  return messageId;
}

test('R32SqliteStore advances to Schema 23 and installs all encrypted WhatsApp authority tables', () => {
  withStore(store => {
    assert.equal(SCHEMA_VERSION, 23);
    assert.equal(store.getMeta('schema_version', 0), 23);
    assert.equal(store.getMeta('schemaVersion', 0), 23);

    const tables = new Set(
      store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map(row => String(row.name || ''))
    );
    for (const table of Object.keys(TABLE_COLUMNS)) assert.equal(tables.has(table), true, table);
  });
});

test('Schema 23 tables match the frozen encrypted column and primary-key contract', () => {
  withStore(store => {
    for (const [table, expected] of Object.entries(TABLE_COLUMNS)) {
      assert.deepEqual(columns(store.db, table), expected, `${table} columns`);
      assert.deepEqual(primaryKeyColumns(store.db, table), EXPECTED_PRIMARY_KEYS[table], `${table} primary key`);
      assert.match(tableSql(store.db, table), /\bSTRICT\b/iu, `${table} must be STRICT`);
    }

    assert.equal(columns(store.db, 'whatsapp_auth_accounts').includes('creds_json'), false);
    assert.equal(columns(store.db, 'whatsapp_auth_keys').includes('value_json'), false);
    assert.equal(columns(store.db, 'whatsapp_message_key_index').includes('raw_message_json'), false);
    for (const forbidden of ['remote_jid', 'message_id', 'participant']) {
      assert.equal(columns(store.db, 'whatsapp_message_key_index').includes(forbidden), false, forbidden);
    }
  });
});

test('Schema 23 freezes encrypted envelope, HMAC and two-phase import CHECK constraints', () => {
  withStore(store => {
    const accountsSql = tableSql(store.db, 'whatsapp_auth_accounts');
    assert.match(accountsSql, /ACTIVE/);
    assert.match(accountsSql, /LOGGED_OUT/);
    assert.match(accountsSql, /QUARANTINED/);
    assert.match(accountsSql, /IMPORT_PENDING/);
    assert.match(accountsSql, /length\s*\(\s*creds_nonce\s*\)\s*=\s*12/iu);
    assert.match(accountsSql, /length\s*\(\s*creds_auth_tag\s*\)\s*=\s*16/iu);
    assert.match(accountsSql, /length\s*\(\s*creds_ciphertext_sha256\s*\)\s*=\s*64/iu);
    assert.match(accountsSql, /length\s*\(\s*identity_jid_hmac\s*\)\s+IN\s*\(\s*0\s*,\s*64\s*\)/iu);

    const keysSql = tableSql(store.db, 'whatsapp_auth_keys');
    assert.match(keysSql, /value_present\s*=\s*0/iu);
    assert.match(keysSql, /value_present\s*=\s*1/iu);
    assert.match(keysSql, /length\s*\(\s*nonce\s*\)\s*=\s*12/iu);
    assert.match(keysSql, /length\s*\(\s*auth_tag\s*\)\s*=\s*16/iu);

    const receiptSql = tableSql(store.db, 'whatsapp_auth_import_receipts');
    for (const state of ['IMPORT_PENDING', 'STAGED', 'ACTIVATED', 'CLEANUP_REQUIRED', 'COMPLETED', 'FAILED']) {
      assert.match(receiptSql, new RegExp(state));
    }

    const retrySql = tableSql(store.db, 'whatsapp_message_retry_counters');
    assert.match(retrySql, /json_valid\s*\(\s*value_json\s*\)/iu);
  });
});

test('Schema 23 installs exact cascading foreign keys and lookup indexes', () => {
  withStore(store => {
    const expectedForeignKeys = {
      whatsapp_auth_accounts: [
        { from: 'account_id', table: 'r32_accounts', to: 'id', onDelete: 'CASCADE' }
      ],
      whatsapp_auth_keys: [
        { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
      ],
      whatsapp_auth_import_receipts: [
        { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
      ],
      whatsapp_message_retry_counters: [
        { from: 'account_key', table: 'whatsapp_auth_accounts', to: 'account_key', onDelete: 'CASCADE' }
      ]
    };
    for (const [table, expected] of Object.entries(expectedForeignKeys)) {
      for (const fk of expected) assert.equal(foreignKeys(store.db, table).some(candidate => assert.deepEqual(candidate, fk) === undefined), true, `${table}.${fk.from}`);
    }

    for (const table of ['whatsapp_message_key_index', 'whatsapp_message_retry_payloads']) {
      const keys = foreignKeys(store.db, table);
      assert.equal(keys.some(key => key.from === 'canonical_message_id'
        && key.table === 'communication_canonical_messages'
        && key.to === 'message_id' && key.onDelete === 'CASCADE'), true, `${table} canonical FK`);
      assert.equal(keys.some(key => key.from === 'account_id'
        && key.table === 'r32_accounts' && key.to === 'id'
        && key.onDelete === 'CASCADE'), true, `${table} account FK`);
    }

    const indexes = [
      ['idx_whatsapp_auth_accounts_account_id', true],
      ['idx_whatsapp_auth_accounts_state_epoch', false],
      ['idx_whatsapp_auth_keys_epoch', false],
      ['idx_whatsapp_auth_import_receipts_account_state', false],
      ['idx_whatsapp_auth_import_receipts_source_active', true],
      ['idx_whatsapp_message_retry_counters_expiry', false],
      ['idx_whatsapp_message_key_index_canonical', true],
      ['idx_whatsapp_message_key_index_lookup', false],
      ['idx_whatsapp_message_retry_payloads_account', false]
    ];
    for (const [name, unique] of indexes) {
      const row = index(store.db, name);
      assert.ok(row, name);
      assert.equal(/CREATE\s+UNIQUE\s+INDEX/iu.test(String(row.sql || '')), unique, `${name} uniqueness`);
    }
  });
});

test('Schema 23 accepts valid encrypted rows, rejects malformed envelopes and cascades account deletion', () => {
  withStore(store => {
    store.upsertAccount({ id: 'wa-account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    const at = new Date().toISOString();
    const creds = validEnvelope(1);
    store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
      account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
      creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
      identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
      logged_out_at,quarantine_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'auth-account-1', 'wa-account-1', 1, 'ACTIVE', creds.cipherVersion, creds.keyVersion,
      creds.nonce, creds.ciphertext, creds.authTag, creds.ciphertextSha256, 1,
      'b'.repeat(64), 1, 'socket-token-1', at, at, '', ''
    );

    const key = validEnvelope(2);
    store.db.prepare(`INSERT INTO whatsapp_auth_keys(
      account_key,category,key_id,value_present,cipher_version,key_version,nonce,
      ciphertext,auth_tag,ciphertext_sha256,epoch,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'auth-account-1', 'session', 'key-1', 1, key.cipherVersion, key.keyVersion,
      key.nonce, key.ciphertext, key.authTag, key.ciphertextSha256, 1, at
    );
    assert.throws(() => store.db.prepare(`INSERT INTO whatsapp_auth_keys(
      account_key,category,key_id,value_present,cipher_version,key_version,nonce,
      ciphertext,auth_tag,ciphertext_sha256,epoch,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'auth-account-1', 'session', 'invalid-tombstone', 0, 1, 1,
      Buffer.alloc(12), null, null, '', 1, at
    ), /CHECK constraint failed/iu);

    store.db.prepare(`INSERT INTO whatsapp_auth_import_receipts(
      receipt_id,account_key,source_directory_hmac,manifest_a_sha256,manifest_b_sha256,
      manifest_c_sha256,staged_epoch,state,activation_sha256,failure_code,
      cleanup_reference_hmac,created_at,updated_at,activated_at,completed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'receipt-1', 'auth-account-1', 'c'.repeat(64), 'd'.repeat(64), '', '',
      2, 'IMPORT_PENDING', '', '', '', at, at, '', ''
    );
    store.db.prepare(`INSERT INTO whatsapp_message_retry_counters(
      account_key,cache_key_hmac,value_json,expires_at,updated_at
    ) VALUES(?,?,?,?,?)`).run('auth-account-1', 'e'.repeat(64), '{"attempts":1}', at, at);

    const canonicalMessageId = insertCanonicalMessage(store);
    store.db.prepare(`INSERT INTO whatsapp_message_key_index(
      account_id,remote_jid_hmac,message_id_hmac,participant_hmac,from_me,
      canonical_message_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      'wa-account-1', 'f'.repeat(64), '1'.repeat(64), '', 0, canonicalMessageId, at, at
    );
    const payload = validEnvelope(3);
    store.db.prepare(`INSERT INTO whatsapp_message_retry_payloads(
      canonical_message_id,account_id,cipher_version,key_version,nonce,ciphertext,
      auth_tag,ciphertext_sha256,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      canonicalMessageId, 'wa-account-1', payload.cipherVersion, payload.keyVersion,
      payload.nonce, payload.ciphertext, payload.authTag, payload.ciphertextSha256, at, at
    );

    store.db.prepare('DELETE FROM r32_accounts WHERE id=?').run('wa-account-1');
    for (const table of Object.keys(TABLE_COLUMNS)) {
      assert.equal(Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count), 0, `${table} cascade`);
    }
    assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS count FROM communication_canonical_messages').get().count), 1);
  });
});

test('Schema 23 records one exact completed migration receipt and remains idempotent across reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-schema23-reopen-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let first;
  let second;
  try {
    first = new R32SqliteStore({ dbPath });
    const receipt = first.db.prepare(`SELECT target_schema_version,status,checksum,report_json
      FROM r32_schema_migrations WHERE migration_id=?`).get(MIGRATION_ID);
    assert.equal(receipt.target_schema_version, 23);
    assert.equal(receipt.status, 'completed');
    assert.match(String(receipt.checksum), /^[a-f0-9]{64}$/u);
    assert.equal(JSON.parse(receipt.report_json).authority, 'WhatsAppAuthStateAuthority');
    first.close(); first = null;

    second = new R32SqliteStore({ dbPath });
    assert.equal(second.getMeta('schema_version', 0), 23);
    assert.equal(second.getMeta('schemaVersion', 0), 23);
    assert.equal(Number(second.db.prepare('SELECT COUNT(*) AS count FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID).count), 1);
  } finally {
    try { first?.close(); } catch (_) {}
    try { second?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

registerFaultMatrix();
require('./oss1aWhatsappAuthKeyAuthority.test');
