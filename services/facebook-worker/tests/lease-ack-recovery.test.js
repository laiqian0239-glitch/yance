import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../src/config.js';
import { acknowledgeEvents, pullEvents } from '../src/desktopApi.js';
import { deviceKeys, seedAccountDevice, signedRequest, testEnv } from './testHarness.js';

function seedEvent(env, id, timestamp, messageId) {
  const now = new Date().toISOString();
  const payload = { object: 'page', entry: [{ id: 'page-100', messaging: [{ sender: { id: '991' }, timestamp: Date.parse(timestamp), message: { mid: messageId, text: messageId } }] }] };
  env.DB.database.prepare(`INSERT INTO facebook_webhook_events(id,account_id,page_id,dedup_key,event_type,meta_message_id,event_timestamp,raw_payload_json,normalized_payload_json,media_status,processing_status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'none','pending',?,?,?)`).run(id,'fbacct_test','page-100',`mid:page-100:${messageId}`,'message',messageId,timestamp,JSON.stringify(payload),JSON.stringify(payload),now,now,new Date(Date.now()+86400000).toISOString());
  env.DB.database.prepare(`INSERT INTO facebook_event_deliveries(id,event_id,account_id,device_id,status,first_available_at,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?)`).run(`d-${id}`,id,'fbacct_test','device-100',now,now,now);
}

async function setup() {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  seedEvent(env, 'e1', '2026-07-18T00:00:01.000Z', 'm1');
  seedEvent(env, 'e2', '2026-07-18T00:00:02.000Z', 'm2');
  return { env, keys, config: workerConfig(env) };
}

test('Polling supports pagination and leases events without duplicate concurrent delivery', async () => {
  const { env, keys, config } = await setup();
  const firstRequest = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const first = await pullEvents(firstRequest.request, env, config, firstRequest.bodyBytes);
  assert.equal(first.events.length, 1);
  assert.equal(first.has_more, true);
  assert.equal(first.events[0].event_id, 'e1');

  const secondRequest = await signedRequest(`https://worker.test/api/desktop/events?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`, { deviceId: 'device-100', privateKey: keys.privateKey });
  const second = await pullEvents(secondRequest.request, env, config, secondRequest.bodyBytes);
  assert.deepEqual(second.events.map(row => row.event_id), ['e2']);

  const thirdRequest = await signedRequest('https://worker.test/api/desktop/events?limit=10', { deviceId: 'device-100', privateKey: keys.privateKey });
  const third = await pullEvents(thirdRequest.request, env, config, thirdRequest.bodyBytes);
  assert.equal(third.events.length, 0);
});

test('ACK succeeds only with matching device lease and marks event acked', async () => {
  const { env, keys, config } = await setup();
  const pullRequest = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const pulled = await pullEvents(pullRequest.request, env, config, pullRequest.bodyBytes);
  const event = pulled.events[0];
  const body = { acknowledgements: [{ delivery_id: event.delivery_id, lease_token: event.lease_token }] };
  const ackRequest = await signedRequest('https://worker.test/api/desktop/ack', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey });
  const ack = await acknowledgeEvents(ackRequest.request, env, config, ackRequest.bodyBytes, body);
  assert.deepEqual(ack.acked, [event.delivery_id]);
  assert.equal(env.DB.database.prepare('SELECT status FROM facebook_event_deliveries WHERE id=?').get(event.delivery_id).status, 'acked');
  assert.equal(env.DB.database.prepare('SELECT processing_status FROM facebook_webhook_events WHERE id=?').get(event.event_id).processing_status, 'acked');
});

test('ACK mismatch does not delete or acknowledge event', async () => {
  const { env, keys, config } = await setup();
  const pullRequest = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const event = (await pullEvents(pullRequest.request, env, config, pullRequest.bodyBytes)).events[0];
  const body = { acknowledgements: [{ delivery_id: event.delivery_id, lease_token: 'wrong' }] };
  const ackRequest = await signedRequest('https://worker.test/api/desktop/ack', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey });
  const ack = await acknowledgeEvents(ackRequest.request, env, config, ackRequest.bodyBytes, body);
  assert.equal(ack.acked.length, 0);
  assert.equal(ack.failed[0].code, 'FACEBOOK_ACK_LEASE_MISMATCH');
  assert.equal(env.DB.database.prepare('SELECT status FROM facebook_event_deliveries WHERE id=?').get(event.delivery_id).status, 'leased');
});

