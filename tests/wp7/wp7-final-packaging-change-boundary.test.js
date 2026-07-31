'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readPreacceptanceBinding } = require('../../tools/wp7/lib');

test('wp7-final-packaging-change-boundary.test', () => {
  const repo = path.resolve(process.env.WP7_FINAL_DELIVERY_REPO || process.cwd());
  const binding = readPreacceptanceBinding({
    recordPath: process.env.WP7_PREACCEPTANCE_RECORD,
    recordSha256: process.env.WP7_PREACCEPTANCE_RECORD_SHA256
  });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['diff', '--name-only', `${binding.implementationCommit}..${head}`], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const allowed = /^(implementation\/|governance\/|evidence\/|docs\/wp7\/|release\/final-delivery\/)/;
  const forbidden = changed.filter((file) => !allowed.test(file));
  assert.deepEqual(forbidden, [], `post-preacceptance production/source changes detected: ${forbidden.join(', ')}`);
});
