'use strict';

class ReleaseManifestSchemaError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'ReleaseManifestSchemaError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_COMMIT_RE = /^[0-9a-f]{40}$/;
const GIT_TREE_RE = /^[0-9a-f]{40}$/;
const PRODUCT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const STAGE_VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

function normalizeUtcTimestamp(value) {
  if (typeof value !== 'string' || !value.endsWith('Z')) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'buildTimestampUtc must be an RFC3339 UTC string', { field: 'buildTimestampUtc' });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'buildTimestampUtc must be canonical UTC with millisecond precision', { field: 'buildTimestampUtc', value });
  }
  return value;
}

function expectedBuildId(manifest) {
  const stamp = manifest.buildTimestampUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `YANCE-${manifest.productVersion}-S${manifest.stageVersion}-P1-${manifest.gitCommit.slice(0, 12)}-${stamp}`;
}

function requireString(manifest, field) {
  if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `${field} must be a non-empty string`, { field, actualType: typeof manifest[field] });
  }
}

function requirePositiveInteger(manifest, field) {
  if (!Number.isInteger(manifest[field]) || manifest[field] < 1) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `${field} must be a positive integer`, { field, value: manifest[field] });
  }
}

function validateReleaseManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'release manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 1) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'schemaVersion must equal 1', { field: 'schemaVersion', value: manifest.schemaVersion });
  }
  for (const field of ['buildId', 'productName', 'productVersion', 'stageVersion', 'phase', 'distributionMode', 'gitCommit', 'sourceTree', 'buildTimestampUtc', 'applicationPayloadSha256', 'payloadFilesSha256']) {
    requireString(manifest, field);
  }
  if (!PRODUCT_VERSION_RE.test(manifest.productVersion)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'productVersion is invalid', { field: 'productVersion', value: manifest.productVersion });
  }
  if (manifest.publicVersion !== undefined && !PRODUCT_VERSION_RE.test(manifest.publicVersion)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'publicVersion is invalid', { field: 'publicVersion', value: manifest.publicVersion });
  }
  for (const field of ['publicProductName', 'publicProductNameEnglish', 'internalProductId', 'executableName', 'installDirectoryName', 'userDataDirectoryName', 'installerBaseName', 'internalName', 'originalFilename', 'appUserModelId']) {
    if (manifest[field] !== undefined && (typeof manifest[field] !== 'string' || !manifest[field].trim())) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `${field} is invalid`, { field, value: manifest[field] });
    }
  }
  if (manifest.brandingEpoch !== undefined && (!Number.isInteger(manifest.brandingEpoch) || manifest.brandingEpoch < 1)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'brandingEpoch is invalid', { field: 'brandingEpoch', value: manifest.brandingEpoch });
  }
  if (Number(manifest.brandingEpoch || 0) >= 2) {
    const expectedBrand = {
      productName: '言策', publicProductName: '言策', publicProductNameEnglish: 'Yance',
      internalProductId: 'Yance', executableName: 'Yance.exe', installDirectoryName: 'Yance', userDataDirectoryName: 'Yance',
      installerBaseName: 'Yance-Setup', internalName: 'Yance', originalFilename: 'Yance.exe', appUserModelId: 'com.yance.desktop'
    };
    for (const [field, expected] of Object.entries(expectedBrand)) {
      if (manifest[field] !== expected) throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `${field} does not match the approved Yance identity`, { field, expected, actual: manifest[field] });
    }
    if (manifest.releaseChannel !== 'INTERNAL_TEST_ONLY' || manifest.updateMode !== 'MANUAL_INSTALLER_ONLY' || manifest.onlineUpdatesEnabled !== false || manifest.formalPublicReleaseAuthorized !== false) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'brandingEpoch 2 manifest must remain internal-test-only with manual updates');
    }
    const legacy = manifest.legacyCompatibility;
    if (!legacy || typeof legacy !== 'object' || legacy.userVisible !== false || !Number.isInteger(legacy.sunsetAfterBrandingEpoch) || legacy.sunsetAfterBrandingEpoch <= manifest.brandingEpoch) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'legacyCompatibility must be non-visible and time-bounded', { field: 'legacyCompatibility' });
    }
  }
  if (!STAGE_VERSION_RE.test(manifest.stageVersion)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'stageVersion is invalid', { field: 'stageVersion', value: manifest.stageVersion });
  }
  if (manifest.phase !== 'core-runtime-p1') {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'phase is invalid', { field: 'phase', value: manifest.phase });
  }
  if (manifest.distributionMode !== 'LOCAL_PRIVATE_UNSIGNED') {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'distributionMode is invalid', { field: 'distributionMode', value: manifest.distributionMode });
  }
  if (!GIT_COMMIT_RE.test(manifest.gitCommit)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'gitCommit must be a full lowercase hexadecimal commit', { field: 'gitCommit', value: manifest.gitCommit });
  }
  if (manifest.platformAuthConfigured !== undefined && typeof manifest.platformAuthConfigured !== 'boolean') {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'platformAuthConfigured must be boolean when present', { field: 'platformAuthConfigured', value: manifest.platformAuthConfigured });
  }
  if (manifest.platformAuthReleaseManaged !== undefined && manifest.platformAuthReleaseManaged !== true) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'platformAuthReleaseManaged must equal true when present', { field: 'platformAuthReleaseManaged', value: manifest.platformAuthReleaseManaged });
  }
  if (manifest.platformAuthConfigured !== undefined && manifest.platformAuthReleaseManaged !== true) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'platformAuthReleaseManaged must bind every declared platform auth state', { field: 'platformAuthReleaseManaged', value: manifest.platformAuthReleaseManaged });
  }
  if (manifest.platformAuthConfigured === true && !SHA256_RE.test(String(manifest.platformAuthConfigSha256 || ''))) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'platformAuthConfigSha256 must bind enabled platform release configuration', { field: 'platformAuthConfigSha256', value: manifest.platformAuthConfigSha256 });
  }
  if (manifest.platformAuthConfigured === false && manifest.platformAuthConfigSha256 !== null && manifest.platformAuthConfigSha256 !== undefined) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'disabled platform release configuration must not claim a SHA-256', { field: 'platformAuthConfigSha256', value: manifest.platformAuthConfigSha256 });
  }
  if (manifest.sourceCommit !== undefined) {
    if (!GIT_COMMIT_RE.test(manifest.sourceCommit) || manifest.sourceCommit !== manifest.gitCommit) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'sourceCommit must exactly equal gitCommit when present', { field: 'sourceCommit', gitCommit: manifest.gitCommit, sourceCommit: manifest.sourceCommit });
    }
  }
  if (!GIT_TREE_RE.test(manifest.sourceTree)) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'sourceTree must be a full lowercase hexadecimal tree', { field: 'sourceTree', value: manifest.sourceTree });
  }
  normalizeUtcTimestamp(manifest.buildTimestampUtc);
  for (const field of ['applicationPayloadSha256', 'payloadFilesSha256']) {
    if (!SHA256_RE.test(manifest[field])) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `${field} must be a lowercase 64-character SHA256`, { field, value: manifest[field] });
    }
  }

  // WP7 carries a richer release-identity closure (dependency tree, Git mode tree,
  // Electron distribution tree and trusted Node runtime). These fields are absent
  // from the WP1 manifest, so only enforce them when the manifest is a WP7 manifest.
  const WP7_TREE_SHA_FIELDS = [
    'applicationPayloadFilesystemIdentitySha256',
    'productionDependencyBindingSha256',
    'productionDependencyPackageGraphSha256',
    'productionDependencyFileTreeSha256',
    'productionDependencyModeTreeSha256',
    'productionDependencyDirectoryModeTreeSha256',
    'gitPayloadModeTreeSha256',
    'electronDistributionTreeSha256',
    'nodeRuntimeExecutableSha256',
    'nodeRuntimeTreeSha256',
    'nativeBinaryScanSha256'
  ];
  const isWp7Manifest = WP7_TREE_SHA_FIELDS.some((field) => manifest[field] !== undefined);
  if (isWp7Manifest) {
    for (const field of WP7_TREE_SHA_FIELDS) {
      if (!SHA256_RE.test(String(manifest[field] || ''))) {
        throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `WP7 identity field ${field} must be a lowercase 64-character SHA256`, { field, value: manifest[field] });
      }
    }
    for (const field of ['productionDependencyPackageCount', 'productionDependencyFileCount', 'productionDependencyModeRecordCount', 'productionDependencyDirectoryCount', 'productionDependencyDirectoryModeRecordCount', 'gitPayloadModeRecordCount', 'electronDistributionFileCount', 'electronDistributionModeBoundFileCount', 'nodeRuntimeFileCount', 'nativeBinaryFileCount', 'nativeBinaryFailureCount']) {
      if (!Number.isInteger(manifest[field]) || manifest[field] < 0) {
        throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', `WP7 count field ${field} must be a non-negative integer`, { field, value: manifest[field] });
      }
    }

    if (manifest.nativeBinaryFailureCount !== 0) {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 nativeBinaryFailureCount must equal zero for a releasable payload', { field: 'nativeBinaryFailureCount', value: manifest.nativeBinaryFailureCount });
    }
    if (!['linux', 'win32'].includes(manifest.nativeBinaryTargetPlatform) || manifest.nativeBinaryTargetArch !== 'x64') {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 native binary scan must bind a supported x64 release target', { nativeBinaryTargetPlatform: manifest.nativeBinaryTargetPlatform, nativeBinaryTargetArch: manifest.nativeBinaryTargetArch });
    }
  }

    for (const field of ['appRoot', 'backendEntryPath', 'nodeModulesPath', 'nodeRuntimeExecutablePath', 'nodeRuntimeVersion']) {
      if (manifest[field] !== undefined) requireString(manifest, field);
    }
    if (manifest.appRoot !== undefined && manifest.appRoot !== 'app') {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 appRoot must bind resources/app layout', { field: 'appRoot', value: manifest.appRoot });
    }
    if (manifest.backendEntryPath !== undefined && manifest.backendEntryPath !== 'app/backend/desktopHostedEntry.js') {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 backendEntryPath must bind resources/app backend entry', { field: 'backendEntryPath', value: manifest.backendEntryPath });
    }
    if (manifest.nodeModulesPath !== undefined && manifest.nodeModulesPath !== 'app/node_modules') {
      throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 nodeModulesPath must bind resources/app/node_modules', { field: 'nodeModulesPath', value: manifest.nodeModulesPath });
    }
    if (manifest.nodeRuntimeExecutablePath !== undefined) {
      const expectedNodeRuntimePath = manifest.nativeBinaryTargetPlatform === 'win32'
        ? 'runtime/node22/node.exe'
        : 'runtime/node22/node';
      if (manifest.nodeRuntimeExecutablePath !== expectedNodeRuntimePath) {
        throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'WP7 nodeRuntimeExecutablePath must match the canonical M6 release layout', { field: 'nodeRuntimeExecutablePath', expected: expectedNodeRuntimePath, value: manifest.nodeRuntimeExecutablePath });
      }
    }

  for (const field of ['apiContractVersion', 'credentialProtocolVersion', 'runtimeLockProtocolVersion', 'databaseSchemaVersion']) {
    requirePositiveInteger(manifest, field);
  }
  const expected = expectedBuildId(manifest);
  if (manifest.buildId !== expected) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'buildId does not match productVersion, stageVersion, gitCommit, and buildTimestampUtc', {
      field: 'buildId', expectedBuildId: expected, actualBuildId: manifest.buildId
    });
  }
  if (options.expectedProductVersion && manifest.productVersion !== options.expectedProductVersion) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'productVersion does not match expected release source', { expected: options.expectedProductVersion, actual: manifest.productVersion });
  }
  if (options.expectedStageVersion && manifest.stageVersion !== options.expectedStageVersion) {
    throw new ReleaseManifestSchemaError('BOOT_MANIFEST_SCHEMA_INVALID', 'stageVersion does not match expected release source', { expected: options.expectedStageVersion, actual: manifest.stageVersion });
  }
  return manifest;
}

module.exports = {
  ReleaseManifestSchemaError,
  expectedBuildId,
  normalizeUtcTimestamp,
  validateReleaseManifest
};
