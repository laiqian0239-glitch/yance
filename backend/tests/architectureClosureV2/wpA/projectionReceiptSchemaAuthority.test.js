'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AuthorityTransactionCoordinator } = require('../../../services/authorityTransactionCoordinator');
const { createPlatformCoreRepository } = require('../../../repositories/platformCoreRepository');
const { CanonicalEventLedgerAuthority } = require('../../../services/canonicalEventLedgerAuthority');
const { ensureCanonicalProjectionReceiptSchema } = require('../../../migrations/projectionReceiptSchemaAuthority');

function withHarness(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-a8-projection-receipt-'));
  const dbPath = path.join(root, 'yance.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a8-projection-receipt-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  try {
    return callback({ root, dbPath, host, broker, store });
  } finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('legacy projection receipt foreign key is rebuilt without deleting historical receipts', () => {
  withHarness(({ store }) => {
    const db = store.db;
    db.exec(`
      DROP TRIGGER IF EXISTS acv2_projection_receipt_canonical_insert;
      DROP TRIGGER IF EXISTS acv2_projection_receipt_canonical_update;
      DROP TABLE domain_projection_receipts;
      CREATE TABLE domain_projection_receipts (
        projector_name TEXT NOT NULL, projector_version TEXT NOT NULL, event_id TEXT NOT NULL,
        projection_status TEXT NOT NULL, projection_hash TEXT NOT NULL DEFAULT '', target_refs_json TEXT NOT NULL DEFAULT '[]',
        failure_code TEXT NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
        projected_at TEXT NOT NULL, PRIMARY KEY(projector_name, projector_version, event_id),
        FOREIGN KEY(event_id) REFERENCES domain_events(event_id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO domain_events(event_id,schema_version,platform,source_account_id,event_type,idempotency_key,occurred_at,received_at)
      VALUES('legacy:event',1,'telegram','tg-1','message.received','legacy:event','2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z');
      INSERT INTO domain_projection_receipts(projector_name,projector_version,event_id,projection_status,projected_at)
      VALUES('legacy-projector','v1','legacy:event','applied','2026-08-03T00:00:00.000Z');
    `);
    const result = ensureCanonicalProjectionReceiptSchema(db);
    assert.equal(result.authority, 'CanonicalProjectionReceiptSchemaAuthority');
    assert.equal(db.prepare("PRAGMA table_info(domain_projection_receipts)").all().some(row => row.name === 'ledger_sequence'), true);
    assert.equal(db.prepare("PRAGMA foreign_key_list(domain_projection_receipts)").all().some(row => row.table === 'domain_events'), false);
    const legacy = db.prepare("SELECT * FROM domain_projection_receipts WHERE event_id='legacy:event'").get();
    assert.equal(legacy.projector_name, 'legacy-projector');
    assert.equal(legacy.ledger_sequence, 0);
  });
});

test('zero-valued canonical receipt sequences are backfilled from canonical headers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-a8-projection-backfill-'));
  const dbPath = path.join(root, 'legacy.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE canonical_event_headers (
        event_id TEXT PRIMARY KEY,
        ledger_sequence INTEGER NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY
      ) STRICT;
      CREATE TABLE domain_projection_receipts (
        projector_name TEXT NOT NULL, projector_version TEXT NOT NULL, event_id TEXT NOT NULL,
        ledger_sequence INTEGER NOT NULL DEFAULT 0, projection_status TEXT NOT NULL,
        projection_hash TEXT NOT NULL DEFAULT '', target_refs_json TEXT NOT NULL DEFAULT '[]',
        failure_code TEXT NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
        projected_at TEXT NOT NULL, PRIMARY KEY(projector_name, projector_version, event_id),
        FOREIGN KEY(event_id) REFERENCES domain_events(event_id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO canonical_event_headers(event_id,ledger_sequence) VALUES('canonical:event',7);
      INSERT INTO domain_events(event_id) VALUES('canonical:event');
      INSERT INTO domain_projection_receipts(
        projector_name,projector_version,event_id,ledger_sequence,projection_status,projected_at
      ) VALUES('canonical-projector','v1','canonical:event',0,'applied','2026-08-03T00:00:00.000Z');
    `);

    ensureCanonicalProjectionReceiptSchema(db);
    const migrated = db.prepare(`
      SELECT ledger_sequence FROM domain_projection_receipts
      WHERE projector_name='canonical-projector' AND event_id='canonical:event'
    `).get();
    assert.equal(migrated.ledger_sequence, 7);
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('new projection receipts require the committed canonical event and exact ledger sequence', () => {
  withHarness(({ store }) => {
    const coordinator = new AuthorityTransactionCoordinator({ store, eventBus: { publish() {} } });
    const repository = createPlatformCoreRepository({
      storeProvider: () => store,
      coordinatorCapability: coordinator.repositoryCapability()
    });
    const ledger = new CanonicalEventLedgerAuthority({ coordinator, store, compatibilityRepository: repository });
    const appended = ledger.append({
      platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'projection-receipt-1',
      eventType: 'message.received', payload: { text: 'Hallo' }
    });
    const receipt = ledger.recordShadowProjection({
      eventId: appended.event.eventId, projectorName: 'message-projection', projectorVersion: 'v1',
      expectedProjection: { text: 'Hallo' }, actualProjection: { text: 'Hallo' }
    });
    assert.equal(receipt.matches, true);
    assert.equal(receipt.receipt.ledger_sequence, appended.event.ledgerSequence);
    assert.throws(() => store.db.prepare(`
      INSERT INTO domain_projection_receipts(
        projector_name,projector_version,event_id,ledger_sequence,projection_status,projected_at
      ) VALUES('forged','v1',?,?,'applied','2026-08-03T00:00:00.000Z')
    `).run(appended.event.eventId, appended.event.ledgerSequence + 1), /CANONICAL_PROJECTION_RECEIPT_EVENT_REQUIRED/);
  });
});
