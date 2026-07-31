'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_REMOVE_OPTIONS,
  cleanupResourceAndRemove,
  cleanupSqliteTestStore,
  removePathWithRetries
} = require('../test-support/windows-cleanup');

test('Windows test cleanup closes SQLite before bounded EBUSY-aware removal', () => {
  const steps = [];
  cleanupSqliteTestStore(
    { close: () => steps.push('close') },
    'C:/temp/test-db',
    { rmSync: (_target, options) => { steps.push('remove'); assert.deepEqual(options, DEFAULT_REMOVE_OPTIONS); } }
  );
  assert.deepEqual(steps, ['close', 'remove']);
});

test('Windows test cleanup awaits asynchronous shutdown before removal', async () => {
  const steps = [];
  await cleanupResourceAndRemove(async () => {
    await Promise.resolve();
    steps.push('close');
  }, 'C:/temp/test-runtime', {
    rmSync: (_target, options) => { steps.push('remove'); assert.deepEqual(options, DEFAULT_REMOVE_OPTIONS); }
  });
  assert.deepEqual(steps, ['close', 'remove']);
});

test('Windows test cleanup propagates close failures and does not remove live resources', () => {
  let removed = false;
  assert.throws(() => cleanupSqliteTestStore({ close() { throw new Error('close failed'); } }, 'C:/temp/live-db', {
    rmSync() { removed = true; }
  }), /close failed/);
  assert.equal(removed, false);
});

test('Windows test cleanup never hides an exhausted removal failure', () => {
  const locked = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
  assert.throws(() => removePathWithRetries('C:/temp/locked', { rmSync() { throw locked; } }), error => error === locked);
});


function listJavaScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
  return files;
}

test('recursive test cleanup always uses bounded Windows lock retries', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const roots = [path.join(repoRoot, 'tests'), path.join(repoRoot, 'backend', 'tests')];
  const violations = [];
  const removalPattern = /\b(?:fs|fsImpl)\.rmSync\s*\((.*?)\)\s*;?/gs;

  for (const root of roots) {
    for (const filename of listJavaScriptFiles(root)) {
      const source = fs.readFileSync(filename, 'utf8');
      for (const match of source.matchAll(removalPattern)) {
        const call = match[0];
        if (!call.includes('recursive') || !call.includes('force')) continue;
        if (call.includes('maxRetries') && call.includes('retryDelay')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${path.relative(repoRoot, filename)}:${line}`);
      }
    }
  }

  assert.deepEqual(violations, [], `recursive test cleanup without bounded Windows retries:\n${violations.join('\n')}`);
});
