import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../src/config.js';
import { cacheEventMedia, cleanupExpiredMedia, fetchMetaMedia, retryPendingMedia, validateMetaMediaUrl } from '../src/media.js';
import { testEnv } from './testHarness.js';

function seedMediaEvent(env, eventId = 'event-media') {
  const now = new Date().toISOString();
  const payload = { object: 'page', entry: [{ id: 'page-1', messaging: [{ sender: { id: '991' }, message: { mid: 'm-media', attachments: [{ type: 'image', payload: { url: 'https://cdn.fbcdn.net/image.jpg' } }] } }] }] };
  env.DB.database.prepare(`INSERT INTO facebook_webhook_events(id,page_id,dedup_key,event_type,event_timestamp,raw_payload_json,normalized_payload_json,media_status,processing_status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,'pending','pending',?,?,?)`).run(eventId,'page-1',`dedup-${eventId}`,'message',now,JSON.stringify(payload),JSON.stringify(payload),now,now,new Date(Date.now()+86400000).toISOString());
}

test('Incoming Facebook media is copied to R2 and event payload no longer exposes Meta URL', async t => {
  const env = testEnv(); const config = workerConfig(env); seedMediaEvent(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1,2,3,4]), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '4' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await cacheEventMedia(env, config, 'event-media');
  assert.deepEqual(result, { cached: 1, failed: 0, pending: 0 });
  assert.equal(env.MEDIA.rows.size, 1);
  const event = env.DB.database.prepare('SELECT normalized_payload_json,media_status FROM facebook_webhook_events WHERE id=?').get('event-media');
  assert.equal(event.media_status, 'ready');
  assert.equal(event.normalized_payload_json.includes('cdn.fbcdn.net'), false);
  assert.equal(event.normalized_payload_json.includes('worker_media'), true);
});

test('R2 media retention cleanup deletes expired objects and metadata', async () => {
  const env = testEnv(); const config = workerConfig(env); seedMediaEvent(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1,2,3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  try { await cacheEventMedia(env, config, 'event-media'); } finally { globalThis.fetch = originalFetch; }
  env.DB.database.prepare(`UPDATE facebook_event_media SET expires_at='2000-01-01T00:00:00.000Z'`).run();
  const deleted = await cleanupExpiredMedia(env, new Date().toISOString());
  assert.equal(deleted, 1);
  assert.equal(env.MEDIA.rows.size, 0);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_media').get().count, 0);
});

test('Media URL allowlist rejects non-Meta hosts', () => {
  assert.throws(() => validateMetaMediaUrl('https://evil.example/steal'), error => error.code === 'FACEBOOK_MEDIA_URL_BLOCKED');
});


test('Transient media fetch failure remains pending and scheduled retry stores it in R2 before delivery', async t => {
  const env = testEnv(); const config = workerConfig(env); seedMediaEvent(env, 'event-retry');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('temporary', { status: 503 });
    return new Response(new Uint8Array([9,8,7]), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '3' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = await cacheEventMedia(env, config, 'event-retry');
  assert.deepEqual(first, { cached: 0, failed: 0, pending: 1 });
  let event = env.DB.database.prepare('SELECT normalized_payload_json,media_status FROM facebook_webhook_events WHERE id=?').get('event-retry');
  assert.equal(event.media_status, 'pending');
  assert.equal(event.normalized_payload_json.includes('cdn.fbcdn.net'), true);
  env.DB.database.prepare(`UPDATE facebook_event_media SET next_retry_at='2000-01-01T00:00:00.000Z' WHERE event_id='event-retry'`).run();
  const retry = await retryPendingMedia(env, config, new Date().toISOString());
  assert.deepEqual(retry, { events: 1, cached: 1, failed: 0, pending: 0 });
  event = env.DB.database.prepare('SELECT normalized_payload_json,media_status FROM facebook_webhook_events WHERE id=?').get('event-retry');
  assert.equal(event.media_status, 'ready');
  assert.equal(event.normalized_payload_json.includes('cdn.fbcdn.net'), false);
  assert.equal(env.MEDIA.rows.size, 1);
});


test('Media redirect chain is revalidated and cannot escape the Meta host allowlist', async () => {
  await assert.rejects(fetchMetaMedia('https://cdn.fbcdn.net/image.jpg', async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })), error => error.code === 'FACEBOOK_MEDIA_URL_BLOCKED');
});
