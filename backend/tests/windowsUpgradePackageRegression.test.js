'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPackage, powershellScript, sha256File } = require('../../tools/release/create-windows-upgrade-package');

const BASELINE = '66574c7937d6a1eb43e62ca9cf3eafcd682e304b';
const TARGET = '1'.repeat(40);
const TREE = '2'.repeat(40);

test('one-click upgrade package binds installer, baseline, target and rollback workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-upgrade-package-'));
  const installer = path.join(root, 'Yance-Setup-1.0.0-x64.exe');
  fs.writeFileSync(installer, Buffer.from('fixture-installer'));
  const output = path.join(root, 'out');
  const result = createPackage({ installer, outputDir: output, baselineCommit: BASELINE, targetCommit: TARGET, targetTree: TREE });
  assert.equal(result.status, 'PASS');
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.deepEqual(manifest.allowedBaselineSourceCommits, [BASELINE]);
  assert.equal(manifest.targetSourceCommit, TARGET);
  assert.equal(manifest.targetSourceTree, TREE);
  assert.equal(manifest.installerSha256, sha256File(result.installerPath));
  assert.equal(manifest.requirePlatformAuth, true);
  assert.ok(fs.existsSync(path.join(output, '开始升级言策.cmd')));
});

test('upgrade PowerShell is fail-closed and includes application plus user-data rollback', () => {
  const script = powershellScript();
  assert.match(script, /Read-InstalledIdentity/);
  assert.match(script, /allowedBaselineSourceCommits/);
  assert.match(script, /Copy-Tree \$InstallRoot \$ApplicationBackup/);
  assert.match(script, /Copy-Tree \$UserDataRoot \$UserDataBackup/);
  assert.match(script, /Copy-Tree \$ApplicationBackup \$InstallRoot -Mirror/);
  assert.match(script, /Copy-Tree \$UserDataBackup \$UserDataRoot -Mirror/);
  assert.match(script, /post-install-launch\.pass/);
  assert.match(script, /platformAuthConfigured/);
  assert.match(script, /platformAuthReleaseManaged/);
  assert.doesNotMatch(script, /\$args = @\(/);
});

test('upgrade package rejects incomplete Git identities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-upgrade-package-invalid-'));
  const installer = path.join(root, 'installer.exe');
  fs.writeFileSync(installer, 'fixture');
  assert.throws(() => createPackage({ installer, outputDir: path.join(root, 'out'), baselineCommit: 'bad', targetCommit: TARGET, targetTree: TREE }), error => error.code === 'YANCE_UPGRADE_GIT_ID_INVALID');
});


test('upgrade generator rejects a missing or non-empty output path without deleting existing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-upgrade-output-safety-'));
  const installer = path.join(root, 'installer.exe');
  fs.writeFileSync(installer, 'fixture');
  assert.throws(() => createPackage({ installer, baselineCommit: BASELINE, targetCommit: TARGET, targetTree: TREE }), error => error.code === 'YANCE_UPGRADE_OUTPUT_REQUIRED');
  const output = path.join(root, 'existing');
  fs.mkdirSync(output);
  const sentinel = path.join(output, 'do-not-delete.txt');
  fs.writeFileSync(sentinel, 'keep');
  assert.throws(() => createPackage({ installer, outputDir: output, baselineCommit: BASELINE, targetCommit: TARGET, targetTree: TREE }), error => error.code === 'YANCE_UPGRADE_OUTPUT_NOT_EMPTY');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
