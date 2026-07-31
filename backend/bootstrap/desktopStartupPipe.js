'use strict';

const fs = require('node:fs');
const {
  CONTROL_PIPE_FD,
  MAX_STARTUP_FRAME_BYTES,
  validateStartupFrame
} = require('../../electron/desktopHost/startupProtocol');
const { configureBackendReleaseStartup, getBackendReleaseIdentity } = require('../releaseIdentity');
const { configureDesktopStartupContext } = require('./desktopStartupContext');

class BackendStartupPipeError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'BackendStartupPipeError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function readStartupFrame(options = {}) {
  const fd = Number.isInteger(options.fd) ? options.fd : CONTROL_PIPE_FD;
  const timeoutMs = Math.max(100, Number(options.timeoutMs || 10000));
  const expectedPid = Number(options.expectedPid || process.pid);
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let text = '';
    let settled = false;
    const stream = fs.createReadStream(null, { fd, autoClose: false, encoding: 'utf8' });
    const timer = setTimeout(() => finish(new BackendStartupPipeError('BOOT_DESKTOP_STARTUP_TIMEOUT', 'Timed out waiting for DesktopHost startup frame')), timeoutMs);
    const finish = (error, frame) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners();
      try { stream.destroy(); } catch (_) {}
      if (error) reject(error); else resolve(frame);
    };
    stream.on('data', chunk => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_STARTUP_FRAME_BYTES) {
        finish(new BackendStartupPipeError('BOOT_DESKTOP_STARTUP_FRAME_TOO_LARGE', 'DesktopHost startup frame exceeds maximum size'));
        return;
      }
      text += chunk;
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      let parsed;
      try { parsed = JSON.parse(text.slice(0, newline)); }
      catch (error) { finish(new BackendStartupPipeError('BOOT_DESKTOP_STARTUP_FRAME_INVALID', 'DesktopHost startup frame is not valid JSON')); return; }
      try { finish(null, validateStartupFrame(parsed, { expectedPid })); }
      catch (error) { finish(error); }
    });
    stream.on('error', error => finish(new BackendStartupPipeError('BOOT_DESKTOP_STARTUP_PIPE_FAILED', error.message, { code: error.code || '' })));
    stream.on('end', () => {
      if (!settled) finish(new BackendStartupPipeError('BOOT_DESKTOP_STARTUP_FRAME_INCOMPLETE', 'DesktopHost startup pipe closed before a complete frame was received'));
    });
  });
}

function configureBackendFromDesktopFrame(frame) {
  const validated = validateStartupFrame(frame, { expectedPid: process.pid });
  configureBackendReleaseStartup({ resourcesPath: validated.resourcesPath });
  const identity = getBackendReleaseIdentity({ expectedBuildId: validated.expectedBuildId, reload: true });
  if (identity.manifestSha256 !== validated.manifestSha256) {
    throw new BackendStartupPipeError('BOOT_MANIFEST_HASH_MISMATCH', 'DesktopHost manifest SHA256 does not match backend verified identity', {
      expectedManifestSha256: validated.manifestSha256,
      actualManifestSha256: identity.manifestSha256
    });
  }
  return configureDesktopStartupContext({
    protocolVersion: validated.protocolVersion,
    startupFrameProtocolVersion: validated.startupFrameProtocolVersion,
    m1StartupContractVersion: validated.m1StartupContractVersion,
    readyProtocolVersion: validated.readyProtocolVersion,
    startupAttemptId: validated.startupAttemptId,
    startupNonce: validated.startupNonce,
    apiSessionToken: validated.apiSessionToken,
    backendPid: validated.backendPid,
    resourcesPath: validated.resourcesPath,
    buildId: identity.buildId,
    manifestSha256: identity.manifestSha256,
    releaseManifestPath: validated.releaseManifestPath,
    releaseManifestSha256Path: validated.releaseManifestSha256Path,
    releaseIdentity: identity,
    appRoot: validated.appRoot,
    backendEntryPath: validated.backendEntryPath,
    nodeRuntimeExecutablePath: validated.nodeRuntimeExecutablePath,
    nodeModulesPath: validated.nodeModulesPath || '',
    runtimeMode: validated.runtimeMode,
    backendSessionId: validated.backendSessionId || validated.credentialBackendSessionId || '',
    fd6PipeInstanceId: validated.fd6PipeInstanceId || validated.credentialFd6PipeInstanceId || '',
    backendPort: Number(validated.backendPort || 0),
    apiBaseUrl: validated.apiBaseUrl,
    readyTimeoutMs: Number(validated.readyTimeoutMs || 0),
    launchTimeoutMs: Number(validated.launchTimeoutMs || 0),
    stopTimeoutMs: Number(validated.stopTimeoutMs || 0),
    dataDir: validated.dataDir || '',
    logPath: validated.logPath || '',
    logRoot: validated.logRoot || '',
    desktopLogPath: validated.desktopLogPath || '',
    backendLogPath: validated.backendLogPath || '',
    credentialProtocolVersion: validated.credentialProtocolVersion || null,
    credentialOneTimeToken: validated.credentialOneTimeToken || '',
    credentialVaultEpoch: validated.credentialVaultEpoch || '',
    credentialGeneration: Number(validated.credentialGeneration || 0),
    credentialAuthorityEventId: validated.credentialAuthorityEventId || '',
    credentialAuthorityHeadDigest: validated.credentialAuthorityHeadDigest || '',
    credentialVaultReferenceCount: Number(validated.credentialVaultReferenceCount || 0),
    credentialDecryptedEntryCount: Number(validated.credentialDecryptedEntryCount || 0),
    credentialFrameEntryCount: Number(validated.credentialFrameEntryCount || 0),
    credentialResetAuthorization: validated.credentialResetAuthorization || null
  });
}

module.exports = { BackendStartupPipeError, configureBackendFromDesktopFrame, readStartupFrame };
