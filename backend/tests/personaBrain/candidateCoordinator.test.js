'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

/** Minimal in-memory SQLite store for coordinator tests — uses node:sqlite */
function makeStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = off');
  db.exec('PRAGMA foreign_keys = on');

  // contacts table (required FK)
  db.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '')`);

  // candidates
  db.exec(`CREATE TABLE ai_reply_candidates (
    candidate_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    context_version INTEGER NOT NULL DEFAULT 0,
    entity_versions_json TEXT NOT NULL DEFAULT '{}',
    reply_strategy_json TEXT NOT NULL DEFAULT '{}',
    relationship_potential_json TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'generated',
    persona_version_id INTEGER NOT NULL DEFAULT 0,
    persona_policy_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // outbox
  db.exec(`CREATE TABLE ai_reply_outbox (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'draft',
    user_approved INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT NOT NULL DEFAULT '',
    approved_by TEXT NOT NULL DEFAULT '',
    send_queue_id TEXT NOT NULL DEFAULT '',
    context_version INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    persona_version_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  return { db };
}

function insertContact(db, id = 'c1') {
  db.exec(`INSERT INTO contacts(id) VALUES ('${id}')`);
}

function insertCandidate(db, id, state, personaVersionId = 0) {
  const sql = `INSERT INTO ai_reply_candidates(candidate_id,task_id,contact_id,conversation_id,text,original_text,model_id,model_name,context_version,entity_versions_json,reply_strategy_json,relationship_potential_json,state,persona_version_id,persona_policy_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  db.prepare(sql).run(id, 't1', 'c1', 'conv1', 'text', 'otext', 'm1', 'M1', 0, '{}', '{}', '{}', state, personaVersionId, '', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
}

function insertOutbox(db, id, state, personaVersionId = 0) {
  const sql = `INSERT INTO ai_reply_outbox(id,task_id,candidate_id,contact_id,conversation_id,account_id,platform,text,original_text,state,user_approved,approved_at,approved_by,send_queue_id,context_version,metadata_json,persona_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  db.prepare(sql).run(id, 't1', 'c1', 'c1', 'conv1', 'acc1', 'wechat', 'text', 'otext', state, 0, '', '', '', 0, '{}', personaVersionId, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
}

const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');

describe('AC-040 candidateCoordinator', () => {
  let store;
  beforeEach(() => { store = makeStore(); insertContact(store.db); });

  describe('invalidateForPersonaVersion', () => {
    it('invalidates generated candidates older than new version', () => {
      insertCandidate(store.db, 'gen1', 'generated', 1);
      insertCandidate(store.db, 'gen2', 'generated', 2);
      insertCandidate(store.db, 'approved1', 'approved', 1);

      const coord = createPersonaCandidateCoordinator({ store });
      const result = coord.invalidateForPersonaVersion('owner', 3);

      assert.strictEqual(result.invalidatedCandidates, 2); // gen1 + gen2
      assert.strictEqual(result.newPersonaVersion, 3);
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('gen1').state, 'reverify_required');
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('gen2').state, 'reverify_required');
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('approved1').state, 'approved'); // unchanged
    });

    it('does not invalidate candidates at or above new version', () => {
      insertCandidate(store.db, 'gen3', 'generated', 5);
      insertCandidate(store.db, 'gen2', 'generated', 3);

      const coord = createPersonaCandidateCoordinator({ store });
      coord.invalidateForPersonaVersion('owner', 3);

      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('gen3').state, 'generated'); // unchanged
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('gen2').state, 'generated'); // unchanged
    });

    it('invalidates draft outbox items older than new version', () => {
      insertOutbox(store.db, 'draft1', 'draft', 1);
      insertOutbox(store.db, 'draft2', 'draft', 2);
      insertOutbox(store.db, 'approved1', 'approved', 1);

      const coord = createPersonaCandidateCoordinator({ store });
      const result = coord.invalidateForPersonaVersion('owner', 3);

      assert.strictEqual(result.invalidatedOutbox, 2);
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get('draft1').state, 'reverify_required');
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get('draft2').state, 'reverify_required');
      assert.strictEqual(store.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get('approved1').state, 'approved'); // unchanged
    });

    it('does not invalidate sent/queued/failed outbox items', () => {
      for (const state of ['sent', 'queued', 'failed']) {
        const s = makeStore(); insertContact(s.db);
        insertOutbox(s.db, `out_${state}`, state, 1);
        const coord = createPersonaCandidateCoordinator({ store: s });
        coord.invalidateForPersonaVersion('owner', 3);
        assert.strictEqual(s.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get(`out_${state}`).state, state, `state=${state} should be unchanged`);
      }
    });

    it('returns profileId and newPersonaVersion', () => {
      const coord = createPersonaCandidateCoordinator({ store });
      const result = coord.invalidateForPersonaVersion('owner', 7);
      assert.strictEqual(result.profileId, 'owner');
      assert.strictEqual(result.newPersonaVersion, 7);
      assert.ok(result.at);
    });

    it('zero invalidation when no stale candidates/outbox', () => {
      const coord = createPersonaCandidateCoordinator({ store });
      const result = coord.invalidateForPersonaVersion('owner', 1);
      assert.strictEqual(result.invalidatedCandidates, 0);
      assert.strictEqual(result.invalidatedOutbox, 0);
    });
  });

  describe('countReverifyRequired', () => {
    it('counts both candidates and outbox reverify_required items', () => {
      insertCandidate(store.db, 'c1', 'reverify_required');
      insertCandidate(store.db, 'c2', 'reverify_required');
      insertCandidate(store.db, 'c3', 'generated');
      insertOutbox(store.db, 'o1', 'reverify_required');

      const coord = createPersonaCandidateCoordinator({ store });
      const counts = coord.countReverifyRequired();

      assert.strictEqual(counts.candidates, 2);
      assert.strictEqual(counts.outbox, 1);
      assert.strictEqual(counts.total, 3);
    });

    it('returns zeros when none', () => {
      const coord = createPersonaCandidateCoordinator({ store });
      const counts = coord.countReverifyRequired();
      assert.strictEqual(counts.total, 0);
    });
  });
});
