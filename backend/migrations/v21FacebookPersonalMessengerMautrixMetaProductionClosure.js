'use strict';

const crypto = require('node:crypto');

const MIGRATION_ID = '024_v21_facebook_personal_messenger_mautrix_meta_production_closure';
const TARGET_SCHEMA_VERSION = 24;
const OLD_DRIVER = 'facebook-personal-messenger-experimental';
const NEW_DRIVER = 'facebook-personal-messenger-mautrix-meta';
const OLD_ISOLATION = 'isolated-browser-session';
const NEW_ISOLATION = 'matrix-application-service';
const CHECKSUM = crypto.createHash('sha256').update(JSON.stringify({
  migrationId: MIGRATION_ID,
  targetSchemaVersion: TARGET_SCHEMA_VERSION,
  oldDriver: OLD_DRIVER,
  newDriver: NEW_DRIVER,
  oldIsolation: OLD_ISOLATION,
  newIsolation: NEW_ISOLATION
})).digest('hex');

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
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
function parsePayload(value) {
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch (_) { const error = new Error('Schema 24 found invalid r32_accounts payload_json'); error.code = 'FACEBOOK_PERSONAL_SCHEMA24_ACCOUNT_PAYLOAD_INVALID'; throw error; }
}
function personalMessenger(payload = {}) {
  const kind = String(payload.accountKind || payload.metadata?.accountKind || '').trim().toLowerCase();
  const driver = String(payload.driverId || payload.metadata?.driverId || '').trim();
  return kind === 'personal-messenger' || driver === OLD_DRIVER;
}
function rewritePayload(payload = {}) {
  if (!personalMessenger(payload)) return { changed: false, payload };
  const metadata = { ...(payload.metadata || {}) };
  metadata.accountKind = 'personal-messenger';
  metadata.driverId = NEW_DRIVER;
  metadata.protocolAuthority = 'mautrix-meta';
  metadata.isolationModel = NEW_ISOLATION;
  delete metadata.browserSessionRef;
  delete metadata.experimental;
  delete metadata.experimentalOptIn;
  delete metadata.riskDisclosureAcceptedAt;
  const next = {
    ...payload,
    accountKind: 'personal-messenger',
    driverId: NEW_DRIVER,
    metadata
  };
  delete next.browserSessionRef;
  delete next.experimental;
  return { changed: JSON.stringify(next) !== JSON.stringify(payload), payload: next };
}
function applyV21FacebookPersonalMessengerMautrixMetaProductionClosure(db) {
  if (!db) throw new TypeError('Schema 24 migration requires a SQLite database');
  ensureMigrationTable(db);
  const existing = db.prepare('SELECT migration_id,target_schema_version,status,checksum,report_json FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (existing) {
    if (Number(existing.target_schema_version) !== TARGET_SCHEMA_VERSION || String(existing.checksum || '') !== CHECKSUM || String(existing.status || '') !== 'completed') {
      const error = new Error('Schema 24 Facebook Personal Messenger migration receipt does not match the frozen contract');
      error.code = 'FACEBOOK_PERSONAL_SCHEMA24_RECEIPT_MISMATCH';
      throw error;
    }
    return JSON.parse(existing.report_json || '{}');
  }
  const at = nowIso();
  let scanned = 0;
  let rewritten = 0;
  const rewrittenAccountIds = [];
  if (tableExists(db, 'r32_accounts')) {
    const rows = db.prepare("SELECT id,payload_json FROM r32_accounts WHERE platform='facebook' ORDER BY id").all();
    const update = db.prepare('UPDATE r32_accounts SET payload_json=?, updated_at=? WHERE id=?');
    for (const row of rows) {
      scanned += 1;
      const current = parsePayload(row.payload_json);
      const result = rewritePayload(current);
      if (!result.changed) continue;
      update.run(JSON.stringify(result.payload), at, String(row.id));
      rewritten += 1;
      rewrittenAccountIds.push(String(row.id));
    }
  }
  const report = Object.freeze({
    migrationId: MIGRATION_ID,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    oldDriver: OLD_DRIVER,
    newDriver: NEW_DRIVER,
    retiredIsolationModel: OLD_ISOLATION,
    isolationModel: NEW_ISOLATION,
    scanned,
    rewritten,
    rewrittenAccountIds,
    completedAt: at
  });
  db.prepare(`INSERT INTO r32_schema_migrations(
    migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
  ) VALUES(?,?,?,?,?,?,?)`).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, 'completed', CHECKSUM, at, at, JSON.stringify(report));
  return report;
}

module.exports = Object.freeze({
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  OLD_DRIVER,
  NEW_DRIVER,
  OLD_ISOLATION,
  NEW_ISOLATION,
  CHECKSUM,
  rewritePayload,
  applyV21FacebookPersonalMessengerMautrixMetaProductionClosure
});
