'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { NamedRuntimeMutex } = require('../../backend/runtime/NamedRuntimeMutex');

const windowsOnly = process.platform === 'win32' ? test : test.skip;

windowsOnly('Windows System.Threading.Mutex blocks a second process, releases after helper exit, and supports takeover only after real release', { timeout: 60000 }, async () => {
  const name = `Local\\Yance.AppRuntime.WP3WindowsReal${process.pid}${Date.now()}`;
  const first = new NamedRuntimeMutex({ name, platform: 'win32', acquireTimeoutMs: 10000 });
  const second = new NamedRuntimeMutex({ name, platform: 'win32', acquireTimeoutMs: 10000 });
  await first.acquire();
  await assert.rejects(second.acquire(), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
  const helperPid = first._child?.pid;
  assert.ok(helperPid > 0);
  await first.release();
  assert.equal(first.held, false);
  assert.notEqual(first._child?.exitCode, null);
  await second.acquire();
  assert.equal(second.held, true);
  const abandonedChild = second._child;
  abandonedChild.kill();
  await new Promise(resolve => abandonedChild.once('exit', resolve));
  const takeover = new NamedRuntimeMutex({ name, platform: 'win32', acquireTimeoutMs: 10000 });
  await takeover.acquire();
  assert.equal(takeover.held, true);
  await takeover.release();
});
