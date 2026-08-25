import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../src/config.js';
import { cacheEventMedia, cleanupExpiredMedia, fetchMetaMedia, validateMetaMediaUrl } from '../src/media.js';
import { testEnv } from './testHarness.js';

function seedMediaEvent(env, eventId = 'event-media') {
  const now = new Date().toISOString();
  const payload = {
    object: 'page',
    entry: [{
      id: 'page-1',
      messaging: [{
        sender: { id: '991' },
        message: {
          mid: 'm-media',
          attachments: [{ type: 'image', payload: { url: 'https://cdn.fbcdn.net/image.jpg' } }]
        }
      }]
    }]
  };
  env.DB.database.prepare(`INSERT INTO facebook_webhook_events(id,page_id,dedup_key,event_type,event_timestamp,raw_payload_json,normalized_payload_json,media_status,processing_status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,'pending','pending',?,?,?)`).run(
    eventId, 'page-1', `dedup-${eventId}`, 'message', now, JSON.stringify(payload), JSON.stringify(payload),
    now, now, new Date(Date.now() + 86400000).toISOString()
  );
}

function persistedAttempt(seed = 'media') {
  return Object.freeze({
    executionId: `exec-${seed}`,
    attemptId: `attempt-${seed}`,
    claimId: `claim-${seed}`,
    ownerId: `owner-${seed}`,
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1
  });
}

test('Incoming Facebook media ingest is metadata-only until a persisted media attempt performs physical I/O', async t => {
  const env = testEnv();
  const config = workerConfig(env);
  seedMediaEvent(env);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('metadata-only ingest must not fetch media');
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await cacheEventMedia(env, config, 'event-media');
  assert.deepEqual(result, { cached: 0, failed: 0, pending: 1, metadataOnly: true });
  assert.equal(fetchCalls, 0);
  assert.equal(env.MEDIA.rows.size, 0);

  const event = env.DB.database.prepare('SELECT normalized_payload_json,media_status FROM facebook_webhook_events WHERE id=?').get('event-media');
  assert.equal(event.media_status, 'ready');
  assert.equal(event.normalized_payload_json.includes('cdn.fbcdn.net'), false);
  assert.equal(event.normalized_payload_json.includes('worker_media'), true);

  const media = env.DB.database.prepare('SELECT status,next_retry_at FROM facebook_event_media WHERE event_id=? AND attachment_index=0').get('event-media');
  assert.equal(media.status, 'pending');
  assert.equal(media.next_retry_at, null);
});

test('Physical Facebook media materialization requires a frozen persisted attempt and stores the object in R2', async t => {
  const env = testEnv();
  const config = workerConfig(env);
  seedMediaEvent(env);

  await assert.rejects(
    cacheEventMedia(env, config, 'event-media', {}),
    error => error?.code === 'FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED'
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': '4' }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await cacheEventMedia(env, config, 'event-media', persistedAttempt('physical'), 0);
  assert.deepEqual(result, {
    cached: 1,
    failed: 0,
    pending: 0,
    metadataOnly: false,
    attemptId: 'attempt-physical'
  });
  assert.equal(env.MEDIA.rows.size, 1);

  const media = env.DB.database.prepare('SELECT status,next_retry_at,attempt_count FROM facebook_event_media WHERE event_id=? AND attachment_index=0').get('event-media');
  assert.equal(media.status, 'ready');
  assert.equal(media.next_retry_at, null);
  assert.equal(media.attempt_count, 1);
});

test('R2 media retention cleanup itself requires persisted attempt authority', async () => {
  const env = testEnv();
  const config = workerConfig(env);
  seedMediaEvent(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' }
  });
  try {
    await cacheEventMedia(env, config, 'event-media', persistedAttempt('cache'), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  env.DB.database.prepare(`UPDATE facebook_event_media SET expires_at='2000-01-01T00:00:00.000Z'`).run();
  await assert.rejects(
    cleanupExpiredMedia(env, new Date().toISOString()),
    error => error?.code === 'FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED'
  );
  const result = await cleanupExpiredMedia(env, new Date().toISOString(), persistedAttempt('cleanup'));
  assert.deepEqual(result, { deleted: 1, attemptId: 'attempt-cleanup' });
  assert.equal(env.MEDIA.rows.size, 0);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_media').get().count, 0);
});

test('Transient physical media failure is failed without Worker-local retry; a new durable attempt may retry explicitly', async t => {
  const env = testEnv();
  const config = workerConfig(env);
  seedMediaEvent(env, 'event-retry');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('temporary', { status: 503 });
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(cacheEventMedia(env, config, 'event-retry', persistedAttempt('first'), 0));
  assert.equal(calls, 1);
  assert.equal(env.MEDIA.rows.size, 0);

  let media = env.DB.database.prepare('SELECT status,next_retry_at,attempt_count,last_error_code FROM facebook_event_media WHERE event_id=? AND attachment_index=0').get('event-retry');
  assert.equal(media.status, 'failed');
  assert.equal(media.next_retry_at, null);
  assert.equal(media.attempt_count, 1);
  assert.ok(media.last_error_code);

  const retry = await cacheEventMedia(env, config, 'event-retry', persistedAttempt('second'), 0);
  assert.deepEqual(retry, {
    cached: 1,
    failed: 0,
    pending: 0,
    metadataOnly: false,
    attemptId: 'attempt-second'
  });
  assert.equal(calls, 2);
  assert.equal(env.MEDIA.rows.size, 1);
  media = env.DB.database.prepare('SELECT status,next_retry_at,attempt_count FROM facebook_event_media WHERE event_id=? AND attachment_index=0').get('event-retry');
  assert.equal(media.status, 'ready');
  assert.equal(media.next_retry_at, null);
  assert.equal(media.attempt_count, 2);
});

test('Media URL allowlist rejects non-Meta hosts', () => {
  assert.throws(
    () => validateMetaMediaUrl('https://evil.example/steal'),
    error => error.code === 'FACEBOOK_MEDIA_URL_BLOCKED'
  );
});

test('Media redirect chain is revalidated and cannot escape the Meta host allowlist', async () => {
  await assert.rejects(
    fetchMetaMedia(
      'https://cdn.fbcdn.net/image.jpg',
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })
    ),
    error => error.code === 'FACEBOOK_MEDIA_URL_BLOCKED'
  );
});
