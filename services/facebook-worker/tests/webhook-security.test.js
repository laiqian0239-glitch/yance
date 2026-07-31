import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { workerConfig } from '../src/config.js';
import { ingestWebhook, verifyMetaSignature, verifyWebhookChallenge } from '../src/webhook.js';
import { deviceKeys, seedAccountDevice, testEnv, waitContext } from './testHarness.js';

function signature(body, secret) { return `sha256=${nodeCrypto.createHmac('sha256', secret).update(body).digest('hex')}`; }

const payload = {
  object: 'page',
  entry: [{ id: 'page-100', time: 1780000000000, messaging: [{ sender: { id: '991' }, recipient: { id: 'page-100' }, timestamp: 1780000000000, message: { mid: 'm-100', text: 'hello' } }] }]
};

test('Webhook verification accepts correct mode/token/challenge and rejects wrong token', () => {
  const env = testEnv(); const config = workerConfig(env);
  const good = new URL(`https://worker.test/webhooks/facebook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.verifyToken)}&hub.challenge=12345`);
  assert.equal(verifyWebhookChallenge(good, config.verifyToken), '12345');
  const bad = new URL('https://worker.test/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345');
  assert.throws(() => verifyWebhookChallenge(bad, config.verifyToken), error => error.code === 'FACEBOOK_WEBHOOK_VERIFICATION_REJECTED');
});

test('Meta signature validation accepts HMAC-SHA256 and rejects altered payload', async () => {
  const env = testEnv(); const config = workerConfig(env);
  const body = Buffer.from(JSON.stringify(payload));
  assert.equal(await verifyMetaSignature(body, signature(body, config.appSecret), config.appSecret), true);
  assert.equal(await verifyMetaSignature(Buffer.from(`${body}x`), signature(body, config.appSecret), config.appSecret), false);
  assert.equal(await verifyMetaSignature(body, 'sha1=bad', config.appSecret), false);
});

test('Webhook ingestion persists once, creates device delivery, and deduplicates Meta retry', async () => {
  const env = testEnv(); const config = workerConfig(env); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const body = Buffer.from(JSON.stringify(payload)); const ctx = waitContext();
  const first = await ingestWebhook(body, signature(body, config.appSecret), env, config, ctx);
  const second = await ingestWebhook(body, signature(body, config.appSecret), env, config, ctx);
  assert.deepEqual(first, { accepted: 1, duplicates: 0 });
  assert.deepEqual(second, { accepted: 0, duplicates: 1 });
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_webhook_events').get().count, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_deliveries').get().count, 1);
});

test('Webhook invalid signature is rejected before D1 write', async () => {
  const env = testEnv(); const config = workerConfig(env); const body = Buffer.from(JSON.stringify(payload));
  await assert.rejects(ingestWebhook(body, 'sha256=' + '0'.repeat(64), env, config, waitContext()), error => error.code === 'FACEBOOK_WEBHOOK_SIGNATURE_INVALID');
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_webhook_events').get().count, 0);
});

test('D1 write failure is not swallowed, allowing Meta to retry', async () => {
  const env = testEnv(); const config = workerConfig(env); const body = Buffer.from(JSON.stringify(payload));
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      if (String(sql).startsWith('INSERT INTO facebook_webhook_events')) bound.run = async () => { throw new Error('D1 unavailable'); };
      return bound;
    };
    return statement;
  };
  await assert.rejects(ingestWebhook(body, signature(body, config.appSecret), env, config, waitContext()), /D1 unavailable/);
});

test('Meta retry repairs a delivery when the event insert succeeded but the first delivery write failed', async () => {
  const env = testEnv(); const config = workerConfig(env); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const body = Buffer.from(JSON.stringify(payload));
  const originalPrepare = env.DB.prepare.bind(env.DB);
  let failOnce = true;
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      if (String(sql).startsWith('INSERT OR IGNORE INTO facebook_event_deliveries')) {
        const originalRun = bound.run.bind(bound);
        bound.run = async () => {
          if (failOnce) { failOnce = false; throw new Error('D1 delivery write interrupted'); }
          return originalRun();
        };
      }
      return bound;
    };
    return statement;
  };

  await assert.rejects(ingestWebhook(body, signature(body, config.appSecret), env, config, waitContext()), /delivery write interrupted/);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_webhook_events').get().count, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_deliveries').get().count, 0);

  const retry = await ingestWebhook(body, signature(body, config.appSecret), env, config, waitContext());
  assert.deepEqual(retry, { accepted: 0, duplicates: 1 });
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_webhook_events').get().count, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_deliveries').get().count, 1);
});

test('Business Suite message echo is persisted and delivered instead of filtered as a duplicate-only signal', async () => {
  const env = testEnv(); const config = workerConfig(env); const keys = await deviceKeys();
  await seedAccountDevice(env, { publicKeySpki: keys.publicKeySpki });
  const echoPayload = {
    object: 'page',
    entry: [{ id: 'page-100', time: 1784741880000, messaging: [{
      sender: { id: 'page-100' }, recipient: { id: '991' }, timestamp: 1784741880000,
      message: { mid: 'm-business-suite-echo', is_echo: true, text: 'reply from Business Suite' }
    }] }]
  };
  const body = Buffer.from(JSON.stringify(echoPayload));
  const result = await ingestWebhook(body, signature(body, config.appSecret), env, config, waitContext());
  assert.deepEqual(result, { accepted: 1, duplicates: 0 });
  const event = env.DB.database.prepare('SELECT event_type,meta_message_id,normalized_payload_json FROM facebook_webhook_events WHERE meta_message_id=?').get('m-business-suite-echo');
  assert.equal(event.event_type, 'message_echo');
  assert.equal(JSON.parse(event.normalized_payload_json).entry[0].messaging[0].message.is_echo, true);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_event_deliveries').get().count, 1);
});
