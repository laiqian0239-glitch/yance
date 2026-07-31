'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const test = require('node:test');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');

const ROOT = path.resolve(__dirname, '../..');

function immediatePipe() {
  const stream = new EventEmitter();
  stream.destroyed = false;
  stream.writable = true;
  stream.write = () => true;
  stream.end = (_data, callback) => queueMicrotask(() => callback?.());
  stream.destroy = () => { stream.destroyed = true; stream.writable = false; };
  return stream;
}

function blockedCredentialPipe(onWrite) {
  const stream = new EventEmitter();
  stream.destroyed = false;
  stream.writable = true;
  stream.write = () => true;
  stream.end = (_data, _callback) => onWrite();
  stream.destroy = () => { stream.destroyed = true; stream.writable = false; };
  return stream;
}

function fakeCustodyServer() {
  const server = new EventEmitter();
  server.listen = (_name, callback) => queueMicrotask(() => callback?.());
  server.close = callback => queueMicrotask(() => callback?.());
  server.unref = () => server;
  return server;
}

function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.pid = 43129;
  child.exitCode = null;
  child.signalCode = null;
  const controlPipe = immediatePipe();
  const credentialPipe = blockedCredentialPipe(() => options.onCredentialWrite?.(child));
  child.stdio = [null, new PassThrough(), new PassThrough(), null, controlPipe, credentialPipe, new PassThrough()];
  child.kill = signal => {
    queueMicrotask(() => child.emit('exit', signal === 'SIGTERM' ? 0 : null, signal));
    return true;
  };
  return child;
}

function startOptions() {
  return {
    entry: path.join(ROOT, 'backend', 'desktopHostedEntry.js'),
    cwd: ROOT,
    execPath: process.execPath,
    env: { ...process.env },
    releaseStartupConfig: {
      resourcesPath: ROOT,
      expectedBuildId: 'wp4-startup-abort-test',
      manifestSha256: 'a'.repeat(64)
    },
    credentialSnapshotRequired: true,
    credentialWriteTimeoutMs: 5000,
    forceExitTimeoutMs: 1000
  };
}

test('backend startup-failed IPC aborts a blocked FD5 write instead of waiting for CREDENTIAL_IPC_WRITE_TIMEOUT', async () => {
  let startupFailureEmittedAt = 0;
  const child = fakeChild({
    onCredentialWrite(current) {
      queueMicrotask(() => {
        startupFailureEmittedAt = Date.now();
        current.emit('message', {
          type: 'backend:startup-failed',
          reasonCode: 'BOOT_DESKTOP_STARTUP_FAILED',
          message: 'Backend startup failed.'
        });
      });
    }
  });
  const host = new BackendProcessHost({
    fork: () => child,
    createCredentialCustodyServer: fakeCustodyServer,
    probeNodeRuntime: executablePath => ({ ok: true, executablePath, version: process.version }),
    randomBytes: size => Buffer.alloc(size, 7),
    randomUUID: () => '11111111-1111-4111-8111-111111111111'
  });
  const starting = host.start({
    ...startOptions(),
    credentialHandshakeRequired: true,
    credentialVaultHost: {}
  });

  const abortDeadline = Date.now() + 1500;
  while (host.snapshot().lastStartCancellation?.reasonCode !== 'BOOT_DESKTOP_STARTUP_FAILED' && Date.now() < abortDeadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(startupFailureEmittedAt > 0, 'the fake backend must emit startup-failed after FD5 write begins');
  assert.equal(host.snapshot().lastStartCancellation?.reasonCode, 'BOOT_DESKTOP_STARTUP_FAILED', 'startup failure must cancel the authoritative FD5 generation immediately');
  assert.ok(Date.now() - startupFailureEmittedAt < 1000, 'FD5 cancellation must not wait for process cleanup or the 5 second write timeout');

  await assert.rejects(starting, error => {
    assert.equal(error.reasonCode, 'BOOT_DESKTOP_STARTUP_FAILED');
    assert.notEqual(error.reasonCode, 'CREDENTIAL_IPC_WRITE_TIMEOUT');
    return true;
  });
  assert.equal(child.__desktopHostExited, true);
  assert.equal(host.snapshot().running, false);
  assert.equal(child.listenerCount('message'), 1, 'only the durable lifecycle listener should remain after aborted handshake waiters settle');
});

test('stop request aborts a blocked FD5 startup write before entering the queued stop lifecycle', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const child = fakeChild({ onCredentialWrite: () => enteredResolve() });
  const host = new BackendProcessHost({
    fork: () => child,
    createCredentialCustodyServer: fakeCustodyServer,
    probeNodeRuntime: executablePath => ({ ok: true, executablePath, version: process.version }),
    randomBytes: size => Buffer.alloc(size, 7),
    randomUUID: () => '22222222-2222-4222-8222-222222222222'
  });
  const starting = host.start({
    ...startOptions(),
    credentialHandshakeRequired: true,
    credentialVaultHost: {}
  });
  await entered;
  const requestedAt = Date.now();
  const stopping = host.stop({ gracefulMs: 100, forceMs: 1000 });
  await assert.rejects(starting, error => error.reasonCode === 'DESKTOP_BACKEND_START_CANCELLED');
  const stopped = await stopping;
  assert.ok(Date.now() - requestedAt < 2000, 'stop should preempt the 5 second FD5 timeout');
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.exitConfirmed, true);
  assert.equal(host.snapshot().ownershipPresent, false);
});
