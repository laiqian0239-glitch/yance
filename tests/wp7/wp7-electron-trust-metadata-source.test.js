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
test('WP7 seal and packaged probe project explicit isolated Electron npm trust root', () => {
  const sealSource = fs.readFileSync(
    path.join(ROOT, 'tools', 'wp7', 'create-pre-review-sealed-artifact.js'),
    'utf8'
  );
  const probeSource = fs.readFileSync(
    path.join(ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'),
    'utf8'
  );

  assert.ok(
    sealSource.includes('electronNpmPackageRoot: options.electronNpmPackageRoot,'),
    'pre-review seal API must forward the isolated Electron npm package root to the mature verifier'
  );
  assert.ok(
    sealSource.includes(
      "electronNpmPackageRoot: arg('--electron-npm-package-root') || process.env.WP7_ELECTRON_NPM_PACKAGE_ROOT || undefined,"
    ),
    'pre-review seal CLI must consume the isolated Electron npm package root without repository-root Electron install'
  );

  assert.ok(
    probeSource.includes("'--electron-npm-package-root': 'WP7_ELECTRON_NPM_PACKAGE_ROOT',"),
    'packaged probe CLI must expose the existing Electron npm package-root authority'
  );
  assert.ok(
    probeSource.includes('electronNpmPackageRoot: options.electronNpmPackageRoot,'),
    'packaged probe API must forward the isolated Electron npm package root to the mature verifier'
  );
  assert.ok(
    probeSource.includes("electronNpmPackageRoot: arg('--electron-npm-package-root'),"),
    'packaged probe entrypoint must bind the isolated Electron npm package root'
  );
});

test('WP7 seal and packaged probe project explicit isolated Electron distribution root', () => {
  const sealSource = fs.readFileSync(
    path.join(ROOT, 'tools', 'wp7', 'create-pre-review-sealed-artifact.js'),
    'utf8'
  );
  const probeSource = fs.readFileSync(
    path.join(ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'),
    'utf8'
  );

  assert.ok(
    sealSource.includes('electronDist: options.electronDist,'),
    'pre-review seal API must forward the isolated Electron distribution root to mature trust verification'
  );
  assert.ok(
    sealSource.includes("electronDist: arg('--electron-dist') || process.env.WP7_ELECTRON_DISTRIBUTION_ROOT || undefined,"),
    'pre-review seal CLI must project the isolated Electron distribution root'
  );

  assert.ok(
    probeSource.includes("'--electron-dist': 'WP7_ELECTRON_DISTRIBUTION_ROOT',"),
    'packaged probe CLI must expose the isolated Electron distribution root'
  );
  assert.ok(
    probeSource.includes('electronDist: options.electronDist,'),
    'packaged probe API must forward the isolated Electron distribution root to mature trust verification'
  );
  assert.ok(
    probeSource.includes("electronDist: arg('--electron-dist'),"),
    'packaged probe entrypoint must bind the isolated Electron distribution root'
  );
});
