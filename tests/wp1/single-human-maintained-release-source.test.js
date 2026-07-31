'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deriveDatabaseSchemaVersion, readReleaseSource, scanSingleHumanMaintainedReleaseSource } = require('../../tools/wp1/lib');

test('release-source.json is the only manually maintained release identity source', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const source = readReleaseSource();
  assert.equal(Object.hasOwn(source, 'databaseSchemaVersion'), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.0.0-development');
  assert.equal(String(pkg.description).includes(source.stageVersion), false);
  const scan = scanSingleHumanMaintainedReleaseSource(repoRoot, source);
  assert.equal(scan.status, 'PASS', JSON.stringify(scan.violations));
  const schema = deriveDatabaseSchemaVersion(repoRoot);
  assert.ok(schema.databaseSchemaVersion >= 1);
  assert.ok(schema.authorities.some(item => item.path.startsWith('backend/migrations/')));
});
