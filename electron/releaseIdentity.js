'use strict';
const { loadLocatedIdentity } = require('../shared/release/installedManifestLocator');
let cached = null;
function getElectronReleaseIdentity(options = {}) {
  if (!cached || options.reload || options.resourcesPath || options.expectedBuildId) {
    cached = loadLocatedIdentity({
      consumer: 'electron',
      resourcesPath: options.resourcesPath,
      expectedBuildId: options.expectedBuildId
    });
  }
  return cached;
}
module.exports = { getElectronReleaseIdentity };
