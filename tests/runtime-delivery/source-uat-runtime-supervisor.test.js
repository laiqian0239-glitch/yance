'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { waitForRuntimeReady } = require('../../tools/runtime-delivery/source-uat-runtime-supervisor');

test('waitForRuntimeReady accepts only an HTTP ready document while the Electron process remains alive', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  let attempts = 0;
  const result = await waitForRuntimeReady({
    port: 27632,
    child,
    timeoutMs: 500,
    pollIntervalMs: 1,
    requestReady: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('not listening'), { code: 'ECONNREFUSED' });
      return { statusCode: 200, body: { pid: 9876, readiness: { ready: true, phase: 'ready', pid: 9876, readyAt: '2026-08-02T00:00:00.000Z' } } };
    }
  });
  assert.equal(result.status, 'RUNTIME_READY');
  assert.equal(result.electronPid, 4321);
  assert.equal(result.backendPid, 9876);
  assert.equal(attempts, 2);
});

test('waitForRuntimeReady fails closed when Electron exits before backend readiness', async () => {
  const child = new EventEmitter();
  child.pid = 2222;
  child.exitCode = null;
  const promise = waitForRuntimeReady({
    port: 27632,
    child,
    timeoutMs: 500,
    pollIntervalMs: 5,
    requestReady: async () => { throw Object.assign(new Error('not listening'), { code: 'ECONNREFUSED' }); }
  });
  setTimeout(() => child.emit('exit', 7, null), 10);
  await assert.rejects(promise, error => error.reasonCode === 'SOURCE_UAT_ELECTRON_EXITED_BEFORE_READY' && error.details.exitCode === 7);
});

test('waitForRuntimeReady times out rather than accepting diagnostic stderr as readiness', async () => {
  const child = new EventEmitter();
  child.pid = 3333;
  child.exitCode = null;
  await assert.rejects(waitForRuntimeReady({
    port: 27632,
    child,
    timeoutMs: 20,
    pollIntervalMs: 2,
    requestReady: async () => ({ statusCode: 200, body: { readiness: { ready: false, phase: 'initializing' } } })
  }), error => error.reasonCode === 'SOURCE_UAT_RUNTIME_READY_TIMEOUT');
});
