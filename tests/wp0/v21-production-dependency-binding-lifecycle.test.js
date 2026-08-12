'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateBindingDocument } = require('../../tools/wp7/production-dependency-binding');

const ROOT = path.resolve(__dirname, '../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

function sha256File(relativePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, ...relativePath.split('/'))))
    .digest('hex');
}

test('WP7 reviewed production dependency binding follows the current root package authority', () => {
  const pkg = readJson('package.json');
  const binding = readJson('release/production-dependency-binding.json');
  const generator = readText('tools/wp7/generate-production-dependency-binding.js');

  assert.equal(pkg.packageManager, 'npm@10.9.2', 'root package-manager authority must remain exact npm@10.9.2');
  assert.equal(binding.documentType, 'YANCE_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING');
  assert.equal(binding.authorityClass, 'REVIEWED_GIT_EXTERNAL_TO_PACKAGED_PAYLOAD');
  assert.equal(binding.generatedBy, 'tools/wp7/generate-production-dependency-binding.js');
  assert.equal(binding.packageManager, pkg.packageManager, 'reviewed binding must use the current exact package-manager authority');
  assert.deepEqual([...binding.platformKeys].sort(), ['linux-x64', 'win32-x64']);
  assert.deepEqual(Object.keys(binding.platforms).sort(), ['linux-x64', 'win32-x64']);
  for (const key of ['linux-x64', 'win32-x64']) {
    assert.equal(binding.platforms[key].npmVersion, '10.9.2', `${key} binding must record exact npm@10.9.2 generation authority`);
  }
  assert.doesNotThrow(() => validateBindingDocument(binding), 'reviewed binding must remain structurally and cryptographically self-consistent');

  assert.equal(
    binding.packageJsonSha256,
    sha256File('package.json'),
    'reviewed binding must bind the current root package.json bytes; regenerate through the existing WP7 generator when dependency authority changes'
  );
  assert.equal(
    binding.packageLockSha256,
    sha256File('package-lock.json'),
    'reviewed binding must bind the current root package-lock.json bytes; regenerate the complete cross-platform binding rather than patching hashes'
  );

  assert.match(generator, /createBindingDocument/u, 'existing generator must remain the document owner');
  assert.match(generator, /createPlatformBinding/u, 'existing generator must regenerate complete platform bindings');
  assert.match(generator, /runNpmCommand/u, 'existing generator must materialize the reviewed npm production closure');
  assert.doesNotMatch(generator, /packageJsonSha256\s*[:=]\s*['"][0-9a-f]{64}/u, 'generator must never hard-code reviewed package hashes');
  assert.doesNotMatch(generator, /packageLockSha256\s*[:=]\s*['"][0-9a-f]{64}/u, 'generator must never hard-code reviewed lock hashes');
});
