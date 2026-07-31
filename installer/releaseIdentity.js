'use strict';
const { loadLocatedIdentity } = require('../shared/release/installedManifestLocator');
function getInstallerReleaseIdentity(options = {}) {
  return loadLocatedIdentity({
    consumer: 'installer',
    stagingRoot: options.stagingRoot,
    expectedBuildId: options.expectedBuildId
  });
}
function installerBuildIdentity(options = {}) {
  const identity = getInstallerReleaseIdentity(options);
  return { buildId: identity.buildId, productVersion: identity.productVersion, manifestSha256: identity.manifestSha256 };
}
module.exports = { getInstallerReleaseIdentity, installerBuildIdentity };
