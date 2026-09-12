'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersion } = require('../../electron/updateVerifier');

const ROOT = path.resolve(__dirname, '../..');
const releaseSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'release/release-source.json'), 'utf8'));
const installer = fs.readFileSync(path.join(ROOT, 'installer/wp7/YanceFinalInstaller.nsi'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

test('new public and Windows identities are consistently Yance while technical update version remains monotonic', () => {
  assert.equal(releaseSource.productName, '言策');
  assert.equal(releaseSource.publicProductName, '言策');
  assert.equal(releaseSource.publicProductNameEnglish, 'Yance');
  assert.equal(releaseSource.publicVersion, '1.0.0');
  assert.equal(releaseSource.internalProductId, 'Yance');
  assert.equal(releaseSource.executableName, 'Yance.exe');
  assert.equal(releaseSource.installDirectoryName, 'Yance');
  assert.equal(releaseSource.userDataDirectoryName, 'Yance');
  assert.equal(releaseSource.internalName, 'Yance');
  assert.equal(releaseSource.originalFilename, 'Yance.exe');
  assert.equal(releaseSource.installerBaseName, 'Yance-Setup');
  assert.equal(releaseSource.appUserModelId, 'com.yance.desktop');
  assert.equal(releaseSource.brandingEpoch, 2);
  assert.equal(compareVersion(releaseSource.productVersion, '29.2.6'), 1);
});

test('internal test release stays local, unsigned and manual-update only', () => {
  assert.equal(releaseSource.distributionMode, 'LOCAL_PRIVATE_UNSIGNED');
  assert.equal(releaseSource.releaseChannel, 'INTERNAL_TEST_ONLY');
  assert.equal(releaseSource.onlineUpdatesEnabled, false);
  assert.equal(releaseSource.updateMode, 'MANUAL_INSTALLER_ONLY');
  assert.equal(releaseSource.formalPublicReleaseAuthorized, false);
});

test('source package stays development-only while packaged runtime uses the monotonic technical version', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  assert.equal(packageJson.name, 'yance-desktop');
  assert.equal(packageJson.version, '0.0.0-development');
  assert.equal(packageLock.name, 'yance-desktop');
  assert.equal(packageLock.version, '0.0.0-development');
  assert.equal(packageLock.packages[''].version, '0.0.0-development');
  const generated = require('../../tools/wp1/lib').generatedPackageMetadata(ROOT, releaseSource, 1);
  assert.equal(generated.version, releaseSource.productVersion);
  assert.equal(generated.yanceRelease.publicVersion, releaseSource.publicVersion);
  assert.equal(generated.yanceRelease.executableName, 'Yance.exe');
  assert.equal(generated.yanceRelease.installDirectoryName, 'Yance');
});

test('public UI and desktop shell expose only 言策 / Yance', () => {
  assert.match(html, /<title>言策<\/title>/);
  assert.match(html, /id="titleProductName">言策</);
  assert.match(html, /id="titleProductVersion">1\.0\.0</);
  assert.match(html, /assets\/branding\/yance\/yance-mark-flat\.svg/);
  assert.doesNotMatch(html, /言策29|Yance29|\bY29\b/);
  assert.match(main, /app\.setName\(STATIC_RELEASE_SOURCE\.publicProductName\)/);
  assert.match(main, /app\.setAppUserModelId\(STATIC_RELEASE_SOURCE\.appUserModelId\)/);
  assert.match(main, /title:\s*STATIC_RELEASE_SOURCE\.publicProductName/);
  for (const file of [
    'frontend/r32-system-center.js',
    'frontend/r32-settings-recovery.js',
    'frontend/r32-basic-settings.js',
    'electron/SoundNotificationService.js',
    'backend/services/chatExportService.js'
  ]) assert.doesNotMatch(read(file), /言策29|Yance29|\bY29\b/, `${file} still exposes the legacy brand`);
});

test('installer uses the new identity and retains old names only for migration cleanup', () => {
  assert.match(installer, /Name "\$\{PUBLIC_PRODUCT_NAME\}"/);
  assert.match(installer, /InstallDir "\$LOCALAPPDATA\\\$\{INSTALL_DIRECTORY_NAME\}"/);
  assert.match(installer, /InstallDirRegKey HKCU "Software\\\$\{INTERNAL_PRODUCT_ID\}"/);
  assert.match(installer, /Exec '\"\$INSTDIR\\\$\{PRODUCT_EXECUTABLE_NAME\}\" --post-install'/);
  assert.match(installer, /VIAddVersionKey \/LANG=2052 "ProductName" "\$\{UPDATE_PRODUCT_NAME\}"/);
  assert.match(installer, /VIAddVersionKey \/LANG=2052 "InternalName" "Yance-Setup"/);
  assert.match(installer, /VIAddVersionKey \/LANG=2052 "OriginalFilename" "Yance-Setup\.exe"/);
  assert.match(installer, /"DisplayName" "\$\{PUBLIC_PRODUCT_NAME\}"/);
  assert.match(installer, /"DisplayVersion" "\$\{PUBLIC_VERSION\}"/);
  assert.match(installer, /CreateShortcut "\$DESKTOP\\\$\{PUBLIC_PRODUCT_NAME\}\.lnk"/);
  assert.match(installer, /!define LEGACY_INTERNAL_PRODUCT_ID "Yance29"/);
  assert.match(installer, /Delete "\$DESKTOP\\言策29\.lnk"/);
  assert.doesNotMatch(installer, /StrCpy \$INSTDIR \$2|StrCpy \$INSTDIR \$1/);
  assert.match(installer, /ReadRegStr \$2 HKCU "Software\\\$\{LEGACY_INTERNAL_PRODUCT_ID\}" "InstallLocation"/);
  assert.match(installer, /WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}" "InstallLocation" "\$INSTDIR"/);
  assert.match(installer, /WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}" "EstimatedSize" \$\{ESTIMATED_SIZE_KB\}/);
  assert.match(installer, /DeleteRegKey HKCU "Software\\\$\{LEGACY_INTERNAL_PRODUCT_ID\}"/);
  assert.match(installer, /StrCpy \$3 "\$INSTDIR\.__yance_installing"/);
  assert.match(installer, /StrCpy \$4 "\$INSTDIR\.__yance_previous"/);
  assert.match(installer, /File \/r "\$\{STAGING_ROOT\}\\application-payload\\\*\.\*"/);
  assert.match(installer, /Rename "\$INSTDIR" "\$4"/);
  assert.match(installer, /Rename "\$3" "\$INSTDIR"/);
  assert.match(installer, /transactional_install_rollback_failed:/);
  assert.match(installer, /legacy_custom_install_retained:/);
  assert.doesNotMatch(installer, /RMDir \/r "\$2\\resources/);
  assert.doesNotMatch(installer, /RMDir \/r "\$APPDATA\\(?:Yance|Yance29)/);
  assert.doesNotMatch(installer, /Name "言策29"|OutFile[^\n]*Yance29|CreateShortcut[^\n]*言策29/);
});

test('legacy compatibility is explicit, non-visible and time-bounded', () => {
  const legacy = releaseSource.legacyCompatibility;
  assert.equal(legacy.userVisible, false);
  assert.ok(legacy.productIds.includes('Yance29'));
  assert.ok(legacy.executableNames.includes('Yance29.exe'));
  assert.ok(legacy.dataDirectoryNames.includes('Yance29'));
  assert.equal(legacy.sunsetAfterBrandingEpoch, 3);
  assert.match(legacy.reason, /migration compatibility/i);
});

test('manual installer release source does not emit public auto-update metadata in the active Final Builder path', () => {
  assert.equal(releaseSource.updateMode, 'MANUAL_INSTALLER_ONLY');
  assert.equal(releaseSource.onlineUpdatesEnabled, false);
  assert.equal(releaseSource.formalPublicReleaseAuthorized, false);
  const sourcePackage = JSON.parse(read('package.json'));
  const generated = require('../../tools/wp1/lib').generatedPackageMetadata(ROOT, releaseSource, 1);
  const builderSource = read('tools/wp7/lib.js');
  assert.equal(sourcePackage.version, '0.0.0-development');
  assert.equal(generated.version, releaseSource.productVersion);
  assert.doesNotMatch(builderSource, /const updateMeta = emitUpdateMetadata/);
  assert.doesNotMatch(builderSource, /latestYmlPath: updateMeta/);
  assert.doesNotMatch(builderSource, /blockmapPath: updateMeta/);
});
