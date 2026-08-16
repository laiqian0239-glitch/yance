'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { NamedRuntimeMutex } = require('../../backend/runtime/NamedRuntimeMutex');

function temporaryTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-proper-lockfile-'));
  return { root, target: path.join(root, 'runtime.db') };
}

test('proper-lockfile mutex denies the exact same runtime target and allows takeover after release', async () => {
  const { root, target } = temporaryTarget();
  const first = new NamedRuntimeMutex({ lockTarget: target, acquireTimeoutMs: 1000 });
  const second = new NamedRuntimeMutex({ lockTarget: target, acquireTimeoutMs: 1000 });
  try {
    assert.equal(first.provider, 'PROPER_LOCKFILE');
    await first.acquire();
    await assert.rejects(second.acquire(), error => error?.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD' && error?.failedPhase === 'runtime_ownership');
    await first.release();
    await second.acquire();
    assert.equal(second.held, true);
  } finally {
    await second.release().catch(() => {});
    await first.release().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('portable mutex implementation does not expose legacy TCP endpoint or compatibility-brand infrastructure', () => {
  const module = require('../../backend/runtime/NamedRuntimeMutex');
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/runtime/NamedRuntimeMutex.js'), 'utf8');
  assert.equal(module.RuntimeMutexSet, undefined);
  assert.equal(module.portableEndpointForName, undefined);
  assert.equal(module.portablePortForName, undefined);
  assert.equal(module.legacyRuntimeMutexName, undefined);
  assert.doesNotMatch(source, /node:net|net\.createServer|127\.|PORTABLE_LOOPBACK_KERNEL_LOCK/u);
});
