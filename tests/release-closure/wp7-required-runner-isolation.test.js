'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../tools/wp7/run-required-tests.js'), 'utf8');

test('WP7 PRE_REVIEW required tests run in isolated Node processes with bounded execution', () => {
  assert.match(source, /for \(let index = 0; index < assignments\.length; index \+= 1\)/);
  assert.match(source, /function runIsolatedNodeTest\(\{ testId, rawRoot, env, timeout = 600000 \}\)/);
  assert.match(source, /path\.join\('tests', 'wp7', `\$\{testId\}\.js`\)/);
  assert.match(source, /const result = runIsolatedNodeTest\(\{ testId: id, rawRoot, env: process\.env \}\)/);
  assert.match(source, /timeout = 600000/);
  assert.match(source, /stdio: \['ignore', stdoutFd, stderrFd\]/);
  assert.match(source, /fs\.openSync\(stdoutPath, 'w'\)/);
  assert.match(source, /isolated_raw_output/);
  assert.doesNotMatch(source, /const files = assignments\.map[\s\S]{0,300}stdio: 'inherit'/);
});
