'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const testsRoot = __dirname;

test('backend tests cannot pass unsupported filePath to R32SqliteStore', () => {
  const offenders = [];
  for (const name of fs.readdirSync(testsRoot).filter(value => value.endsWith('.test.js'))) {
    const source = fs.readFileSync(path.join(testsRoot, name), 'utf8');
    if (/new\s+R32SqliteStore\s*\(\s*\{\s*filePath\s*:/u.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `unsupported R32SqliteStore option would fall back to source data: ${offenders.join(', ')}`);
});
