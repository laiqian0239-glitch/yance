'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_ARCHIVE = 'vendor/electron/electron-v39.8.5-win32-x64.zip';
const RCEDIT_ARCHIVE = 'vendor/rcedit/rcedit-v2.0.0-x64.exe';
const FUTURE_RCEDIT_ARCHIVE = 'vendor/rcedit/future-unreviewed.exe';
const EXPECTED_ELECTRON_SHA256 = 'd75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34';
const EXPECTED_ELECTRON_SIZE = 136644393;
const EXPECTED_RELEASE_URL = 'https://github.com/electron/electron/releases/download/v39.8.5/electron-v39.8.5-win32-x64.zip';

function lines(fileName) {
  return fs.readFileSync(path.join(REPO_ROOT, fileName), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

test('Electron archive source custody is retired while unrelated ZIP files remain ignored', () => {
  const ignoreLines = lines('.gitignore');
  const broadZipRule = ignoreLines.indexOf('*.zip');
  assert.notEqual(broadZipRule, -1, 'global ZIP ignore rule must remain present');
  assert.equal(ignoreLines.includes('!vendor/electron/*.zip'), false, 'Electron ZIPs must no longer be source-unignored');
  assert.equal(ignoreLines.includes('!*.zip'), false, 'broad ZIP unignore is forbidden');

  const electronCheck = spawnSync('git', ['check-ignore', '--no-index', '--quiet', ELECTRON_ARCHIVE], { cwd: REPO_ROOT });
  assert.equal(electronCheck.status, 0, 'retired Electron archive path must follow the normal ZIP ignore policy');
  const unrelatedCheck = spawnSync('git', ['check-ignore', '--no-index', '--quiet', 'untrusted-release.zip'], { cwd: REPO_ROOT });
  assert.equal(unrelatedCheck.status, 0, 'unrelated ZIP files must remain ignored');
});

test('Electron is no longer Git LFS custody while broad future rcedit remains LFS and the exact reviewed binary is native Git', () => {
  const attributeLines = lines('.gitattributes');
  assert.equal(
    attributeLines.includes('vendor/electron/*.zip filter=lfs diff=lfs merge=lfs -text'),
    false,
    'Electron archive LFS rule must be retired'
  );
  assert.equal(
    attributeLines.includes('vendor/rcedit/*.exe filter=lfs diff=lfs merge=lfs -text'),
    true,
    'future or unreviewed rcedit binaries must remain under broad LFS custody'
  );
  assert.equal(
    attributeLines.includes('vendor/rcedit/rcedit-v2.0.0-x64.exe -filter -diff -merge -text'),
    true,
    'only the exact reviewed rcedit v2.0.0 x64 binary may bypass LFS filtering'
  );

  const electronTracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', ELECTRON_ARCHIVE], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.notEqual(electronTracked.status, 0, 'Electron release archive must be removed from Git tracking');

  const futureRceditAttributes = spawnSync('git', ['check-attr', 'filter', 'diff', 'merge', 'text', '--', FUTURE_RCEDIT_ARCHIVE], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(futureRceditAttributes.status, 0);
  assert.match(futureRceditAttributes.stdout, /filter: lfs/u);
  assert.match(futureRceditAttributes.stdout, /diff: lfs/u);
  assert.match(futureRceditAttributes.stdout, /merge: lfs/u);
  assert.match(futureRceditAttributes.stdout, /text: unset/u);

  const rceditAttributes = spawnSync('git', ['check-attr', 'filter', 'diff', 'merge', 'text', '--', RCEDIT_ARCHIVE], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(rceditAttributes.status, 0);
  assert.match(rceditAttributes.stdout, /filter: unset/u);
  assert.match(rceditAttributes.stdout, /diff: unset/u);
  assert.match(rceditAttributes.stdout, /merge: unset/u);
  assert.match(rceditAttributes.stdout, /text: unset/u);
});

test('Electron trust authority binds the exact official v39.8.5 GitHub Release asset identity', () => {
  const trust = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'release/electron-distribution-trust.json'), 'utf8'));
  const archive = trust.archives?.['win32-x64'];
  assert.ok(archive);
  assert.equal(archive.fileName, 'electron-v39.8.5-win32-x64.zip');
  assert.equal(archive.sha256, EXPECTED_ELECTRON_SHA256);
  assert.equal(archive.sizeBytes, EXPECTED_ELECTRON_SIZE);
  assert.equal(archive.sourceRepository, 'electron/electron');
  assert.equal(archive.releaseTag, 'v39.8.5');
  assert.equal(archive.assetId, 382512506);
  assert.equal(archive.downloadUrl, EXPECTED_RELEASE_URL);
});
