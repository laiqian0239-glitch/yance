'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const OLD_SHA = 'd75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34';
const NEW_SHA = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a';
const OLD_SIZE = '136644393';
const NEW_SIZE = '150154788';
const OLD_ASSET_ID = '382512506';
const NEW_ASSET_ID = '520075991';

function replaceExact(file, before, after, expectedAtLeast = 1) {
  let text = fs.readFileSync(file, 'utf8');
  const count = text.split(before).length - 1;
  assert.ok(count >= expectedAtLeast, `${file}: missing expected token ${before}`);
  text = text.replaceAll(before, after);
  fs.writeFileSync(file, text, 'utf8');
}

for (const file of [
  '.github/workflows/stage-6459-wp0-gates.yml',
  '.github/workflows/v21-product-experience-shell-p0-final-validation.yml',
  '.github/workflows/windows-production-release.yml',
  'tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1',
  'tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1',
  'tools/windows/VERIFY_RUNTIME_IDENTITY.ps1',
  'tools/wp7/generate-trusted-product-probe-blocker.js',
  'tests/runtime-delivery/electron-archive-tracking-authority.test.js'
]) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replaceAll(OLD_SHA, NEW_SHA).replaceAll(OLD_SIZE, NEW_SIZE).replaceAll(OLD_ASSET_ID, NEW_ASSET_ID);
  fs.writeFileSync(file, text, 'utf8');
}

const sourceTestPath = 'tests/runtime-delivery/source-uat-delivery.test.js';
let sourceTest = fs.readFileSync(sourceTestPath, 'utf8');
const oldArchiveBlock = `test('Electron local archive recovery is bound to the reviewed Windows SHA-256', () => {\n  const artifact = expectedElectronArtifact(repoRoot, 'win32', 'x64');\n  assert.equal(artifact.fileName, 'electron-v43.4.1-win32-x64.zip');\n  assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);\n  const expectedArchive = path.join(repoRoot, 'vendor', 'electron', artifact.fileName);\n  const discovered = discoverElectronArchive(repoRoot, { platform: 'win32', arch: 'x64', electronZip: path.join(tempRoot(), 'missing.zip') });\n  assert.equal(discovered.archivePath, expectedArchive);\n  assert.equal(discovered.actualSha256, artifact.sha256);\n  assert.equal(discovered.artifact.sha256, artifact.sha256);\n});`;
const newArchiveBlock = `test('Electron local archive recovery is trust-bound without checked-in Release ZIP custody', () => {\n  const artifact = expectedElectronArtifact(repoRoot, 'win32', 'x64');\n  assert.equal(artifact.fileName, 'electron-v43.4.1-win32-x64.zip');\n  assert.equal(artifact.sha256, '${NEW_SHA}');\n  const retiredSourceCandidate = path.join(repoRoot, 'vendor', 'electron', artifact.fileName);\n  const discovered = discoverElectronArchive(repoRoot, { platform: 'win32', arch: 'x64', electronZip: path.join(tempRoot(), 'missing.zip') });\n  assert.equal(discovered.archivePath, '');\n  assert.ok(discovered.candidates.includes(retiredSourceCandidate));\n  assert.equal(discovered.artifact.sha256, artifact.sha256);\n});`;
assert.equal(sourceTest.split(oldArchiveBlock).length - 1, 1, 'source UAT archive contract patch target must be exact');
sourceTest = sourceTest.replace(oldArchiveBlock, newArchiveBlock);

const fix6oStart = `test('FIX6O Windows launcher uses the trusted install authority without sandbox bypasses', () => {`;
const nextTest = `\ntest('obsolete root launchers remain quarantined and npm scripts use the source UAT authority', () => {`;
const startIndex = sourceTest.indexOf(fix6oStart);
const endIndex = sourceTest.indexOf(nextTest, startIndex);
assert.ok(startIndex >= 0 && endIndex > startIndex, 'FIX6O historical contract boundaries must exist');
const replacement = `test('FIX6O Windows launcher remains byte-for-byte historical evidence without becoming active Electron authority', () => {\n  const cmdPath = path.join(repoRoot, 'RUN_FIX6O_GATE0_WINDOWS_UAT.cmd');\n  const ps1Path = path.join(repoRoot, 'RUN_FIX6O_GATE0_WINDOWS_UAT.ps1');\n  assert.equal(fs.existsSync(cmdPath), true);\n  assert.equal(fs.existsSync(ps1Path), true);\n\n  const cmdBlob = spawnSync('git', ['rev-parse', 'HEAD:RUN_FIX6O_GATE0_WINDOWS_UAT.cmd'], { cwd: repoRoot, encoding: 'utf8' });\n  const ps1Blob = spawnSync('git', ['rev-parse', 'HEAD:RUN_FIX6O_GATE0_WINDOWS_UAT.ps1'], { cwd: repoRoot, encoding: 'utf8' });\n  assert.equal(cmdBlob.status, 0);\n  assert.equal(ps1Blob.status, 0);\n  assert.equal(cmdBlob.stdout.trim(), '9ff34efd68e0d187fb8136513d9759436e6693c8');\n  assert.equal(ps1Blob.stdout.trim(), '6be5138e41c6ec2b10e041c0288011f522e2ab47');\n\n  const cmd = fs.readFileSync(cmdPath, 'utf8');\n  const ps1 = fs.readFileSync(ps1Path, 'utf8');\n  assert.match(cmd, /RUN_FIX6O_GATE0_WINDOWS_UAT\\.ps1/u);\n  assert.match(cmd, /pause[\\s\\S]*exit \\/b %YANCE_EXIT%/u, 'launcher must remain visible after failure or normal exit');\n  assert.match(ps1, /tools[\\\\/]runtime-delivery[\\\\/]start-source-uat\\.js/u);\n  assert.match(ps1, /gate0-windows-launcher/u);\n  assert.match(ps1, /Start-Process/u);\n  assert.match(ps1, /RedirectStandardOutput/u);\n  assert.match(ps1, /RedirectStandardError/u);\n  assert.match(ps1, /--install/u);\n  assert.doesNotMatch(\`${'${cmd}'}\\n${'${ps1}'}\`, /--no-sandbox|ELECTRON_DISABLE_SANDBOX/iu);\n});`;
sourceTest = sourceTest.slice(0, startIndex) + replacement + sourceTest.slice(endIndex);
sourceTest = sourceTest.replaceAll(OLD_SHA, NEW_SHA).replaceAll(OLD_SIZE, NEW_SIZE).replaceAll(OLD_ASSET_ID, NEW_ASSET_ID);
assert.equal(sourceTest.includes('39.8.5'), false, 'active source-UAT contract must contain no EOL Electron identity');
fs.writeFileSync(sourceTestPath, sourceTest, 'utf8');
