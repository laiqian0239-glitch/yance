'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const { loadTrust } = require('../../tools/wp7/packaged-product-trust');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isolatedTrustFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-electron-trust-root-'));
  const electronNpmPackageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-electron-npm-package-'));
  const trust = JSON.parse(fs.readFileSync(path.join(ROOT, 'release', 'electron-distribution-trust.json'), 'utf8'));
  const archive = trust.archives['win32-x64'];

  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'release', 'electron-distribution-trust.json'), path.join(root, 'release', 'electron-distribution-trust.json'));
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(root, 'package-lock.json'));
  writeJson(path.join(electronNpmPackageRoot, 'package.json'), { name: 'electron', version: trust.electronVersion });
  writeJson(path.join(electronNpmPackageRoot, 'checksums.json'), { [archive.fileName]: archive.sha256 });

  return { root, electronNpmPackageRoot };
}

test('WP7 Electron trust consumes an explicit isolated npm package metadata root without repository-root Electron install', () => {
  const fixture = isolatedTrustFixture();
  assert.equal(fs.existsSync(path.join(fixture.root, 'node_modules', 'electron', 'package.json')), false);
  assert.equal(fs.existsSync(path.join(fixture.root, 'node_modules', 'electron', 'checksums.json')), false);

  let trust;
  try {
    trust = loadTrust(fixture.root, 'win32', 'x64', fixture.electronNpmPackageRoot);
  } catch (error) {
    throw new Error(
      `causal RED: explicit Electron npm metadata root was ignored: ${error.reasonCode || 'NO_REASON_CODE'}: ${error.message}; path=${error.details?.filePath || 'n/a'}`,
      { cause: error }
    );
  }

  assert.equal(trust.electronPackagePath, fs.realpathSync(path.join(fixture.electronNpmPackageRoot, 'package.json')));
  assert.equal(trust.checksumsPath, fs.realpathSync(path.join(fixture.electronNpmPackageRoot, 'checksums.json')));
});
