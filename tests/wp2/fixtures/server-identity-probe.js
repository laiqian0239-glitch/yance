'use strict';
const { getBackendReleaseIdentity } = require('../../../backend/releaseIdentity');
const { getDesktopStartupContext } = require('../../../backend/bootstrap/desktopStartupContext');
const identity = getBackendReleaseIdentity();
const context = getDesktopStartupContext();
function sendAndExit(message) {
  if (!process.send) process.exit(0);
  process.send(message, error => process.exit(error ? 1 : 0));
}

sendAndExit({
  type: 'probe:server-identity',
  buildId: identity.buildId,
  manifestSha256: identity.manifestSha256,
  startupNonce: context.startupNonce,
  pidMatches: context.backendPid === process.pid,
  apiSessionEstablished: typeof context.apiSessionToken === 'string' && context.apiSessionToken.length >= 43,
  runtimeContract: {
    startupAttemptId: context.startupAttemptId,
    m1StartupContractVersion: context.m1StartupContractVersion,
    startupFrameProtocolVersion: context.startupFrameProtocolVersion,
    readyProtocolVersion: context.readyProtocolVersion,
    runtimeMode: context.runtimeMode,
    appRoot: context.appRoot,
    backendEntryPath: context.backendEntryPath,
    nodeRuntimeExecutablePath: context.nodeRuntimeExecutablePath,
    apiBaseUrl: context.apiBaseUrl,
    releaseManifestPath: context.releaseManifestPath,
    releaseManifestSha256Path: context.releaseManifestSha256Path,
    backendLogPath: context.backendLogPath,
    nodeModulesPath: context.nodeModulesPath,
    backendSessionId: context.backendSessionId,
    fd6PipeInstanceId: context.fd6PipeInstanceId,
    backendPort: context.backendPort,
    readyTimeoutMs: context.readyTimeoutMs
  }
});
