'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '../..');

test('npm dependency graph is locked for clean reproducible installation', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.packageManager, 'npm@10.9.2');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].name, packageJson.name);
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);
  assert.ok(Object.keys(lock.packages).length > 200);
});
