'use strict';

const path = require('node:path');
const { getElectronReleaseIdentity } = require('../releaseIdentity');
const { resourceManifestPaths } = require('../../shared/release/installedManifestLocator');

class ReleaseManifestHost {
  constructor(options = {}) {
    if (!options.resourcesPath) {
      const error = new Error('DesktopHost requires a controlled resourcesPath');
      error.reasonCode = 'DESKTOP_RELEASE_RESOURCES_PATH_REQUIRED';
      throw error;
    }
    this.resourcesPath = path.resolve(options.resourcesPath);
    this.loader = options.loader || getElectronReleaseIdentity;
    this.identity = null;
  }

  verify() {
    if (!this.identity) {
      this.identity = this.loader({ resourcesPath: this.resourcesPath, reload: true });
    }
    return this.identity;
  }

  backendStartupConfig() {
    const identity = this.verify();
    const locations = resourceManifestPaths(this.resourcesPath);
    return Object.freeze({
      resourcesPath: this.resourcesPath,
      manifestPath: locations.manifestPath,
      detachedHashPath: locations.detachedHashPath,
      releaseManifestPath: locations.manifestPath,
      releaseManifestSha256Path: locations.detachedHashPath,
      expectedBuildId: identity.buildId,
      manifestSha256: identity.manifestSha256
    });
  }

  snapshot() {
    const identity = this.verify();
    return Object.freeze({
      resourcesPath: this.resourcesPath,
      buildId: identity.buildId,
      manifestSha256: identity.manifestSha256,
      productVersion: identity.productVersion
    });
  }
}

module.exports = { ReleaseManifestHost };
