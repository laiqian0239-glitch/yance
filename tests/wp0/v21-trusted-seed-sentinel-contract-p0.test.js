'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('clean-install trusted seed sentinels are active policy identities', () => {
  const policy = readJson('governance/dependency-install-policy.json');
  const active = new Set((policy.trustedCacheSeeds || []).map(seed => `${seed.packageName}@${seed.version}`));
  const source = readText('backend/tests/cleanInstallAuthority.test.js');
  const sentinels = [...source.matchAll(/packageVersions\.has\('([^']+)'\)/gu)].map(match => match[1]);
  const retired = sentinels.filter(identity => !active.has(identity));

  assert.equal(active.size, 261);
  assert.deepEqual(retired, []);
});