test('Expired lease returns to pending and is redelivered after desktop crash before ACK', async () => {
  const { env, keys, config } = await setup();
  const pullRequest = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const first = (await pullEvents(pullRequest.request, env, config, pullRequest.bodyBytes)).events[0];
  env.DB.database.prepare(`UPDATE facebook_event_deliveries SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(first.delivery_id);
  const retryRequest = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const second = (await pullEvents(retryRequest.request, env, config, retryRequest.bodyBytes)).events[0];
  assert.equal(second.event_id, first.event_id);
  assert.notEqual(second.lease_token, first.lease_token);
  assert.equal(env.DB.database.prepare('SELECT attempt_count FROM facebook_event_deliveries WHERE id=?').get(first.delivery_id).attempt_count, 2);
});

test('Same Page on two devices has independent lease and ACK state', async () => {
  const { env, keys, config } = await setup();
  const secondKeys = await deviceKeys();
  const now = new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO facebook_desktop_devices(id,account_id,page_id,public_key_spki,status,display_name,registration_proof,created_at,updated_at) VALUES('device-200','fbacct_test','page-100',?,'active','Second Device','proof',?,?)`).run(secondKeys.publicKeySpki, now, now);
  env.DB.database.prepare(`INSERT INTO facebook_event_deliveries(id,event_id,account_id,device_id,status,first_available_at,created_at,updated_at) VALUES('d2-e1','e1','fbacct_test','device-200','pending',?,?,?)`).run(now, now, now);

  const firstPull = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-100', privateKey: keys.privateKey });
  const firstEvent = (await pullEvents(firstPull.request, env, config, firstPull.bodyBytes)).events[0];
  const secondPull = await signedRequest('https://worker.test/api/desktop/events?limit=1', { deviceId: 'device-200', privateKey: secondKeys.privateKey });
  const secondEvent = (await pullEvents(secondPull.request, env, config, secondPull.bodyBytes)).events[0];
  assert.equal(firstEvent.event_id, 'e1');
  assert.equal(secondEvent.event_id, 'e1');
  assert.notEqual(firstEvent.delivery_id, secondEvent.delivery_id);

  const firstBody = { acknowledgements: [{ delivery_id: firstEvent.delivery_id, lease_token: firstEvent.lease_token }] };
  const firstAck = await signedRequest('https://worker.test/api/desktop/ack', { method: 'POST', body: firstBody, deviceId: 'device-100', privateKey: keys.privateKey });
  await acknowledgeEvents(firstAck.request, env, config, firstAck.bodyBytes, firstBody);
  assert.equal(env.DB.database.prepare(`SELECT processing_status FROM facebook_webhook_events WHERE id='e1'`).get().processing_status, 'pending');

  const secondBody = { acknowledgements: [{ delivery_id: secondEvent.delivery_id, lease_token: secondEvent.lease_token }] };
  const secondAck = await signedRequest('https://worker.test/api/desktop/ack', { method: 'POST', body: secondBody, deviceId: 'device-200', privateKey: secondKeys.privateKey });
  await acknowledgeEvents(secondAck.request, env, config, secondAck.bodyBytes, secondBody);
  assert.equal(env.DB.database.prepare(`SELECT processing_status FROM facebook_webhook_events WHERE id='e1'`).get().processing_status, 'acked');
});

test('Webhook delivery order follows event timestamp even when D1 insertion order is reversed', async () => {
  const env = testEnv(); const keys = await deviceKeys(); const config = workerConfig(env);
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  seedEvent(env, 'late-inserted-newer', '2026-07-18T00:00:20.000Z', 'm-newer');
  seedEvent(env, 'later-inserted-older', '2026-07-18T00:00:10.000Z', 'm-older');
  const request = await signedRequest('https://worker.test/api/desktop/events?limit=10', { deviceId: 'device-100', privateKey: keys.privateKey });
  const result = await pullEvents(request.request, env, config, request.bodyBytes);
  assert.deepEqual(result.events.map(row => row.event_id), ['later-inserted-older', 'late-inserted-newer']);
});
