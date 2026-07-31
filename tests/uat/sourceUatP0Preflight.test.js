'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { localState, criticalEmptyCatchAudit } = require('../../tools/uat/sourceUatP0Preflight');

test('P0 local preflight reads SQLite without mutating it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-p0-'));
  fs.mkdirSync(path.join(root, 'store'), { recursive: true });
  const dbPath = path.join(root, 'store', 'yance-r32.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE r32_meta(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT);
    INSERT INTO r32_meta VALUES('schema_version','1','now');
    CREATE TABLE r32_accounts(id TEXT,platform TEXT,payload_json TEXT);
    CREATE TABLE r32_conversations(session_key TEXT);
    CREATE TABLE contacts(id TEXT,platform TEXT,avatar_url TEXT,merged_into_id TEXT);
    CREATE TABLE whatsapp_identity_authority(account_id TEXT);
    CREATE TABLE identity_aliases(id TEXT);
    CREATE TABLE identity_merge_audit(id TEXT);
  `);
  db.close();
  const before = fs.readFileSync(dbPath);
  const state = localState(root);
  const after = fs.readFileSync(dbPath);
  assert.equal(state.database.exists, true);
  assert.equal(state.schemaVersion, 1);
  assert.equal(Object.values(state.requiredTables).every(Boolean), true);
  assert.deepEqual(after, before);
  assert.ok(state.requiredColumns.contacts.missing.includes('canonical_contact_id'));
});

test('P0 critical-path audit rejects no-op catches in guarded files', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const audit = criticalEmptyCatchAudit(repoRoot);
  assert.equal(audit.count, 0, JSON.stringify(audit.findings, null, 2));
});
