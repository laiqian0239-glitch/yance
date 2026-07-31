'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.resolve(__dirname, '../../tools/wp0/run-tests.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

test('WP0 tests run in isolated bounded child processes', () => {
  assert.equal(pkg.scripts['test:wp0'], 'node tools/wp0/run-tests.js');
  assert.match(runner, /spawnSync\(process\.execPath, \['--test', '--test-concurrency=1', file\]/);
  assert.match(runner, /timeout = 600000/);
  assert.match(runner, /stdio: \['ignore', stdoutFd, stderrFd\]/);
  assert.match(runner, /isolated_raw_output/);
  assert.doesNotMatch(runner, /node --test tests\/wp0\/\*\.test\.js/);
});
