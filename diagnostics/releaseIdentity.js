'use strict';
const { diagnosticsIdentityFromVerified } = require('../shared/release/installedManifestLocator');
function getDiagnosticsReleaseIdentity(options = {}) {
  return diagnosticsIdentityFromVerified(options.releaseIdentity);
}
function diagnosticsBuildIdentity(identity) {
  return {
    buildId: identity.buildId,
    productVersion: identity.productVersion,
    stageVersion: identity.stageVersion,
    manifestSha256: identity.manifestSha256
  };
}
module.exports = { getDiagnosticsReleaseIdentity, diagnosticsBuildIdentity };
