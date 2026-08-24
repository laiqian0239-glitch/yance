'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CURRENT_SEED_COUNT = 262;
const LEGACY_TEST_PATH = path.join(ROOT, 'backend', 'tests', 'cleanInstallAuthority.test.js');
const POLICY_PATH = path.join(ROOT, 'governance', 'dependency-install-policy.json');
const { verifyTrustedDependencySeeds } = require('../../tools/runtime-delivery/dependency-install-authority');

test('current trusted dependency authority independently proves exactly 262 active seeds', () => {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  assert.equal(policy.trustedCacheSeeds.length, CURRENT_SEED_COUNT);

  const verification = verifyTrustedDependencySeeds(ROOT);
  assert.equal(verification.seedCount, CURRENT_SEED_COUNT);
});

test('clean-install regression uses the current exact static trusted seed count', () => {
  const source = fs.readFileSync(LEGACY_TEST_PATH, 'utf8');
  assert.match(source, /assert\.equal\(verification\.seedCount,\s*262\);/u);
  assert.doesNotMatch(source, /assert\.equal\(verification\.seedCount,\s*307\);/u);
});
