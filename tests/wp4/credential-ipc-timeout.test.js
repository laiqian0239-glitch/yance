'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { readCredentialFrame } = require('../../backend/bootstrap/credentialHydrationPipe');
const { CredentialIpcHost } = require('../../electron/desktopHost/CredentialIpcHost');
const { makeCredentialFrame } = require('../../shared/credentialProtocol');
test('credential IPC timeout fails startup instead of reaching Ready', async () => {
  const stream = new PassThrough();
  await assert.rejects(readCredentialFrame({ stream, timeoutMs: 35 }), error => error.reasonCode === 'CREDENTIAL_IPC_TIMEOUT');
});

test('credential IPC pending write aborts immediately with the authoritative backend startup failure', async () => {
  const stream = new EventEmitter();
  stream.destroyed = false;
  stream.writable = true;
  stream.write = () => true;
  stream.end = () => {};
  stream.destroy = () => { stream.destroyed = true; stream.writable = false; };
  const host = new CredentialIpcHost({ enabled: true }).attach(stream);
  const controller = new AbortController();
  const startupError = Object.assign(new Error('Backend startup failed.'), { reasonCode: 'BOOT_DESKTOP_STARTUP_FAILED' });
  const frame = makeCredentialFrame({
    startupNonce: 'startup-nonce',
    oneTimeToken: 'a'.repeat(43),
    backendPid: 1234,
    manifestSha256: 'b'.repeat(64),
    vaultEpoch: 'vault-epoch',
    generation: 1,
    authorityEventId: 'authority-event',
    authorityHeadDigest: 'c'.repeat(64),
    entries: []
  });
  const started = Date.now();
  const pending = host.sendSnapshot(frame, { timeoutMs: 5000, signal: controller.signal });
  controller.abort(startupError);
  await assert.rejects(pending, error => error === startupError && error.reasonCode === 'BOOT_DESKTOP_STARTUP_FAILED');
  assert.ok(Date.now() - started < 1000);
  assert.equal(host.sent, false);
  host.close();
});
