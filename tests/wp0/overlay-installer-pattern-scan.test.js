'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkOverlayInstallerPatterns, scanRepositoryReleaseSurfaces } = require('../../tools/wp0/lib');

test('overlay-installer-pattern-scan.test', () => {
  const result = checkOverlayInstallerPatterns();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.details.enumerationMethod, 'git ls-files -z');
  assert.ok(result.details.trackedFileCount >= 200, JSON.stringify(result.details));
  assert.ok(result.details.candidateFileCount >= 100, JSON.stringify(result.details));
});

test('repository scan enumerates complete tracked candidate surface, including scripts and release directories', () => {
  const scan = scanRepositoryReleaseSurfaces();
  assert.equal(scan.enumerationMethod, 'git ls-files -z');
  assert.equal(scan.scannedFileCount, scan.candidateFileCount);
  assert.ok(scan.scannedFiles.some((item) => item.path === 'package.json'));
  assert.ok(scan.scannedFiles.some((item) => item.path === '.github/workflows/stage-6459-wp0-gates.yml'));
  assert.ok(scan.scannedFiles.some((item) => item.path === 'tools/wp0/lib.js'));
});

test('overlay scanner detects base-installer plus unpacked overlay fixture', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-overlay-'));
  fs.mkdirSync(path.join(root, 'installer'), { recursive: true });
  fs.writeFileSync(path.join(root, 'installer', 'legacy.ps1'), [
    'Start-Process "Yance-29-Setup-29.2.4-x64-base.exe" -ArgumentList "/S"',
    'Copy-Item -Recurse payload\\* resources\\app.asar.unpacked\\'
  ].join('\n'));
  const result = checkOverlayInstallerPatterns(root);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED');
});
