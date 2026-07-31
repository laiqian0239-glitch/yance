import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateDesktop } from '../src/desktopAuth.js';
import { workerConfig } from '../src/config.js';
import { deviceKeys, seedAccountDevice, signedRequest, testEnv } from './testHarness.js';

test('Desktop authentication accepts Ed25519 signed request and records replay nonce', async () => {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const { request, bodyBytes } = await signedRequest('https://worker.test/api/desktop/health', { deviceId: 'device-100', privateKey: keys.privateKey });
  const auth = await authenticateDesktop(request, env, workerConfig(env), bodyBytes);
  assert.equal(auth.deviceId, 'device-100');
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_device_requests').get().count, 1);
});

test('Desktop authentication rejects replayed request ID', async () => {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const options = { deviceId: 'device-100', privateKey: keys.privateKey, requestId: 'same-request-id' };
  const first = await signedRequest('https://worker.test/api/desktop/health', options);
  await authenticateDesktop(first.request, env, workerConfig(env), first.bodyBytes);
  const replay = await signedRequest('https://worker.test/api/desktop/health', options);
  await assert.rejects(authenticateDesktop(replay.request, env, workerConfig(env), replay.bodyBytes), error => error.code === 'FACEBOOK_DESKTOP_REPLAY_REJECTED');
});

test('Desktop authentication rejects expired timestamp', async () => {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const expired = await signedRequest('https://worker.test/api/desktop/health', { deviceId: 'device-100', privateKey: keys.privateKey, timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
  await assert.rejects(authenticateDesktop(expired.request, env, workerConfig(env), expired.bodyBytes), error => error.code === 'FACEBOOK_DESKTOP_REQUEST_EXPIRED');
});

test('Desktop authentication rejects body tampering and invalid signatures', async () => {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const signed = await signedRequest('https://worker.test/api/desktop/ack', { method: 'POST', body: { acknowledgements: [] }, deviceId: 'device-100', privateKey: keys.privateKey });
  const tamperedBytes = new TextEncoder().encode('{"acknowledgements":[{"x":1}]}');
  await assert.rejects(authenticateDesktop(signed.request, env, workerConfig(env), tamperedBytes), error => error.code === 'FACEBOOK_DESKTOP_BODY_HASH_MISMATCH');

  const headers = new Headers(signed.request.headers); headers.set('x-yance-signature', 'A'.repeat(86));
  const invalid = new Request(signed.request.url, { method: 'POST', headers, body: '{"acknowledgements":[]}' });
  await assert.rejects(authenticateDesktop(invalid, env, workerConfig(env), signed.bodyBytes), error => error.code === 'FACEBOOK_DESKTOP_SIGNATURE_INVALID');
});

test('Desktop authentication rejects malformed Base64URL auth fields with a stable error', async () => {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const config = workerConfig(env);
  const signed = await signedRequest('https://worker.test/api/desktop/health', { deviceId: 'device-100', privateKey: keys.privateKey });
  const headers = new Headers(signed.request.headers);
  headers.set('x-yance-signature', 'not-base64');
  const request = new Request(signed.request.url, { method: 'GET', headers });
  await assert.rejects(authenticateDesktop(request, env, config, new Uint8Array()), error => error.code === 'FACEBOOK_DESKTOP_AUTH_ENCODING_INVALID');
});
