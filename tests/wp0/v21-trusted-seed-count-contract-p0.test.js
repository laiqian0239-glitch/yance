'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CURRENT_SEED_COUNT = 261;
const LEGACY_TEST_PATH = path.join(ROOT, 'backend', 'tests', 'cleanInstallAuthority.test.js');
const POLICY_PATH = path.join(ROOT, 'governance', 'dependency-install-policy.json');
const { verifyTrustedDependencySeeds } = require('../../tools/runtime-delivery/dependency-install-authority');

test('current trusted dependency authority independently proves exactly 261 active seeds without stale json-buffer trust', () => {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  assert.equal(policy.trustedCacheSeeds.length, CURRENT_SEED_COUNT);
  assert.equal(
    policy.trustedCacheSeeds.some(seed => (
      seed.packageName === 'json-buffer'
      && seed.version === '3.0.1'
      && seed.lockPath === 'node_modules/json-buffer'
    )),
    false,
    'stale json-buffer@3.0.1 must not remain active trusted seed authority'
  );

  const verification = verifyTrustedDependencySeeds(ROOT);
  assert.equal(verification.seedCount, CURRENT_SEED_COUNT);
});

test('clean-install regression uses the current exact static trusted seed count', () => {
  const source = fs.readFileSync(LEGACY_TEST_PATH, 'utf8');
  assert.match(source, /assert\.equal\(verification\.seedCount,\s*261\);/u);
  assert.doesNotMatch(source, /assert\.equal\(verification\.seedCount,\s*262\);/u);
  assert.doesNotMatch(source, /assert\.equal\(verification\.seedCount,\s*307\);/u);
});
