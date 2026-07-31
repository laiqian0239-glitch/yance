'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateReleaseManifest, ReleaseManifestSchemaError } = require('./releaseManifestSchema');

class ReleaseIdentityError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'ReleaseIdentityError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseDetachedHash(text) {
  const match = String(text).match(/^([0-9a-f]{64})\s+\*?([^\r\n]+)\r?\n?$/i);
  if (!match) throw new ReleaseIdentityError('BOOT_MANIFEST_HASH_FORMAT_INVALID', 'release manifest detached hash format is invalid');
  return { sha256: match[1].toLowerCase(), fileName: match[2].trim() };
}

function loadReleaseIdentity({ manifestPath, detachedHashPath, expectedBuildId, consumer = 'unknown' }) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_MISSING', 'release manifest is missing', { consumer, manifestPath: manifestPath || null });
  }
  if (!detachedHashPath || !fs.existsSync(detachedHashPath)) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_HASH_MISSING', 'release manifest detached hash is missing', { consumer, detachedHashPath: detachedHashPath || null });
  }
  const parsedHash = parseDetachedHash(fs.readFileSync(detachedHashPath, 'utf8'));
  const actualHash = sha256File(manifestPath);
  if (parsedHash.fileName !== path.basename(manifestPath) || parsedHash.sha256 !== actualHash) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_HASH_MISMATCH', 'release manifest hash verification failed', {
      consumer,
      expectedManifestSha256: parsedHash.sha256,
      actualManifestSha256: actualHash
    });
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { throw new ReleaseIdentityError('BOOT_MANIFEST_SCHEMA_INVALID', 'release manifest JSON is invalid', { consumer, message: error.message }); }
  try { validateReleaseManifest(manifest); }
  catch (error) {
    if (error instanceof ReleaseManifestSchemaError) {
      throw new ReleaseIdentityError(error.reasonCode, error.message, { consumer, ...error.details });
    }
    throw error;
  }
  if (expectedBuildId && manifest.buildId !== expectedBuildId) {
    throw new ReleaseIdentityError('BOOT_BUILD_ID_MISMATCH', 'consumer expected buildId does not match the verified release manifest', {
      consumer,
      expectedBuildId,
      actualBuildId: manifest.buildId
    });
  }
  return Object.freeze({
    consumer,
    buildId: manifest.buildId,
    productName: manifest.productName,
    publicProductName: manifest.publicProductName || manifest.productName,
    publicProductNameEnglish: manifest.publicProductNameEnglish || 'Yance',
    productVersion: manifest.productVersion,
    publicVersion: manifest.publicVersion || manifest.productVersion,
    internalProductId: manifest.internalProductId || 'Yance',
    executableName: manifest.executableName || 'Yance.exe',
    installDirectoryName: manifest.installDirectoryName || 'Yance',
    userDataDirectoryName: manifest.userDataDirectoryName || 'Yance',
    brandingEpoch: Number(manifest.brandingEpoch || 0),
    installerBaseName: manifest.installerBaseName || 'Yance-Setup',
    internalName: manifest.internalName || 'Yance',
    originalFilename: manifest.originalFilename || manifest.executableName || 'Yance.exe',
    appUserModelId: manifest.appUserModelId || 'com.yance.desktop',
    legacyCompatibility: manifest.legacyCompatibility || null,
    releaseChannel: manifest.releaseChannel || null,
    onlineUpdatesEnabled: manifest.onlineUpdatesEnabled === true,
    updateMode: manifest.updateMode || null,
    formalPublicReleaseAuthorized: manifest.formalPublicReleaseAuthorized === true,
    stageVersion: manifest.stageVersion,
    distributionMode: manifest.distributionMode,
    buildTimestampUtc: manifest.buildTimestampUtc,
    gitCommit: manifest.gitCommit,
    sourceCommit: manifest.sourceCommit || manifest.gitCommit,
    sourceTree: manifest.sourceTree,
    applicationPayloadSha256: manifest.applicationPayloadSha256,
    payloadFilesSha256: manifest.payloadFilesSha256,
    manifestSha256: actualHash,
    apiContractVersion: Number(manifest.apiContractVersion || 0),
    credentialProtocolVersion: Number(manifest.credentialProtocolVersion || 0),
    runtimeLockProtocolVersion: Number(manifest.runtimeLockProtocolVersion || 0),
    databaseSchemaVersion: Number(manifest.databaseSchemaVersion || 0),
    artifactClass: manifest.artifactClass || null,
    finalReleaseEvidence: manifest.finalReleaseEvidence === true,
    platformAuthConfigured: manifest.platformAuthConfigured === true,
    platformAuthConfigSha256: manifest.platformAuthConfigSha256 || null,
    platformAuthReleaseManaged: manifest.platformAuthReleaseManaged === true,
    nodeRuntimeVersion: manifest.nodeRuntimeVersion || null,
    nodeRuntimeExecutablePath: manifest.nodeRuntimeExecutablePath || null,
    nodeRuntimeExecutableSha256: manifest.nodeRuntimeExecutableSha256 || null,
    nodeRuntimeTreeSha256: manifest.nodeRuntimeTreeSha256 || null,
    nodeRuntimeFileCount: Number(manifest.nodeRuntimeFileCount || 0),
    nodeRuntimeModeBoundFileCount: Number(manifest.nodeRuntimeModeBoundFileCount || 0),
    electronDistributionTreeSha256: manifest.electronDistributionTreeSha256 || null,
    electronDistributionFileCount: Number(manifest.electronDistributionFileCount),
    electronDistributionModeBoundFileCount: Number(manifest.electronDistributionModeBoundFileCount),
    gitPayloadModeTreeSha256: manifest.gitPayloadModeTreeSha256 || null,
    productionDependencyFileTreeSha256: manifest.productionDependencyFileTreeSha256 || null,
    productionDependencyModeTreeSha256: manifest.productionDependencyModeTreeSha256 || null,
    productionDependencyDirectoryModeTreeSha256: manifest.productionDependencyDirectoryModeTreeSha256 || null,
    applicationPayloadFilesystemIdentitySha256: manifest.applicationPayloadFilesystemIdentitySha256 || null,
    productionDependencyBindingSha256: manifest.productionDependencyBindingSha256 || null,
    productionDependencyPackageGraphSha256: manifest.productionDependencyPackageGraphSha256 || null,
    productionDependencyFileModePolicy: manifest.productionDependencyFileModePolicy || null,
    productionDependencyDirectoryModePolicy: manifest.productionDependencyDirectoryModePolicy || null,
    productionDependencyPackageCount: Number(manifest.productionDependencyPackageCount || 0),
    productionDependencyFileCount: Number(manifest.productionDependencyFileCount || 0),
    productionDependencyModeRecordCount: Number(manifest.productionDependencyModeRecordCount || 0),
    productionDependencyDirectoryCount: Number(manifest.productionDependencyDirectoryCount || 0),
    productionDependencyDirectoryModeRecordCount: Number(manifest.productionDependencyDirectoryModeRecordCount || 0),
    gitPayloadModeRecordCount: Number(manifest.gitPayloadModeRecordCount || 0),
    nativeBinaryScanSha256: manifest.nativeBinaryScanSha256 || null,
    nativeBinaryFileCount: Number(manifest.nativeBinaryFileCount || 0),
    nativeBinaryFailureCount: Number(manifest.nativeBinaryFailureCount || 0),
    nativeBinaryTargetPlatform: manifest.nativeBinaryTargetPlatform || null,
    nativeBinaryTargetArch: manifest.nativeBinaryTargetArch || null
  });
}

