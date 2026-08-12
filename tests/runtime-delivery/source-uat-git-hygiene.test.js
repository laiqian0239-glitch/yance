'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

test('canonical source-UAT private dependency cache is ignored by git identity checks', () => {
  const probe = '.yance-cache/source-uat-git-identity-probe';
  const result = spawnSync('git', ['-C', repoRoot, 'check-ignore', '--no-index', '-q', probe], {
    encoding: 'utf8',
    shell: false
  });

  assert.equal(
    result.status,
    0,
    `.yance-cache must be ignored by repository git identity policy (status=${result.status})`
  );
});
