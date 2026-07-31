import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../src/config.js';
import { sendMessage } from '../src/desktopApi.js';
import { deviceKeys, seedAccountDevice, signedRequest, testEnv, waitContext } from './testHarness.js';

async function setup() {
  const env = testEnv(); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  return { env, keys, config: workerConfig(env) };
}

test('Send idempotency returns original Meta message ID without a second send', async () => {
  const { env, keys, config } = await setup(); let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ recipient_id: '991', message_id: 'meta-mid-1' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const body = { kind: 'text', recipientId: '991', text: 'hello' };
  const firstRequest = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'send-1' });
  const first = await sendMessage(firstRequest.request, env, config, waitContext(), firstRequest.bodyBytes, body, fetchImpl);
  const secondRequest = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'send-1' });
  const second = await sendMessage(secondRequest.request, env, config, waitContext(), secondRequest.bodyBytes, body, fetchImpl);
  assert.equal(first.messageId, 'meta-mid-1');
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test('Same idempotency key with different content is rejected', async () => {
  const { env, keys, config } = await setup();
  const fetchImpl = async () => new Response(JSON.stringify({ message_id: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  const firstBody = { kind: 'text', recipientId: '991', text: 'one' };
  const first = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body: firstBody, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'same-key' });
  await sendMessage(first.request, env, config, waitContext(), first.bodyBytes, firstBody, fetchImpl);
  const secondBody = { kind: 'text', recipientId: '991', text: 'two' };
  const second = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body: secondBody, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'same-key' });
  await assert.rejects(sendMessage(second.request, env, config, waitContext(), second.bodyBytes, secondBody, fetchImpl), error => error.code === 'FACEBOOK_IDEMPOTENCY_CONFLICT');
});

test('Meta 24-hour window error is mapped to stable user-safe error', async () => {
  const { env, keys, config } = await setup();
  const fetchImpl = async () => new Response(JSON.stringify({ error: { code: 10, error_subcode: 2018001, message: 'Outside the 24 hour messaging window' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const body = { kind: 'text', recipientId: '991', text: 'late reply' };
  const signed = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'window-key' });
  await assert.rejects(sendMessage(signed.request, env, config, waitContext(), signed.bodyBytes, body, fetchImpl), error => error.code === 'FACEBOOK_24H_WINDOW_CLOSED' && !error.message.includes('Outside'));
});

test('Media send stages in R2 and removes temporary object after completion', async () => {
  const { env, keys, config } = await setup(); const ctx = waitContext();
  const fetchImpl = async (_url, options) => {
    assert.ok(options.body instanceof FormData);
    return new Response(JSON.stringify({ message_id: 'media-mid' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const body = { kind: 'media', recipientId: '991', media: { dataBase64: Buffer.from('image-data').toString('base64'), attachmentType: 'image', mimeType: 'image/png', filename: 'test.png' } };
  const signed = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'media-key' });
  const result = await sendMessage(signed.request, env, config, ctx, signed.bodyBytes, body, fetchImpl);
  assert.equal(result.messageId, 'media-mid');
  assert.equal(ctx.promises.length, 1);
  await Promise.all(ctx.promises);
  assert.equal(env.MEDIA.rows.size, 0);
});

test('Revoked token prevents send before Meta request', async () => {
  const { env, keys, config } = await setup(); let calls = 0;
  env.DB.database.prepare(`UPDATE facebook_page_tokens SET token_status='revoked'`).run();
  const body = { kind: 'text', recipientId: '991', text: 'hello' };
  const signed = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'revoked-key' });
  await assert.rejects(sendMessage(signed.request, env, config, waitContext(), signed.bodyBytes, body, async () => { calls += 1; }), error => error.code === 'FACEBOOK_TOKEN_EXPIRED');
  assert.equal(calls, 0);
});

test('Meta token expiry marks cloud account for reauthorization without exposing raw Meta error', async () => {
  const { env, keys, config } = await setup();
  const fetchImpl = async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token: secret diagnostic' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const body = { kind: 'text', recipientId: '991', text: 'hello' };
  const signed = await signedRequest('https://worker.test/api/desktop/send', { method: 'POST', body, deviceId: 'device-100', privateKey: keys.privateKey, idempotencyKey: 'expired-key' });
  await assert.rejects(sendMessage(signed.request, env, config, waitContext(), signed.bodyBytes, body, fetchImpl), error => error.code === 'FACEBOOK_TOKEN_EXPIRED' && !error.message.includes('secret diagnostic'));
  const account = env.DB.database.prepare(`SELECT token_status,permission_status FROM facebook_accounts WHERE id='fbacct_test'`).get();
  const token = env.DB.database.prepare(`SELECT token_status,revoked_at FROM facebook_page_tokens WHERE account_id='fbacct_test'`).get();
  assert.equal(account.token_status, 'expired');
  assert.equal(account.permission_status, 'reauthorize');
  assert.equal(token.token_status, 'expired');
  assert.ok(token.revoked_at);
});
