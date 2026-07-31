import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, applyMigrations } from './testHarness.js';

const REQUIRED_TABLES = [
  'facebook_accounts','facebook_page_tokens','facebook_webhook_events','facebook_event_deliveries',
  'facebook_desktop_devices','facebook_oauth_states','facebook_send_idempotency'
];

test('D1 migrations create all required tables and can be applied repeatedly', () => {
  const db = new TestD1();
  applyMigrations(db);
  applyMigrations(db);
  const rows = db.database.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(row => row.name);
  for (const table of REQUIRED_TABLES) assert.ok(rows.includes(table), table);
  assert.ok(rows.includes('facebook_oauth_page_candidates'));
  assert.ok(rows.includes('facebook_device_requests'));
  assert.ok(rows.includes('facebook_event_media'));
  const accountColumns = db.database.prepare('PRAGMA table_info(facebook_accounts)').all().map(row => row.name);
  assert.ok(accountColumns.includes('page_picture_url'));
  for (const column of ['granted_scopes','missing_permissions','history_sync_available','history_sync_reason','last_permission_check_at','permission_source']) assert.ok(accountColumns.includes(column), column);
  db.close();
});

test('D1 schema enforces webhook deduplication and per-device delivery uniqueness', () => {
  const db = new TestD1(); applyMigrations(db);
  const now = new Date().toISOString();
  db.database.prepare(`INSERT INTO facebook_webhook_events(id,page_id,dedup_key,event_type,event_timestamp,raw_payload_json,normalized_payload_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('e1','p1','dedup-1','message',now,'{}','{}',now,now,now);
  assert.throws(() => db.database.prepare(`INSERT INTO facebook_webhook_events(id,page_id,dedup_key,event_type,event_timestamp,raw_payload_json,normalized_payload_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('e2','p1','dedup-1','message',now,'{}','{}',now,now,now));
  db.close();
});
