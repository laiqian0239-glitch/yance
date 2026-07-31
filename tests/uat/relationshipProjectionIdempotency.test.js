'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../../backend/store/adapters/SqliteStorePersistenceAdapter');
const { parseSocialSignals } = require('../../backend/store/social/socialSignalParser');
const { evolveRelationship } = require('../../backend/store/social/relationTrailEngine');

function tempStore(prefix = 'yance-relationship-idempotency-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, 'store.db');
  const store = new R32SqliteStore({ dbPath });
  return {
    root,
    dbPath,
    store,
    cleanup() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

function input(overrides = {}) {
  const sourceAccountId = overrides.sourceAccountId || 'wa-account-1';
  const conversationId = overrides.conversationId || 'conv-1';
  const contactId = overrides.contactId || 'contact-1';
  const messageId = overrides.messageId || 'platform-message-1';
  return {
    contactId,
    conversationId,
    platform: 'whatsapp',
    sourceAccountId,
    recentMessages: [],
    relationship: {},
    message: {
      id: messageId,
      platformMessageId: messageId,
      platform: 'whatsapp',
      sourceAccountId,
      conversationId,
      direction: 'inbound',
      fromMe: false,
      text: 'Ich bin heute sehr müde und erschöpft.',
      sentAt: '2026-07-22T10:00:00.000Z'
    }
  };
}

test('same source message produces deterministic signal and relationship event identities', () => {
  const source = input();
  const firstSignals = parseSocialSignals(source);
  const secondSignals = parseSocialSignals(source);
  assert.ok(firstSignals.length > 0);
  assert.deepEqual(secondSignals.map(row => row.signalId), firstSignals.map(row => row.signalId));
  assert.deepEqual(secondSignals.map(row => row.idempotencyKey), firstSignals.map(row => row.idempotencyKey));

  const first = evolveRelationship({ ...source, signals: firstSignals, previous: {} });
  const second = evolveRelationship({ ...source, signals: secondSignals, previous: first });
  assert.ok(first.timelineEvents.length > 0);
  assert.equal(second.timelineEvents.length, 0, 'replayed signal must not create a fresh timeline event');
  assert.equal(second.timeline.length, first.timeline.length);
  assert.deepEqual(second.potential, first.potential, 'replay must not apply relationship effects twice');
});

test('same platform message id remains isolated by source account and conversation in real SQLite', async () => {
  const fixture = tempStore();
  try {
    const { store } = fixture;
    const now = '2026-07-22T10:00:00.000Z';
    for (const row of [
      { id: 'contact-1', account: 'wa-account-1' },
      { id: 'contact-2', account: 'wa-account-2' }
    ]) {
      store.db.prepare(`
        INSERT INTO contacts(id, platform, account_id, external_id, display_name, created_at, updated_at)
        VALUES (?, 'whatsapp', ?, ?, ?, ?, ?)
      `).run(row.id, row.account, `${row.id}@s.whatsapp.net`, row.id, now, now);
    }

    const firstInput = input();
    const secondInput = input({ contactId: 'contact-2', sourceAccountId: 'wa-account-2', conversationId: 'conv-2' });
    const firstSignals = parseSocialSignals(firstInput);
    const secondSignals = parseSocialSignals(secondInput);
    const firstRelationship = evolveRelationship({ ...firstInput, signals: firstSignals, previous: {} });
    const secondRelationship = evolveRelationship({ ...secondInput, signals: secondSignals, previous: {} });
    assert.notEqual(firstSignals[0].idempotencyKey, secondSignals[0].idempotencyKey);
    assert.notEqual(firstRelationship.timelineEvents[0].idempotencyKey, secondRelationship.timelineEvents[0].idempotencyKey);

    const adapter = new SqliteStorePersistenceAdapter({ store });
    await adapter.transaction(async transaction => {
      transaction.upsertSocialSignals(firstSignals);
      transaction.upsertTimelineEvents(firstRelationship.timelineEvents);
      transaction.upsertSocialSignals(firstSignals);
      transaction.upsertTimelineEvents(firstRelationship.timelineEvents);
      transaction.upsertSocialSignals(secondSignals);
      transaction.upsertTimelineEvents(secondRelationship.timelineEvents);
    });

    const signalRows = store.db.prepare(`
      SELECT platform, source_account_id, conversation_id, platform_message_id, idempotency_key
      FROM relationship_state_signals ORDER BY source_account_id
    `).all();
    const eventRows = store.db.prepare(`
      SELECT platform, source_account_id, conversation_id, platform_message_id, idempotency_key
      FROM relationship_timeline_events ORDER BY source_account_id
    `).all();
    assert.equal(signalRows.length, firstSignals.length + secondSignals.length);
    assert.equal(eventRows.length, firstRelationship.timelineEvents.length + secondRelationship.timelineEvents.length);
    assert.deepEqual([...new Set(signalRows.map(row => row.source_account_id))], ['wa-account-1', 'wa-account-2']);
    assert.deepEqual([...new Set(eventRows.map(row => row.source_account_id))], ['wa-account-1', 'wa-account-2']);
    assert.equal(new Set(signalRows.map(row => row.idempotency_key)).size, signalRows.length);
    assert.equal(new Set(eventRows.map(row => row.idempotency_key)).size, eventRows.length);
  } finally {
    fixture.cleanup();
  }
});

test('legacy relationship tables migrate in place with partial unique idempotency indexes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-relationship-legacy-'));
  const dbPath = path.join(root, 'store.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE relationship_state_signals (
      signal_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL, signal_type TEXT NOT NULL, dimension TEXT NOT NULL, direction TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, observed_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'social_parser',
      parser_version TEXT NOT NULL DEFAULT '1.0', status TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX idx_relationship_signals_message_type
      ON relationship_state_signals(message_id, signal_type);
    CREATE TABLE relationship_timeline_events (
      event_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL, started_at TEXT NOT NULL, confirmed_at TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', interpretation TEXT NOT NULL DEFAULT '',
      evidence_message_ids_json TEXT NOT NULL DEFAULT '[]', source_signal_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'candidate', engine_version TEXT NOT NULL DEFAULT '1.0',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
  `);
  legacy.close();

  const store = new R32SqliteStore({ dbPath });
  try {
    for (const table of ['relationship_state_signals', 'relationship_timeline_events']) {
      const columns = new Set(store.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      for (const name of ['idempotency_key', 'platform', 'source_account_id', 'platform_message_id', 'projection_version']) {
        assert.equal(columns.has(name), true, `${table}.${name}`);
      }
      const indexes = new Set(store.db.prepare(`PRAGMA index_list(${table})`).all().map(row => row.name));
      assert.equal([...indexes].some(name => name.includes('idempotency')), true, `${table} idempotency index`);
      assert.equal([...indexes].some(name => name.includes('scope')), true, `${table} scope index`);
    }
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
