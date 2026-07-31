'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

/**
 * AC-037 + AC-038 integration tests.
 * AC-037: blocking stale candidates/outbox at coordinator level
 * AC-038: signature status API
 */

function makeStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = off');
  db.exec('PRAGMA foreign_keys = on');
  db.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '')`);
  db.exec(`CREATE TABLE persona_brain_profiles (
    profile_id TEXT PRIMARY KEY, active_version INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
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
  db.exec(`INSERT INTO contacts (id, platform) VALUES ('c1','whatsapp')`);
  return { db };
}

function makePersonaBrainStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = off');
  db.exec('PRAGMA foreign_keys = on');
  db.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT '')`);
  db.exec(`INSERT INTO contacts (id, platform) VALUES ('owner','whatsapp')`);
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
    from_version INTEGER NOT NULL DEFAULT 0, to_version INTEGER NOT NULL DEFAULT 0,
    operation TEXT NOT NULL, changed_paths_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'user',
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`);
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
  return { db, transaction(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }};
}

describe('AC-037: Stale candidate/outbox blocking', () => {
  it('generated candidates are invalidated when profile version advances', () => {
    const db = makeStore();
    const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
    const coordinator = createPersonaCandidateCoordinator({ store: db });

    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO ai_reply_candidates (candidate_id, task_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('c-gen', 't1', 'c1', 'conv1', 'hello', 'hello', 'generated', 1, now, now);

    coordinator.invalidateForPersonaVersion('owner', 2);

    const row = db.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('c-gen');
    assert.strictEqual(row.state, 'reverify_required');
  });

  it('approved candidates are NOT invalidated', () => {
    const db = makeStore();
    const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
    const coordinator = createPersonaCandidateCoordinator({ store: db });

    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO ai_reply_candidates (candidate_id, task_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('c-approved', 't1', 'c1', 'conv1', 'hello', 'hello', 'approved', 1, now, now);

    coordinator.invalidateForPersonaVersion('owner', 2);

    const row = db.db.prepare('SELECT state FROM ai_reply_candidates WHERE candidate_id=?').get('c-approved');
    assert.strictEqual(row.state, 'approved');
  });

  it('draft outbox items are invalidated when profile version advances', () => {
    const db = makeStore();
    const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
    const coordinator = createPersonaCandidateCoordinator({ store: db });

    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO ai_reply_outbox (id, task_id, candidate_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('o-draft', 't1', 'c1', 'c1', 'conv1', 'hello', 'hello', 'draft', 1, now, now);

    coordinator.invalidateForPersonaVersion('owner', 2);

    const row = db.db.prepare('SELECT state FROM ai_reply_outbox WHERE id=?').get('o-draft');
    assert.strictEqual(row.state, 'reverify_required');
  });

  it('countReverifyRequired returns correct counts after invalidation', () => {
    const db = makeStore();
    const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
    const coordinator = createPersonaCandidateCoordinator({ store: db });

    const now = new Date().toISOString();
    db.db.prepare(
      `INSERT INTO ai_reply_candidates (candidate_id, task_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('c-stale', 't1', 'c1', 'conv1', 'hello', 'hello', 'generated', 1, now, now);
    db.db.prepare(
      `INSERT INTO ai_reply_outbox (id, task_id, candidate_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('o-stale', 't2', 'c1', 'c1', 'conv1', 'hello', 'hello', 'draft', 1, now, now);

    coordinator.invalidateForPersonaVersion('owner', 2);
    const counts = coordinator.countReverifyRequired('owner');
    assert.strictEqual(counts.candidates, 1);
    assert.strictEqual(counts.outbox, 1);
    assert.strictEqual(counts.total, 2);
  });
});

describe('AC-038: Signature Status API', () => {
  let store, brain;

  beforeEach(() => {
    store = makePersonaBrainStore();
    const { createPersonaBrain } = require('../../personaBrain');
    const { createPersonaCandidateCoordinator } = require('../../personaBrain/candidateCoordinator');
    const { createPersonaValidator } = require('../../personaBrain/validator');
    const coordinator = createPersonaCandidateCoordinator({ store });
    const validator = createPersonaValidator({ validatorFn: () => ({ valid: true }) });
    brain = createPersonaBrain({
      store: { db: store.db, transaction: store.transaction },
      candidateCoordinator: coordinator, validator
    });
    brain.service.initialize({ profileId: 'owner', reason: 'test init' });
  });

  it('getSignatureStatus returns active version and zero counts when fresh', () => {
    const status = brain.service.getSignatureStatus('owner');
    assert.ok(status, 'Should return status object');
    assert.ok(typeof status.activeVersion === 'number', 'activeVersion should be a number');
    assert.strictEqual(status.reverifyRequired.candidates, 0);
    assert.strictEqual(status.reverifyRequired.outbox, 0);
  });

  it('getSignatureStatus returns non-zero counts after persona update', () => {
    const now = new Date().toISOString();
    // Insert candidate BEFORE persona update (so it can be invalidated)
    store.db.prepare(
      `INSERT INTO ai_reply_candidates (candidate_id, task_id, contact_id, conversation_id, text, original_text, state, persona_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('c1', 't1', 'owner', 'conv1', 'hello', 'hello', 'generated', 1, now, now);

    // Update persona version to 2
    brain.service.updateAuthoritative({
      profileId: 'owner',
      patch: { coreIdentity: { name: 'Alice' } },
      reason: 'test update'
    });

    const status = brain.service.getSignatureStatus('owner');
    assert.strictEqual(status.reverifyRequired.candidates, 1);
    assert.strictEqual(typeof status.reverifyRequired.outbox, 'number');
  });
});
