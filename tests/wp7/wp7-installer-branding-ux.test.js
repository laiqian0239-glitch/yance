'use strict';

// Brand/installer regression gate. New visible identity is always 言策 / Yance;
// explicit old-name matches are allowed only for one-cycle migration cleanup.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NSIS = path.join(REPO_ROOT, 'installer', 'wp7', 'YanceFinalInstaller.nsi');
const RELEASE_SOURCE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'release', 'release-source.json'), 'utf8'));
const APPROVED = {
  productName: '言策',
  publicProductName: '言策',
  publicVersion: '1.0.0',
  internalProductId: 'Yance',
  executableName: 'Yance.exe',
  installDirectoryName: 'Yance',
  companyName: '言策科技',
  legalCopyright: '© 2026 言策科技 保留所有权利',
  fileVersion: `${RELEASE_SOURCE.productVersion}.0`,
  productVersion: RELEASE_SOURCE.productVersion
};

function nsis() { return fs.readFileSync(NSIS, 'utf8'); }

test('1. NSIS script uses Chinese UI, directory selection, and Yance icon', () => {
  const t = nsis();
  assert.match(t, /!insertmacro\s+MUI_LANGUAGE\s+"SimpChinese"/i);
  assert.match(t, /!include\s+"MUI2\.nsh"/i);
  assert.match(t, /!insertmacro\s+MUI_PAGE_DIRECTORY/i);
  assert.match(t, /!define MUI_ICON "\$\{STAGING_ROOT\}\\application-payload\\resources\\app\\frontend\\assets\\icon\.ico"/i);
});

test('2. new desktop and start-menu shortcuts are created and removed consistently', () => {
  const t = nsis();
  assert.match(t, /CreateShortcut\s+"\$DESKTOP\\\$\{PUBLIC_PRODUCT_NAME\}\.lnk"/i);
  assert.match(t, /CreateShortcut\s+"\$SMPROGRAMS\\\$\{PUBLIC_PRODUCT_NAME\}\\\$\{PUBLIC_PRODUCT_NAME\}\.lnk"/i);
  assert.match(t, /Delete\s+"\$DESKTOP\\\$\{PUBLIC_PRODUCT_NAME\}\.lnk"/i);
  assert.match(t, /Delete\s+"\$SMPROGRAMS\\\$\{PUBLIC_PRODUCT_NAME\}\\\$\{PUBLIC_PRODUCT_NAME\}\.lnk"/i);
  assert.doesNotMatch(t, /CreateShortcut[^\n]*(?:言策29|Yance29)/i);
});

test('3. old visible shortcuts are cleanup-only and never created', () => {
  const t = nsis();
  assert.match(t, /!define\s+LEGACY_INTERNAL_PRODUCT_ID\s+"Yance29"/i);
  assert.match(t, /!define\s+LEGACY_EXECUTABLE_NAME\s+"Yance29\.exe"/i);
  assert.match(t, /Delete\s+"\$DESKTOP\\言策29\.lnk"/i);
  assert.match(t, /Delete\s+"\$SMPROGRAMS\\言策29\\言策29\.lnk"/i);
  assert.doesNotMatch(t, /Name\s+"言策29"|FileDescription"\s+"言策29|DisplayName"\s+"言策29/i);
});

test('4. installer VERSIONINFO is the approved Yance identity', () => {
  const t = nsis();
  assert.match(t, /VIProductVersion\s+"\$\{PRODUCT_VERSION_FILE\}"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"ProductName"\s+"\$\{UPDATE_PRODUCT_NAME\}"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"FileDescription"\s+"\$\{PUBLIC_PRODUCT_NAME\} 安装程序"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"InternalName"\s+"Yance-Setup"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"OriginalFilename"\s+"Yance-Setup\.exe"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"CompanyName"\s+"言策科技"/i);
  assert.match(t, /VIAddVersionKey\s*\/LANG=2052\s+"LegalCopyright"\s+"© 2026 言策科技 保留所有权利"/i);
  assert.match(t, /!define\s+PRODUCT_VERSION_FILE\s+"\$\{PRODUCT_VERSION\}\.0"/i);
  assert.doesNotMatch(t, /!define\s+PRODUCT_VERSION\s+"\d+\.\d+\.\d+"/i);
});

