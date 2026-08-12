'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApplicationPayload, generatePayloadRecords, readReleaseSource } = require('../../tools/wp1/lib');
const { tempDir } = require('./helpers');

const SILLYTAVERN_RUNTIME_PATHS = Object.freeze([
  'vendor/sillytavern/1.18.0/LICENSE',
  'vendor/sillytavern/1.18.0/UPSTREAM.json',
  'vendor/sillytavern/1.18.0/src/character-card-parser.cjs',
  'vendor/sillytavern/1.18.0/src/png/encode.cjs',
  'vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs',
  'vendor/sillytavern/1.18.0/src/validator/TavernCardValidator.cjs'
]);

test('real application payload builder uses runtime allowlist and excludes development, evidence, tests, and installer tooling', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const payloadRoot = tempDir('yance-wp1-real-payload-');
  createApplicationPayload(repoRoot, payloadRoot);
  const paths = generatePayloadRecords(payloadRoot).map(item => item.path);
  assert.ok(paths.includes('backend/server.js'));
  assert.ok(paths.includes('electron_runtime/main.js'));
  assert.ok(paths.includes('electron_runtime/package.json'));
  for (const requiredPath of SILLYTAVERN_RUNTIME_PATHS) {
    assert.ok(paths.includes(requiredPath), `missing reviewed SillyTavern runtime payload path: ${requiredPath}`);
  }
  for (const candidate of paths) {
    assert.doesNotMatch(candidate, /(^|\/)(tests|evidence|verification|tools|installer|installers|packaging|build-scripts|release-scripts|docs|blueprint)(\/|$)/i, candidate);
  }
  assert.equal(paths.some(item => item.startsWith('backend/tests/')), false);
  assert.equal(paths.some(item => item.startsWith('installer/')), false);
  const generatedPackage = JSON.parse(fs.readFileSync(path.join(payloadRoot, 'electron_runtime', 'package.json'), 'utf8'));
  assert.equal(generatedPackage.version, readReleaseSource().productVersion);
});
