'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function write(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, value); }
function validManifest(overrides = {}) {
  const productVersion = overrides.productVersion || '29.2.5';
  const stageVersion = overrides.stageVersion || '6.4.5.9';
  const gitCommit = overrides.gitCommit || 'a'.repeat(40);
  const buildTimestampUtc = overrides.buildTimestampUtc || '2026-07-03T00:00:00.000Z';
  const stamp = buildTimestampUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return {
    schemaVersion: 1,
    artifactClass: 'PIPELINE_TEST_ONLY',
    finalReleaseEvidence: false,
    buildId: `YANCE-${productVersion}-S${stageVersion}-P1-${gitCommit.slice(0, 12)}-${stamp}`,
    productName: '言策',
    publicProductName: '言策',
    publicProductNameEnglish: 'Yance',
    publicVersion: '1.0.0',
    internalProductId: 'Yance',
    executableName: 'Yance.exe',
    installDirectoryName: 'Yance',
    userDataDirectoryName: 'Yance',
    brandingEpoch: 2,
    installerBaseName: 'Yance-Setup',
    internalName: 'Yance',
    originalFilename: 'Yance.exe',
    appUserModelId: 'com.yance.desktop',
    legacyCompatibility: {
      productIds: ['legacy-product'], executableNames: ['legacy.exe'], dataDirectoryNames: ['legacy-data'],
      registryKeys: ['Software\\legacy'], runtimeMutexPrefixes: ['Local\\legacy.'],
      reason: 'test fixture', userVisible: false, sunsetAfterBrandingEpoch: 3
    },
    releaseChannel: 'INTERNAL_TEST_ONLY',
    onlineUpdatesEnabled: false,
    updateMode: 'MANUAL_INSTALLER_ONLY',
    formalPublicReleaseAuthorized: false,
    productVersion,
    stageVersion,
    phase: 'core-runtime-p1',
    distributionMode: 'LOCAL_PRIVATE_UNSIGNED',
    gitCommit,
    sourceCommit: gitCommit,
    sourceTree: 'b'.repeat(40),
    buildTimestampUtc,
    applicationPayloadSha256: 'c'.repeat(64),
    payloadFilesSha256: 'd'.repeat(64),
    apiContractVersion: 2,
    credentialProtocolVersion: 2,
    runtimeLockProtocolVersion: 1,
    databaseSchemaVersion: 9,
    ...overrides
  };
}
module.exports = { tempDir, validManifest, write };
