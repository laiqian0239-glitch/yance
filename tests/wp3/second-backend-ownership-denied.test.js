'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createOwnership, temporaryRoot } = require('./helpers');
test('second backend is denied while the first process-wide Runtime mutex is held', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/runtime/NamedRuntimeMutex.js'), 'utf8');
  assert.match(source, /System\.Threading\.Mutex/);
  assert.match(source, /Local\\\\Yance\.AppRuntime/);
  const root = temporaryRoot();
  let first = null;
  try {
    first = await createOwnership(root);
    const second = createOwnership.bind(null, root);
    await assert.rejects(second(), error => error.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD' && error.failedPhase === 'runtime_ownership');
  } finally {
    await first?.release();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
