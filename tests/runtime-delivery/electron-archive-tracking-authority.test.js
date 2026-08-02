'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_ARCHIVE = 'vendor/electron/electron-v39.8.5-win32-x64.zip';

function lines(fileName) {
  return fs.readFileSync(path.join(REPO_ROOT, fileName), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

test('Electron archives are normally discoverable while unrelated ZIP files remain ignored', () => {
  const ignoreLines = lines('.gitignore');
  const broadZipRule = ignoreLines.indexOf('*.zip');
  const electronException = ignoreLines.indexOf('!vendor/electron/*.zip');
  assert.notEqual(broadZipRule, -1, 'global ZIP ignore rule must remain present');
  assert.ok(electronException > broadZipRule, 'Electron exception must follow the global ZIP ignore rule');
  assert.equal(ignoreLines.includes('!*.zip'), false, 'broad ZIP unignore is forbidden');

  const electronCheck = spawnSync('git', ['check-ignore', '--no-index', '--quiet', ELECTRON_ARCHIVE], { cwd: REPO_ROOT });
  assert.equal(electronCheck.status, 1, 'trusted Electron archive must not be ignored');
  const unrelatedCheck = spawnSync('git', ['check-ignore', '--no-index', '--quiet', 'untrusted-release.zip'], { cwd: REPO_ROOT });
  assert.equal(unrelatedCheck.status, 0, 'unrelated ZIP files must remain ignored');
});

test('Electron archives are bound to the Git LFS filter contract', () => {
  const attributeLines = lines('.gitattributes');
  assert.ok(
    attributeLines.includes('vendor/electron/*.zip filter=lfs diff=lfs merge=lfs -text'),
    'Electron archive LFS rule is missing'
  );
  const attributes = execFileSync('git', ['check-attr', 'filter', 'diff', 'merge', 'text', '--', ELECTRON_ARCHIVE], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.match(attributes, /filter: lfs/u);
  assert.match(attributes, /diff: lfs/u);
  assert.match(attributes, /merge: lfs/u);
  assert.match(attributes, /text: unset/u);
});
