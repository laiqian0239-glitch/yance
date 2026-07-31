import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from '../src/cleanup.js';
import { testEnv } from './testHarness.js';

function insertEvent(env, { id, status, deliveryStatus, createdAt, expiresAt }) {
  const payload = JSON.stringify({ object: 'page', entry: [] });
  env.DB.database.prepare(`INSERT INTO facebook_webhook_events(id,page_id,dedup_key,event_type,event_timestamp,raw_payload_json,normalized_payload_json,processing_status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,'page-1',`dedup-${id}`,'message',createdAt,payload,payload,status,createdAt,createdAt,expiresAt);
  if (deliveryStatus) env.DB.database.prepare(`INSERT INTO facebook_event_deliveries(id,event_id,device_id,status,first_available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(`delivery-${id}`,id,'device-1',deliveryStatus,createdAt,createdAt,createdAt);
}

test('Cleanup removes expired ACKed data but retains dead-letter events for the longer retention window', async t => {
  const env = testEnv(); t.after(() => env.DB.close());
  const now = '2026-07-18T12:00:00.000Z';
  insertEvent(env, { id: 'acked-old', status: 'acked', deliveryStatus: 'acked', createdAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-10T00:00:00.000Z' });
  insertEvent(env, { id: 'dead-recent', status: 'pending', deliveryStatus: 'dead-letter', createdAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-10T00:00:00.000Z' });
  insertEvent(env, { id: 'dead-old', status: 'pending', deliveryStatus: 'dead-letter', createdAt: '2026-05-01T00:00:00.000Z', expiresAt: '2026-05-10T00:00:00.000Z' });
  await cleanup(env, { now, deadLetterRetentionDays: 30 });
  assert.equal(env.DB.database.prepare(`SELECT COUNT(*) AS count FROM facebook_webhook_events WHERE id='acked-old'`).get().count, 0);
  assert.equal(env.DB.database.prepare(`SELECT COUNT(*) AS count FROM facebook_webhook_events WHERE id='dead-recent'`).get().count, 1);
  assert.equal(env.DB.database.prepare(`SELECT COUNT(*) AS count FROM facebook_webhook_events WHERE id='dead-old'`).get().count, 0);
});
