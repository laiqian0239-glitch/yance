'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const generator = require('../../tools/wp4/generate-evidence');

test('WP4 evidence required tests enumerate files without shell glob expansion', () => {
  const files = generator.requiredWp4TestFiles();
  assert.ok(files.length > 0);
  assert.ok(files.every(file => file.startsWith(path.join('tests', 'wp4')) && file.endsWith('.test.js')));
  assert.equal(files.some(file => file.includes('*')), false);
  const source = fs.readFileSync(path.join(__dirname, '../../tools/wp4/generate-evidence.js'), 'utf8');
  assert.match(source, /shell:\s*false/);
  assert.match(source, /--test-reporter=tap/);
  assert.doesNotMatch(source, /tests\/wp4\/\*\.test\.js/);
});

test('WP4 evidence parser accepts deterministic TAP and Node spec summaries', () => {
  assert.deepEqual(generator.parseNodeTestSummary('# tests 4\n# pass 4\n# fail 0\n# skipped 0\n'), { tests: 4, pass: 4, fail: 0, skipped: 0 });
  assert.deepEqual(generator.parseNodeTestSummary('ℹ tests 5\nℹ pass 4\nℹ fail 1\nℹ skipped 0\n'), { tests: 5, pass: 4, fail: 1, skipped: 0 });
});
