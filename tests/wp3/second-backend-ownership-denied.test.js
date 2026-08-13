'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');

test('second backend is denied by proper-lockfile while the first process-wide runtime target is held', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/runtime/NamedRuntimeMutex.js'), 'utf8');
  assert.match(source, /require\(['"]proper-lockfile['"]\)/u);
  assert.doesNotMatch(source, /System\.Threading\.Mutex|node:net|RuntimeMutexSet|legacyRuntimeMutexName/u);
  const root = temporaryRoot();
  let first = null;
  try {
    first = await createOwnership(root);
    assert.equal(first.snapshot().mutexProvider, 'PROPER_LOCKFILE');
    await assert.rejects(createOwnership.bind(null, root), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD' && error.failedPhase === 'runtime_ownership');
  } finally {
    await first?.release();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
