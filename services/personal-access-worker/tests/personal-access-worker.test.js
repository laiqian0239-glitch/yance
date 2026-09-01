'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const WORKER_PATH = path.resolve(__dirname, '../src/index.mjs');
const OLD_WORKER_PATH = path.resolve(__dirname, '../src/index.js');
const WRANGLER_PATH = path.resolve(__dirname, '../wrangler.toml');

async function loadWorker() {
  assert.equal(fs.existsSync(WORKER_PATH), true, 'missing shared personal-access Worker authority');
  return import(pathToFileURL(WORKER_PATH).href);
}

test('Worker owns the exact request and grant lifecycle state sets', async () => {
  const { REQUEST_STATES, GRANT_STATES } = await loadWorker();
  assert.deepEqual(Array.from(REQUEST_STATES), ['PENDING', 'ASSIGNED', 'APPROVED', 'REJECTED']);
  assert.deepEqual(Array.from(GRANT_STATES), ['ACTIVE', 'SUSPENDED', 'REVOKED']);
});

test('request transition contract requires assignment before owner approval or rejection', async () => {
  const { transitionRequestState } = await loadWorker();
  assert.equal(transitionRequestState('PENDING', 'ASSIGN'), 'ASSIGNED');
  assert.equal(transitionRequestState('ASSIGNED', 'APPROVE'), 'APPROVED');
  assert.equal(transitionRequestState('ASSIGNED', 'REJECT'), 'REJECTED');
  assert.throws(() => transitionRequestState('PENDING', 'APPROVE'), /INVALID_REQUEST_TRANSITION/);
  assert.throws(() => transitionRequestState('APPROVED', 'REJECT'), /INVALID_REQUEST_TRANSITION/);
  assert.throws(() => transitionRequestState('REJECTED', 'ASSIGN'), /INVALID_REQUEST_TRANSITION/);
});

test('tester grant transition contract is ACTIVE to SUSPENDED or REVOKED and never self-reactivates', async () => {
  const { transitionGrantState } = await loadWorker();
  assert.equal(transitionGrantState('ACTIVE', 'SUSPEND'), 'SUSPENDED');
  assert.equal(transitionGrantState('ACTIVE', 'REVOKE'), 'REVOKED');
  assert.equal(transitionGrantState('SUSPENDED', 'REVOKE'), 'REVOKED');
  assert.throws(() => transitionGrantState('SUSPENDED', 'ACTIVATE'), /INVALID_GRANT_TRANSITION/);
  assert.throws(() => transitionGrantState('REVOKED', 'ACTIVATE'), /INVALID_GRANT_TRANSITION/);
});

test('shared authority requires owner secret for mutations and installation binding for tester status', async () => {
  const { createPersonalAccessWorker } = await loadWorker();
  const calls = [];
  const repository = {
    async submitRequest(input) { calls.push(['submit', input]); return { id: 'req-1', state: 'PENDING', installationId: input.installationId }; },
    async getTesterStatus(input) { calls.push(['status', input]); return { role: 'TESTER', requestState: 'APPROVED', grantState: 'ACTIVE', installationId: input.installationId }; },
    async listRequests() { calls.push(['list']); return []; },
    async mutateRequest() { throw new Error('not-used'); },
    async mutateGrant() { throw new Error('not-used'); }
  };
  const worker = createPersonalAccessWorker({ repository, ownerAdminSecret: 'owner-secret' });

  const submit = await worker.fetch(new Request('https://access.example/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installationId: 'install-a', displayName: 'Tester A' })
  }));
  assert.equal(submit.status, 201);

  const status = await worker.fetch(new Request('https://access.example/status?requestId=req-1&installationId=install-a'));
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.grantState, 'ACTIVE');
  assert.equal(statusBody.installationId, 'install-a');

  const unauthorized = await worker.fetch(new Request('https://access.example/owner/requests'));
  assert.equal(unauthorized.status, 401);

  const authorized = await worker.fetch(new Request('https://access.example/owner/requests', {
    headers: { authorization: 'Bearer owner-secret' }
  }));
  assert.equal(authorized.status, 200);
  assert.ok(calls.some(([name]) => name === 'list'));
});

test('production Worker uses Cloudflare module Worker ESM entry with real D1 binding', () => {
  assert.equal(fs.existsSync(WORKER_PATH), true, 'index.mjs must be the production Worker entry');
  assert.equal(fs.existsSync(OLD_WORKER_PATH), false, 'old production index.js must not remain');
  const source = fs.readFileSync(WORKER_PATH, 'utf8');
  const wrangler = fs.readFileSync(WRANGLER_PATH, 'utf8');
  assert.match(source, /export\s+default\s*\{\s*async\s+fetch\(request,\s*env\)/u);
  assert.doesNotMatch(source, /module\.exports/u);
  assert.match(wrangler, /main\s*=\s*"src\/index\.mjs"/u);
  assert.match(wrangler, /workers_dev\s*=\s*true/u);
  assert.match(wrangler, /database_id\s*=\s*"e81b4218-8a66-4377-b07d-eb785c7698cf"/u);
  assert.doesNotMatch(wrangler, /REPLACE_WITH_D1_DATABASE_ID/u);
});