function defaultManifestCandidates(options = {}) {
  const candidates = [];
  if (options.manifestPath) candidates.push(path.resolve(options.manifestPath));
  if (process.env.YANCE_RELEASE_MANIFEST_PATH) candidates.push(path.resolve(process.env.YANCE_RELEASE_MANIFEST_PATH));
  if (options.resourcesPath) {
    candidates.push(path.join(path.resolve(options.resourcesPath), 'release-manifest.json'));
    candidates.push(path.join(path.resolve(options.resourcesPath), 'resources', 'release-manifest.json'));
  }
  if (options.appRoot) candidates.push(path.join(path.resolve(options.appRoot), 'resources', 'release-manifest.json'));
  return Array.from(new Set(candidates));
}

function loadInstalledReleaseIdentity(options = {}) {
  const candidates = defaultManifestCandidates(options);
  const manifestPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!manifestPath) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_MISSING', 'no verified installed release manifest candidate exists', {
      consumer: options.consumer || 'unknown',
      candidates
    });
  }
  return loadReleaseIdentity({
    manifestPath,
    detachedHashPath: options.detachedHashPath || path.join(path.dirname(manifestPath), 'release-manifest.sha256'),
    expectedBuildId: options.expectedBuildId,
    consumer: options.consumer || 'unknown'
  });
}

module.exports = { ReleaseIdentityError, loadInstalledReleaseIdentity, loadReleaseIdentity };
