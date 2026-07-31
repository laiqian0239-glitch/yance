'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
const { createPersonaValidator } = require('../../personaBrain/validator');
const { createPersonaBrain } = require('../../personaBrain');

/**
 * Minimal in-memory store shim — mirrors real R32SqliteStore shape.
 * - persona brain tables: created by ensurePersonaBrainSchema() inside createPersonaBrain
 * - candidate/outbox tables: created here (store-layer, not brain-layer)
 * - contacts table: created here (FK dependency for candidate/outbox FK)
 */
function makeStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = off');
  db.exec('PRAGMA foreign_keys = on');

  // contacts (FK dependency for ai_reply_candidates)
  db.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '')`);

  // candidate + outbox (store-layer tables — not created by ensurePersonaBrainSchema)
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
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
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
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  )`);

  // persona brain schema (created by ensurePersonaBrainSchema inside createPersonaBrain)
  db.exec(`CREATE TABLE persona_brain_profiles (
    profile_id TEXT PRIMARY KEY, active_version INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE persona_brain_versions (
    profile_id TEXT NOT NULL, version INTEGER NOT NULL,
    parent_version INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1,
    operation TEXT NOT NULL, content_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
    changed_paths_json TEXT NOT NULL DEFAULT '[]', change_reason TEXT NOT NULL DEFAULT '',
    change_source TEXT NOT NULL DEFAULT 'user', rollback_of_version INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    PRIMARY KEY(profile_id, version)
  )`);
  db.exec(`CREATE TABLE persona_brain_change_log (
    change_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
    from_version INTEGER NOT NULL DEFAULT 0, to_version INTEGER NOT NULL,
    operation TEXT NOT NULL, changed_paths_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'user',
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE persona_brain_migration_runs (
    migration_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
    source_kind TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '',
    source_fingerprint TEXT NOT NULL, from_schema_version INTEGER NOT NULL,
    to_schema_version INTEGER NOT NULL, status TEXT NOT NULL,
    report_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`);

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
    }
  };
}

function createBrain(options = {}) {
  const store = makeStore();
  const coordinator = createPersonaCandidateCoordinator({ store });
  const validator = createPersonaValidator({
    validatorFn: content => {
      if (options.validatorFn) return options.validatorFn(content);
      return { valid: true };
    }
  });
  return createPersonaBrain({ store, candidateCoordinator: coordinator, validator });
}

describe('AC-039/040 service integration', () => {
  let brain;
  beforeEach(() => {
    brain = createBrain();
    brain.service.initialize({ profileId: 'owner', reason: 'test init' });
  });

  describe('AC-039 validator integration', () => {
    it('updateAuthoritative passes with validator accepting content', () => {
      brain.service.updateAuthoritative({
        profileId: 'owner',
        patch: { coreIdentity: { name: 'Alice' } },
        reason: 'set name'
      });
      // no throw = pass
    });

    it('updateAuthoritative rejects when validator returns errors', () => {
      brain = createBrain({
        validatorFn: () => ({ valid: false, errors: [{ rule: 'TEST', message: 'bad content' }] })
      });
      brain.service.initialize({ profileId: 'owner' });

      assert.throws(
        () => brain.service.updateAuthoritative({
          profileId: 'owner',
          patch: { coreIdentity: { name: 'Bob' } }
        }),
        err => err.code === 'PERSONA_VALIDATION_FAILED' && err.status === 422
      );
    });

    // AC-039 validator unavailable → reject; covered by validator.test.js unit tests
  });

  describe('AC-040 candidateCoordinator integration', () => {
    function insertCandidate(id, personaVersionId = 1, state = 'generated') {
      brain.store.db.prepare("INSERT OR IGNORE INTO contacts(id) VALUES (?)").run('owner');
      const sql = `INSERT INTO ai_reply_candidates(candidate_id,task_id,contact_id,conversation_id,text,original_text,model_id,model_name,context_version,entity_versions_json,reply_strategy_json,relationship_potential_json,state,persona_version_id,persona_policy_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      brain.store.db.prepare(sql).run(id, 't1', 'owner', 'conv1', 'text', 'otext', 'm1', 'M1', 0, '{}', '{}', '{}', state, personaVersionId, '', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
    }

    function insertOutbox(id, personaVersionId = 1, state = 'draft') {
      brain.store.db.prepare("INSERT OR IGNORE INTO contacts(id) VALUES (?)").run('owner');
      const sql = `INSERT INTO ai_reply_outbox(id,task_id,candidate_id,contact_id,conversation_id,account_id,platform,text,original_text,state,user_approved,approved_at,approved_by,send_queue_id,context_version,metadata_json,persona_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      brain.store.db.prepare(sql).run(id, 't1', 'c1', 'owner', 'conv1', 'acc1', 'wechat', 'text', 'otext', state, 0, '', '', '', 0, '{}', personaVersionId, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
    }

    it('updateAuthoritative invalidates stale generated candidates', () => {
      insertCandidate('c1', 1, 'generated');
      // current version is 1; after update version becomes 2
      brain.service.updateAuthoritative({
        profileId: 'owner',
        patch: { coreIdentity: { name: 'Eve' } },
        reason: 'test'
      });

      const row = brain.store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('c1');
      assert.strictEqual(row.state, 'reverify_required');
    });

    it('approved candidates are NOT invalidated', () => {
      insertCandidate('c2', 1, 'approved');
      brain.service.updateAuthoritative({
        profileId: 'owner',
        patch: { coreIdentity: { name: 'Frank' } },
        reason: 'test'
      });

      const row = brain.store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('c2');
      assert.strictEqual(row.state, 'approved');
    });

    it('outbox draft items are invalidated on persona update', () => {
      insertOutbox('o1', 1, 'draft');
      brain.service.updateAuthoritative({
        profileId: 'owner',
        patch: { coreIdentity: { name: 'Grace' } },
        reason: 'test'
      });

      const row = brain.store.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get('o1');
      assert.strictEqual(row.state, 'reverify_required');
    });

    it('countReverifyRequired returns correct counts', () => {
      insertCandidate('c3', 1, 'reverify_required');
      insertOutbox('o2', 1, 'reverify_required');

      const counts = brain.candidateCoordinator.countReverifyRequired();
      assert.strictEqual(counts.candidates, 1);
      assert.strictEqual(counts.outbox, 1);
      assert.strictEqual(counts.total, 2);
    });
  });
});
