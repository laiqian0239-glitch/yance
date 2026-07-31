'use strict';
const { loadLocatedIdentity } = require('../shared/release/installedManifestLocator');
const { configureSharedReleaseIdentity } = require('../shared/constants');
let cached = null;
let configuredStartup = null;
function configureBackendReleaseStartup(startupConfig) {
  configuredStartup = Object.freeze({ ...(startupConfig || {}) });
  cached = null;
}
function getBackendReleaseIdentity(options = {}) {
  const startupConfig = options.startupConfig || configuredStartup;
  if (!cached || options.reload || options.startupConfig || options.expectedBuildId) {
    cached = loadLocatedIdentity({
      consumer: 'backend',
      startupConfig,
      expectedBuildId: options.expectedBuildId
    });
    configureSharedReleaseIdentity(cached);
  }
  return cached;
}
module.exports = { configureBackendReleaseStartup, getBackendReleaseIdentity };
