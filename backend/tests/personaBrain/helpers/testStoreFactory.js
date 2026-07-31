'use strict';
// Shared test store factory — used by personaBrain integration tests

const { DatabaseSync } = require('node:sqlite');

function makeFullStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = off');
  db.exec('PRAGMA foreign_keys = on');

  // contacts (FK dependency for ai_reply_candidates)
  db.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '')`);

  // persona brain tables
  db.exec(`CREATE TABLE persona_brain_profiles (
    profile_id TEXT PRIMARY KEY, active_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE persona_brain_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
    version INTEGER NOT NULL, operation TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL, content_sha256 TEXT NOT NULL DEFAULT '',
    parent_version INTEGER NOT NULL DEFAULT 0, changed_paths_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '', rollback_of_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(profile_id, version)
  )`);

  db.exec(`CREATE TABLE persona_brain_change_log (
    change_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
    from_version INTEGER NOT NULL DEFAULT 0, to_version INTEGER NOT NULL DEFAULT 0,
    operation TEXT NOT NULL, changed_paths_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'user',
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`);

  // AI reply candidate + outbox tables
  db.exec(`CREATE TABLE ai_reply_candidates (
    candidate_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '', context_version INTEGER NOT NULL DEFAULT 0,
    entity_versions_json TEXT NOT NULL DEFAULT '{}',
    reply_strategy_json TEXT NOT NULL DEFAULT '{}',
    relationship_potential_json TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'generated',
    persona_version_id INTEGER NOT NULL DEFAULT 0,
    persona_policy_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(contact_id) REFERENCES contacts(id)
  )`);

  db.exec(`CREATE TABLE ai_reply_outbox (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '', original_text TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'draft', user_approved INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
    send_queue_id TEXT NOT NULL DEFAULT '', context_version INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    persona_version_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(contact_id) REFERENCES contacts(id)
  )`);

  db.exec(`CREATE TABLE ai_reply_tasks (
    task_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '',
    context_version INTEGER NOT NULL DEFAULT 0, entity_versions_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);

  // Seed a default contact for FK constraints
  db.prepare(`INSERT INTO contacts (id, platform, account_id) VALUES ('owner', 'whatsapp', 'local')`).run();

  return {
    db,
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => {}
  };
}

module.exports = { makeFullStore };
