'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Vowpal Wabbit supply chain is pinned to 9.11.2 with exact upstream provenance and BSD-3-Clause notice', () => {
  const pyproject = read('runtime/learning-growth/python/pyproject.toml');
  const lock = read('runtime/learning-growth/python/uv.lock');
  const upstream = JSON.parse(read('config/upstreams/v21-learning-growth-brain-p0.json'));
  const notices = read('THIRD_PARTY_NOTICES.md');
  const license = read('third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt');

  assert.match(pyproject, /vowpalwabbit\s*==\s*9\.11\.2/i);
  assert.match(lock, /name\s*=\s*["']vowpalwabbit["']/i);
  assert.match(lock, /version\s*=\s*["']9\.11\.2["']/i);
  assert.match(JSON.stringify(upstream), /122bae254a5b8bc2b774d13b33d53e6dbc2cfba7/);
  assert.match(notices, /Vowpal Wabbit/i);
  assert.match(notices, /BSD-3-Clause/i);
  assert.match(license, /Redistribution and use in source and binary forms/i);
});
