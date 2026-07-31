'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../../frontend/js/r32-account-auth-poll-policy');

test('transient WhatsApp error/offline states keep a user-requested QR poll alive', () => {
  for (const state of ['error', 'offline', 'connecting', 'waiting-verification']) {
    const result = policy.classify({ account: { state }, accountId: 'wa-1', platform: 'whatsapp', awaitingQrAccountId: 'wa-1' });
    assert.equal(result.decision, 'continue', state);
  }
});

test('explicit terminal lifecycle states stop QR polling', () => {
  for (const state of ['paused', 'logged-out', 'deleted', 'merged', 'tombstoned']) {
    assert.equal(policy.classify({ account: { state }, accountId: 'wa-1', platform: 'whatsapp', awaitingQrAccountId: 'wa-1' }).decision, 'stop', state);
  }
});

test('only the matching active authentication request may keep polling', () => {
  assert.equal(policy.classify({ account: { state: 'unconfigured' }, accountId: 'wa-1', platform: 'whatsapp', awaitingQrAccountId: 'wa-1' }).decision, 'continue');
  assert.deepEqual(
    policy.classify({ account: { state: 'error' }, accountId: 'wa-1', platform: 'whatsapp', awaitingQrAccountId: 'wa-2' }),
    { decision: 'stop', reasonCode: 'ACCOUNT_AUTH_REQUEST_INACTIVE' }
  );
  assert.equal(policy.classify({ account: null, accountId: 'wa-1', platform: 'whatsapp', awaitingQrAccountId: 'wa-1' }).decision, 'continue');
});

test('connect failure handling does not resurrect an already-completed WhatsApp QR request', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/r32-account-center.js'), 'utf8').replace(/\r\n/g, '\n');
  const functionStart = source.indexOf('async function connectAccount');
  const catchStart = source.indexOf('} catch (error) {', functionStart);
  const functionEnd = source.indexOf('\n}\n\nasync function runDiagnostics', catchStart);
  const catchBlock = source.slice(catchStart, functionEnd);
  assert.ok(functionStart >= 0 && catchStart > functionStart && functionEnd > catchStart);
  assert.doesNotMatch(catchBlock, /state\.awaitingQrAccountId\s*=\s*account\.id/);
  assert.match(catchBlock, /qrPoll \|\| pollAuthChallenge/);
});
