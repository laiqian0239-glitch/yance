'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

function generateBindingInIsolatedRepo() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-binding-regeneration-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(sandboxRoot, 'package.json'));
    fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(sandboxRoot, 'package-lock.json'));
    fs.mkdirSync(path.join(sandboxRoot, 'tools'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools', 'wp7'), path.join(sandboxRoot, 'tools', 'wp7'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'release'), { recursive: true });

    const generatorPath = path.join(sandboxRoot, 'tools', 'wp7', 'generate-production-dependency-binding.js');
    const result = spawnSync(process.execPath, [generatorPath], {
      cwd: sandboxRoot,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 540000,
      windowsHide: true
    });

    assert.equal(
      result.status,
      0,
      `isolated WP7 dependency binding generation failed\n${[
        result.error?.stack || result.error?.message || '',
        result.stdout || '',
        result.stderr || ''
      ].filter(Boolean).join('\n')}`
    );

    return JSON.parse(fs.readFileSync(path.join(sandboxRoot, 'release', 'production-dependency-binding.json'), 'utf8'));
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
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

test('WP7 reviewed production dependency binding exactly matches isolated generator output', {
  skip: process.platform === 'linux' ? false : 'full cross-platform binding regeneration requires Linux POSIX file-mode authority'
}, () => {
  const binding = readJson('release/production-dependency-binding.json');
  const regenerated = generateBindingInIsolatedRepo();

  assert.deepEqual(
    regenerated,
    binding,
    'reviewed binding must equal a complete fresh isolated output from the existing WP7 generator; manual hash-only or stale platform edits are forbidden'
  );
});
