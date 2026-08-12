import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/index.js';
import { testEnv } from './testHarness.js';

const EXPECTED_SUBSCRIBED_FIELDS = [
  'messages',
  'message_echoes',
  'message_reactions',
  'messaging_postbacks',
  'messaging_referrals',
  'message_deliveries',
  'message_reads'
];

test('public health attests the exact Facebook Page Messenger subscription contract for sealed runtime verification', async () => {
  const env = testEnv({ WORKER_BASE_URL: 'https://yance-facebook-gateway.example.workers.dev' });
  const response = await route(new Request('https://yance-facebook-gateway.example.workers.dev/healthz'), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.oauthContract.version, 6);
  assert.deepEqual(data.pageMessengerContract?.subscribedFields, EXPECTED_SUBSCRIBED_FIELDS);
});
