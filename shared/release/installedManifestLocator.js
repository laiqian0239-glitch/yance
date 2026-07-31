'use strict';

const path = require('node:path');
const { loadReleaseIdentity, ReleaseIdentityError } = require('./releaseIdentity');

function resourceManifestPaths(resourcesPath) {
  if (!resourcesPath) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_LOCATION_INVALID', 'resourcesPath is required for installed manifest location');
  }
  const root = path.resolve(resourcesPath);
  return {
    resourcesPath: root,
    manifestPath: path.join(root, 'release-manifest.json'),
    detachedHashPath: path.join(root, 'release-manifest.sha256')
  };
}

function locateInstalledManifest(options = {}) {
  const consumer = options.consumer || 'unknown';
  if (consumer === 'electron') {
    return resourceManifestPaths(options.resourcesPath || process.resourcesPath);
  }
  if (consumer === 'backend') {
    const startupConfig = options.startupConfig;
    if (!startupConfig || typeof startupConfig !== 'object' || !startupConfig.resourcesPath) {
      throw new ReleaseIdentityError('BOOT_MANIFEST_LOCATION_INVALID', 'backend requires DesktopHost-controlled startupConfig.resourcesPath', { consumer });
    }
    return resourceManifestPaths(startupConfig.resourcesPath);
  }
  if (consumer === 'installer') {
    if (!options.stagingRoot) {
      throw new ReleaseIdentityError('BOOT_MANIFEST_LOCATION_INVALID', 'installer packaging requires stagingRoot', { consumer });
    }
    return resourceManifestPaths(path.join(path.resolve(options.stagingRoot), 'resources'));
  }
  throw new ReleaseIdentityError('BOOT_MANIFEST_LOCATION_INVALID', 'unsupported installed manifest consumer', { consumer });
}

function loadLocatedIdentity(options = {}) {
  const locations = locateInstalledManifest(options);
  return loadReleaseIdentity({
    manifestPath: locations.manifestPath,
    detachedHashPath: locations.detachedHashPath,
    expectedBuildId: options.expectedBuildId,
    consumer: options.consumer
  });
}

function diagnosticsIdentityFromVerified(releaseIdentity) {
  if (!releaseIdentity || typeof releaseIdentity !== 'object' || !releaseIdentity.buildId || !releaseIdentity.manifestSha256) {
    throw new ReleaseIdentityError('BOOT_MANIFEST_LOCATION_INVALID', 'diagnostics requires an already verified ReleaseIdentity');
  }
  return Object.freeze({ ...releaseIdentity, consumer: 'diagnostics' });
}

function assertSameInstalledReleaseIdentity(identities) {
  if (!Array.isArray(identities) || identities.length < 2) {
    throw new ReleaseIdentityError('BOOT_BUILD_ID_MISMATCH', 'at least two consumer identities are required');
  }
  const first = identities[0];
  const mismatches = identities.filter(identity => identity.buildId !== first.buildId || identity.manifestSha256 !== first.manifestSha256);
  if (mismatches.length) {
    throw new ReleaseIdentityError('BOOT_BUILD_ID_MISMATCH', 'installed consumers do not share the same verified release manifest', {
      consumers: identities.map(identity => ({ consumer: identity.consumer, buildId: identity.buildId, manifestSha256: identity.manifestSha256 }))
    });
  }
  return true;
}

module.exports = {
  assertSameInstalledReleaseIdentity,
  diagnosticsIdentityFromVerified,
  loadLocatedIdentity,
  locateInstalledManifest,
  resourceManifestPaths
};
