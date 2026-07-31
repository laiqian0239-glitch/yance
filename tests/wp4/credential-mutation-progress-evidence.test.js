'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { appendMutationProgress } = require('../../tools/wp4/run-credential-mutation-tests');

test('mutation progress evidence is append-only JSONL and creates private parent storage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-mutation-progress-'));
  try {
    const file = path.join(root, 'nested', 'progress.jsonl');
    appendMutationProgress(file, { event: 'START', mutationCount: 62 });
    appendMutationProgress(file, { event: 'RESULT', id: 'M01', status: 'PASS' });
    const rows = fs.readFileSync(file, 'utf8').trim().split(/\n/).map(JSON.parse);
    assert.deepEqual(rows, [
      { event: 'START', mutationCount: 62 },
      { event: 'RESULT', id: 'M01', status: 'PASS' }
    ]);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('mutation progress evidence is optional', () => {
  assert.doesNotThrow(() => appendMutationProgress('', { event: 'IGNORED' }));
});
