'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const WORKER_PATH = path.resolve(__dirname, '../src/index.mjs');
const OLD_WORKER_PATH = path.resolve(__dirname, '../src/index.js');
const MIGRATION_PATH = path.resolve(__dirname, '../migrations/0001_personal_access.sql');
const WRANGLER_PATH = path.resolve(__dirname, '../wrangler.toml');

async function loadWorker() {
  assert.equal(fs.existsSync(WORKER_PATH), true, 'missing shared personal-access Worker authority');
  return import(pathToFileURL(WORKER_PATH).href);
}

test('Worker is a stateless Unkey verify/getKey proxy with one-time redemption', async () => {
  const { createPersonalAccessWorker } = await loadWorker();
  const calls = [];
  const worker = createPersonalAccessWorker({
    rootKey: 'root-secret',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        meta: { requestId: 'unkey-req-1' },
        data: {
          valid: true,
          code: 'VALID',
          keyId: 'key_123',
          enabled: true,
          expires: 1798761600000,
          identity: { externalId: 'tester', internalId: 'not-projected' }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await worker.fetch(new Request('https://access.example/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'invite_live' })
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    ok: true,
    valid: true,
    code: 'VALID',
    keyId: 'key_123',
    enabled: true,
    expires: 1798761600000,
    credits: null,
    identity: { externalId: 'tester' },
    requestId: 'unkey-req-1'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.unkey.com/v2/keys.verifyKey');
  assert.equal(calls[0].init.headers.authorization, 'Bearer root-secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { key: 'invite_live', credits: { cost: 1 } });

  const status = await worker.fetch(new Request('https://access.example/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId: 'key_123' })
  }));
  assert.equal(status.status, 200);
  assert.equal(calls[1].url, 'https://api.unkey.com/v2/keys.getKey');
  assert.deepEqual(JSON.parse(calls[1].init.body), { keyId: 'key_123' });

  assert.equal((await worker.fetch(new Request('https://access.example/verify'))).status, 404);
  assert.equal((await worker.fetch(new Request('https://access.example/owner'))).status, 404);
});

test('Worker fails closed without leaking root key or upstream body', async () => {
  const { createPersonalAccessWorker } = await loadWorker();
  assert.throws(() => createPersonalAccessWorker({ rootKey: '' }), /UNKEY_ROOT_KEY/);
  const worker = createPersonalAccessWorker({
    rootKey: 'root-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'secret upstream detail' }), { status: 403 })
  });
  const result = await worker.fetch(new Request('https://access.example/verify', {
    method: 'POST',
    body: JSON.stringify({ key: 'bad-key' })
  }));
  assert.equal(result.status, 403);
  const body = await result.json();
  assert.equal(body.reasonCode, 'UNKEY_AUTHORITY_REJECTED');
  assert.doesNotMatch(JSON.stringify(body), /root-secret|secret upstream detail/);
});

test('one-credit invitation replay is rejected by the mature Unkey credit authority', async () => {
  const { createPersonalAccessWorker } = await loadWorker();
  let remaining = 1;
  const worker = createPersonalAccessWorker({
    rootKey: 'root-secret',
    fetchImpl: async (_url, init) => {
      const input = JSON.parse(init.body || '{}');
      assert.deepEqual(input.credits, { cost: 1 });
      if (remaining <= 0) {
        return new Response(JSON.stringify({ meta: { requestId: 'req-2' }, data: { valid: false, code: 'USAGE_EXCEEDED', keyId: 'key_123', enabled: true, credits: 0 } }), { status: 200 });
      }
      remaining -= 1;
      return new Response(JSON.stringify({ meta: { requestId: 'req-1' }, data: { valid: true, code: 'VALID', keyId: 'key_123', enabled: true, expires: 1798761600000, credits: remaining, identity: { externalId: 'tester' } } }), { status: 200 });
    }
  });
  const request = () => worker.fetch(new Request('https://access.example/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'invite_live' })
  }));
  assert.equal((await (await request()).json()).valid, true);
  const replay = await (await request()).json();
  assert.equal(replay.valid, false);
  assert.equal(replay.code, 'USAGE_EXCEEDED');
});

test('production Worker keeps Cloudflare module Worker ESM entry and removes local lifecycle storage', () => {
  assert.equal(fs.existsSync(WORKER_PATH), true, 'index.mjs must be the production Worker entry');
  assert.equal(fs.existsSync(OLD_WORKER_PATH), false, 'old production index.js must not remain');
  assert.equal(fs.existsSync(MIGRATION_PATH), false, 'old local lifecycle migration must not remain');
  const source = fs.readFileSync(WORKER_PATH, 'utf8');
  const wrangler = fs.readFileSync(WRANGLER_PATH, 'utf8');
  assert.match(source, /export\s+default\s*\{\s*async\s+fetch\(request,\s*env\)/u);
  assert.match(source, /UNKEY_ROOT_KEY/u);
  assert.match(source, /api\.unkey\.com\/v2\/keys\.verifyKey/u);
  assert.match(source, /api\.unkey\.com\/v2\/keys\.getKey/u);
  assert.match(source, /credits:\s*\{\s*cost:\s*1\s*\}/u);
  assert.doesNotMatch(source, /module\.exports/u);
  assert.doesNotMatch(source, /OWNER_ADMIN_SECRET|prepare\(|SELECT|INSERT|UPDATE|DELETE|keys\.createKey|keys\.updateKey|keys\.deleteKey/u);
  assert.match(wrangler, /main\s*=\s*"src\/index\.mjs"/u);
  assert.match(wrangler, /workers_dev\s*=\s*true/u);
  assert.match(wrangler, /UNKEY_ROOT_KEY/u);
  assert.doesNotMatch(wrangler, /d1_databases|database_id|migrations_dir/u);
});
