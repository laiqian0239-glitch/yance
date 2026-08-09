'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { NamedRuntimeMutex } = require('../../backend/runtime/NamedRuntimeMutex');

const windowsOnly = process.platform === 'win32' ? test : test.skip;

windowsOnly('proper-lockfile blocks a second Windows backend without spawning a helper process', { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-windows-lock-'));
  const target = path.join(root, 'runtime.db');
  const first = new NamedRuntimeMutex({ lockTarget: target, acquireTimeoutMs: 1000 });
  const second = new NamedRuntimeMutex({ lockTarget: target, acquireTimeoutMs: 1000 });
  try {
    assert.equal(first.provider, 'PROPER_LOCKFILE');
    assert.equal(first._child, undefined);
    await first.acquire();
    await assert.rejects(second.acquire(), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
    await first.release();
    await second.acquire();
    assert.equal(second.held, true);
  } finally {
    await second.release().catch(() => {});
    await first.release().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