test('5. Apps & Features and install-location keys use the new internal identity', () => {
  const t = nsis();
  assert.match(t, /WriteRegStr\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}"\s+"DisplayIcon"/i);
  assert.match(t, /WriteRegStr\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}"\s+"Publisher"\s+"言策科技"/i);
  assert.match(t, /WriteRegStr\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}"\s+"DisplayName"\s+"\$\{PUBLIC_PRODUCT_NAME\}"/i);
  assert.match(t, /WriteRegStr\s+HKCU\s+"Software\\\$\{INTERNAL_PRODUCT_ID\}"\s+"InstallLocation"\s+"\$INSTDIR"/i);
  assert.match(t, /WriteRegStr\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}"\s+"InstallLocation"\s+"\$INSTDIR"/i);
  assert.match(t, /WriteRegDWORD\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{INTERNAL_PRODUCT_ID\}"\s+"EstimatedSize"\s+\$\{ESTIMATED_SIZE_KB\}/i);
  assert.match(t, /DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{LEGACY_INTERNAL_PRODUCT_ID\}"/i);
  assert.match(t, /DeleteRegKey HKCU "Software\\\$\{LEGACY_INTERNAL_PRODUCT_ID\}"/i);
  assert.doesNotMatch(t, /StrCpy\s+\$INSTDIR\s+\$[12]/i);
  assert.doesNotMatch(t, /RMDir\s+\/r\s+"\$APPDATA\\(?:Yance|Yance29)/i);
});

test('6. installer stages and validates the complete payload before replacing an existing Yance install', () => {
  const t = nsis();
  assert.match(t, /StrCpy\s+\$3\s+"\$INSTDIR\.__yance_installing"/i);
  assert.match(t, /StrCpy\s+\$4\s+"\$INSTDIR\.__yance_previous"/i);
  assert.match(t, /File\s+\/r\s+"\$\{STAGING_ROOT\}\\application-payload\\\*\.\*"/i);
  assert.match(t, /WriteUninstaller\s+"\$3\\Uninstall\.exe"/i);
  assert.match(t, /SetOutPath\s+"\$TEMP"[\s\S]*Rename\s+"\$3"\s+"\$INSTDIR"/i, 'installer must leave the staging directory before promoting it');
  assert.match(t, /SetOutPath\s+"\$INSTDIR"[\s\S]*CreateShortcut\s+"\$SMPROGRAMS/i, 'installed shortcuts must use the application directory as their working directory');
  assert.match(t, /Rename\s+"\$INSTDIR"\s+"\$4"/i);
  assert.match(t, /Rename\s+"\$3"\s+"\$INSTDIR"/i);
  assert.match(t, /transactional_install_metadata_failed:/i);
  assert.match(t, /transactional_install_rollback_failed:/i);
  assert.match(t, /现有版本未被修改|已恢复现有版本/);
  assert.match(t, /legacy_custom_install_retained:/i);
  assert.doesNotMatch(t, /RMDir\s+\/r\s+"\$2\\resources/i, 'untrusted legacy custom paths must never be recursively deleted');
  assert.doesNotMatch(t, /Delete\s+"\$2\\(?:Yance29\.exe|Uninstall\.exe)"/i, 'custom legacy paths must be retained for manual review');
  assert.doesNotMatch(t, /RMDir\s+\/r\s+"\$INSTDIR\\resources\\app"/i);
});

test('7. release source carries the complete approved identity and internal-test policy', () => {
  assert.equal(RELEASE_SOURCE.productName, APPROVED.productName);
  assert.equal(RELEASE_SOURCE.publicProductName, APPROVED.publicProductName);
  assert.equal(RELEASE_SOURCE.publicVersion, APPROVED.publicVersion);
  assert.equal(RELEASE_SOURCE.internalProductId, APPROVED.internalProductId);
  assert.equal(RELEASE_SOURCE.executableName, APPROVED.executableName);
  assert.equal(RELEASE_SOURCE.installDirectoryName, APPROVED.installDirectoryName);
  assert.equal(RELEASE_SOURCE.internalName, 'Yance');
  assert.equal(RELEASE_SOURCE.originalFilename, 'Yance.exe');
  assert.equal(RELEASE_SOURCE.companyName, APPROVED.companyName);
  assert.equal(RELEASE_SOURCE.legalCopyright, APPROVED.legalCopyright);
  assert.equal(RELEASE_SOURCE.onlineUpdatesEnabled, false);
  assert.equal(RELEASE_SOURCE.formalPublicReleaseAuthorized, false);
});

test('8. built Yance.exe branding passes when a Windows artifact is supplied', () => {
  const exe = process.env.WP7_BRANDING_EXE;
  if (!exe || !fs.existsSync(exe)) return;
  const { assertBranding } = require('../../tools/wp7/pe-resource-editor');
  const iconPath = path.join(REPO_ROOT, 'assets', 'branding', 'yance', 'generated', 'Yance.ico');
  const res = assertBranding({ exePath: exe, iconPath, releaseSource: RELEASE_SOURCE });
  assert.equal(res.status, 'PASS');
  assert.equal(res.versionInfo.ProductName, '言策');
  assert.equal(res.versionInfo.InternalName, 'Yance');
  assert.equal(res.versionInfo.OriginalFilename, 'Yance.exe');
  assert.equal(res.versionInfo.CompanyName, APPROVED.companyName);
  assert.equal(res.groupIconSha256, res.approvedIconSha256);
});

test('9. non-Windows branding fixture remains explicitly review-only and carries only the reviewed frontend catalog file', () => {
  const os = require('node:os');
  const { assembleWindowsApplication, createReviewFixtureBrandingOptions } = require('../../tools/wp7/lib');
  const { createFakeElectronDist, productionDependencyFixture, createFakeRceditRunner } = require('./helpers');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-branding-fixture-'));
  try {
    const electronDist = createFakeElectronDist(root, 'win32');
    const common = {
      repoRoot: REPO_ROOT,
      electronDist,
      productionNodeModulesSource: productionDependencyFixture(REPO_ROOT, 'win32'),
      installProductionDependencies: false,
      targetPlatform: 'win32',
      targetArch: 'x64',
      trustedNodeExecutable: process.execPath
    };
    const authorizedFixture = createReviewFixtureBrandingOptions(createFakeRceditRunner());
    assert.throws(() => assembleWindowsApplication({ ...common, ...authorizedFixture, payloadRoot: path.join(root, 'formal-payload'), allowNonWindows: false }), error => error.reasonCode === 'WP7_REVIEW_FIXTURE_BRANDING_NOT_AUTHORIZED');
    assert.throws(() => assembleWindowsApplication({ ...common, ['testRceditRunner']: createFakeRceditRunner(), payloadRoot: path.join(root, 'unauthorized-review-payload'), allowNonWindows: true }), error => error.reasonCode === 'WP7_REVIEW_FIXTURE_BRANDING_NOT_AUTHORIZED');
    const review = assembleWindowsApplication({ ...common, ...authorizedFixture, payloadRoot: path.join(root, 'review-payload'), allowNonWindows: true });
    assert.equal(review.status, 'PASS');
    assert.ok(fs.existsSync(path.join(review.payloadRoot, 'Yance.exe')));
    const packagedFrontendRoot = path.join(review.appRoot, 'frontend');
    const packagedThemeCatalog = path.join(packagedFrontendRoot, 'theme-catalog.json');
    assert.ok(fs.existsSync(packagedThemeCatalog));
    assert.deepEqual(JSON.parse(fs.readFileSync(packagedThemeCatalog, 'utf8')), JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'theme-catalog.json'), 'utf8')));
    assert.deepEqual(fs.readdirSync(packagedFrontendRoot).sort(), ['theme-catalog.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
