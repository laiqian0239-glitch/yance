'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const runner = fs.readFileSync(path.join(ROOT, 'tools/wp0/run-tests.js'), 'utf8');
const REQUIRED_EXTERNAL_TESTS = [
  'tests/wp2/desktop-host-process-lifecycle.test.js',
  'tests/wp4/evidence-platform-identity-and-windows-collector.test.js'
];

test('WP0 required runner executes the exact Electron lifecycle diagnostics through its isolated child model', () => {
  for (const repoPath of REQUIRED_EXTERNAL_TESTS) {
    assert.equal(
      runner.includes(`'${repoPath}'`) || runner.includes(`"${repoPath}"`),
      true,
      `WP0 required-test runner is missing exact diagnostic path: ${repoPath}`
    );
  }
  assert.match(runner, /fs\.readdirSync\(TEST_ROOT\)/);
  assert.match(runner, /runIsolatedTest\(files\[index\], rawRoot\)/);
  assert.match(runner, /spawnSync\(process\.execPath, \['--test', '--test-concurrency=1', file\]/);
  assert.doesNotMatch(runner, /tests\/wp2\/\*\.test\.js/);
  assert.doesNotMatch(runner, /tests\/wp4\/\*\.test\.js/);
});
