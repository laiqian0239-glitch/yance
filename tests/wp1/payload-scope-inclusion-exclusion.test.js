'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApplicationPayload, generatePayloadRecords, readReleaseSource } = require('../../tools/wp1/lib');
const { tempDir } = require('./helpers');

test('real application payload builder uses runtime allowlist and excludes development, evidence, tests, and installer tooling', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const payloadRoot = tempDir('yance-wp1-real-payload-');
  createApplicationPayload(repoRoot, payloadRoot);
  const paths = generatePayloadRecords(payloadRoot).map(item => item.path);
  assert.ok(paths.includes('backend/server.js'));
  assert.ok(paths.includes('electron_runtime/main.js'));
  assert.ok(paths.includes('electron_runtime/package.json'));
  for (const candidate of paths) {
    assert.doesNotMatch(candidate, /(^|\/)(tests|evidence|verification|tools|installer|installers|packaging|build-scripts|release-scripts|docs|blueprint)(\/|$)/i, candidate);
  }
  assert.equal(paths.some(item => item.startsWith('backend/tests/')), false);
  assert.equal(paths.some(item => item.startsWith('installer/')), false);
  const generatedPackage = JSON.parse(fs.readFileSync(path.join(payloadRoot, 'electron_runtime', 'package.json'), 'utf8'));
  assert.equal(generatedPackage.version, readReleaseSource().productVersion);
});
