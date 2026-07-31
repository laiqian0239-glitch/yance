'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { CREDENTIAL_PROTOCOL_VERSION } = require('../../shared/credentialProtocol');

const STARTUP_PROTOCOL_VERSION = 1;
const STARTUP_FRAME_PROTOCOL_VERSION = 1;
const M1_STARTUP_CONTRACT_VERSION = 1;
const READY_PROTOCOL_VERSION = 1;
const RUNTIME_MODE_DESKTOP_HOSTED = 'desktop-hosted';
const CONTROL_PIPE_FD = 4;
const CREDENTIAL_PIPE_FD = 5;
const CREDENTIAL_CUSTODY_PIPE_FD = 6;
const MAX_STARTUP_FRAME_BYTES = 64 * 1024;

class DesktopStartupProtocolError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'DesktopStartupProtocolError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function createApiSessionToken(randomBytes = crypto.randomBytes) {
  const token = randomBytes(32).toString('base64url');
  if (token.length < 43) {
    throw new DesktopStartupProtocolError('DESKTOP_API_SESSION_TOKEN_GENERATION_FAILED', 'apiSessionToken must contain at least 256 bits of entropy');
  }
  return token;
}

function validateStartupFrame(frame, options = {}) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_FRAME_INVALID', 'startup frame must be an object');
  }
  const requiredStrings = ['startupNonce', 'apiSessionToken', 'resourcesPath', 'expectedBuildId', 'manifestSha256'];
  for (const field of requiredStrings) {
    if (typeof frame[field] !== 'string' || !frame[field]) {
      throw new DesktopStartupProtocolError('DESKTOP_STARTUP_FRAME_INVALID', `${field} is required`, { field });
    }
  }
  if (frame.protocolVersion !== STARTUP_PROTOCOL_VERSION) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_PROTOCOL_MISMATCH', 'unsupported DesktopHost startup protocol', {
      expected: STARTUP_PROTOCOL_VERSION,
      actual: frame.protocolVersion
    });
  }

  if (frame.m1StartupContractVersion !== M1_STARTUP_CONTRACT_VERSION) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_VERSION_MISMATCH', 'unsupported M1 startup runtime contract version', {
      expected: M1_STARTUP_CONTRACT_VERSION,
      actual: frame.m1StartupContractVersion
    });
  }
  for (const field of ['startupAttemptId', 'appRoot', 'backendEntryPath', 'nodeRuntimeExecutablePath', 'backendSessionId', 'fd6PipeInstanceId', 'runtimeMode', 'apiBaseUrl', 'releaseManifestPath', 'releaseManifestSha256Path', 'logRoot', 'backendLogPath']) {
    if (typeof frame[field] !== 'string' || !frame[field]) {
      throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', `${field} is required by the M1 runtime contract`, { field });
    }
  }
  if (frame.startupFrameProtocolVersion !== STARTUP_FRAME_PROTOCOL_VERSION) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'startupFrameProtocolVersion is unsupported', { field: 'startupFrameProtocolVersion', expected: STARTUP_FRAME_PROTOCOL_VERSION, actual: frame.startupFrameProtocolVersion });
  }
  if (frame.readyProtocolVersion !== READY_PROTOCOL_VERSION) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'readyProtocolVersion is unsupported', { field: 'readyProtocolVersion', expected: READY_PROTOCOL_VERSION, actual: frame.readyProtocolVersion });
  }
  if (frame.runtimeMode !== RUNTIME_MODE_DESKTOP_HOSTED) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'runtimeMode must be desktop-hosted', { field: 'runtimeMode', actual: frame.runtimeMode });
  }
  if (frame.nodeModulesPath != null && typeof frame.nodeModulesPath !== 'string') {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'nodeModulesPath must be a string when present', { field: 'nodeModulesPath' });
  }
  if (frame.backendPort != null && (!Number.isInteger(frame.backendPort) || frame.backendPort < 0 || frame.backendPort > 65535)) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'backendPort must be an integer TCP port', { field: 'backendPort' });
  }
  if (frame.readyTimeoutMs != null && (!Number.isInteger(frame.readyTimeoutMs) || frame.readyTimeoutMs < 100)) {
    throw new DesktopStartupProtocolError('M1_RUNTIME_CONTRACT_INVALID', 'readyTimeoutMs must be at least 100ms', { field: 'readyTimeoutMs' });
  }
  if (!Number.isInteger(frame.backendPid) || frame.backendPid < 1) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_PID_INVALID', 'backendPid must be a positive integer');
  }
  if (options.expectedPid && frame.backendPid !== Number(options.expectedPid)) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_PID_MISMATCH', 'startup frame backendPid does not match the receiving process', {
      expectedPid: Number(options.expectedPid),
      actualPid: frame.backendPid
    });
  }
  if (!/^[0-9a-f]{64}$/.test(frame.manifestSha256)) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_MANIFEST_HASH_INVALID', 'manifestSha256 must be lowercase SHA256');
  }
  if (Buffer.byteLength(frame.apiSessionToken, 'utf8') < 32) {
    throw new DesktopStartupProtocolError('DESKTOP_API_SESSION_TOKEN_INVALID', 'apiSessionToken is too short');
  }
  if (frame.credentialProtocolVersion != null || frame.credentialOneTimeToken != null || frame.credentialVaultEpoch != null) {
    if (frame.credentialProtocolVersion !== CREDENTIAL_PROTOCOL_VERSION) {
      throw new DesktopStartupProtocolError('DESKTOP_CREDENTIAL_PROTOCOL_MISMATCH', 'unsupported credential protocol', { expected: CREDENTIAL_PROTOCOL_VERSION, actual: frame.credentialProtocolVersion });
    }
    for (const field of ['credentialOneTimeToken', 'credentialVaultEpoch', 'credentialAuthorityEventId', 'credentialAuthorityHeadDigest']) {
      if (typeof frame[field] !== 'string' || !frame[field]) throw new DesktopStartupProtocolError('DESKTOP_STARTUP_FRAME_INVALID', `${field} is required`, { field });
    }
    const ownerFieldsPresent = Boolean(frame.credentialBackendSessionId || frame.credentialFd6PipeInstanceId);
    if (ownerFieldsPresent) {
      for (const field of ['credentialBackendSessionId', 'credentialFd6PipeInstanceId']) {
        if (typeof frame[field] !== 'string' || !frame[field]) throw new DesktopStartupProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_INVALID', `${field} is required`, { field });
      }
    }
    if (!/^[0-9a-f]{64}$/.test(frame.credentialAuthorityHeadDigest)) throw new DesktopStartupProtocolError('DESKTOP_CREDENTIAL_AUTHORITY_HEAD_INVALID', 'credentialAuthorityHeadDigest must be lowercase SHA256');
    for (const field of ['credentialVaultReferenceCount', 'credentialDecryptedEntryCount', 'credentialFrameEntryCount']) {
      if (!Number.isInteger(frame[field]) || frame[field] < 0) throw new DesktopStartupProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', `${field} must be a non-negative integer`);
    }
    if (frame.credentialVaultReferenceCount !== frame.credentialDecryptedEntryCount || frame.credentialDecryptedEntryCount !== frame.credentialFrameEntryCount) throw new DesktopStartupProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', 'Credential startup reference counts must match');
    if (!Number.isInteger(frame.credentialGeneration) || frame.credentialGeneration < 1) {
      throw new DesktopStartupProtocolError('DESKTOP_CREDENTIAL_GENERATION_INVALID', 'credentialGeneration must be a positive integer');
    }
    if (Buffer.byteLength(frame.credentialOneTimeToken, 'utf8') < 32) {
      throw new DesktopStartupProtocolError('DESKTOP_CREDENTIAL_ONE_TIME_TOKEN_INVALID', 'credentialOneTimeToken is too short');
    }
    if (frame.credentialResetAuthorization != null) {
      const reset = frame.credentialResetAuthorization;
      if (!reset || typeof reset !== 'object' || Array.isArray(reset) || !reset.previousVaultEpoch || reset.nextVaultEpoch !== frame.credentialVaultEpoch || !reset.authorizedAtUtc) {
        throw new DesktopStartupProtocolError('DESKTOP_CREDENTIAL_RESET_AUTHORIZATION_INVALID', 'credential reset authorization is invalid');
      }
    }
  }
  return Object.freeze({ ...frame });
}

function encodeStartupFrame(frame) {
  const validated = validateStartupFrame(frame);
  const encoded = Buffer.from(`${JSON.stringify(validated)}\n`, 'utf8');
  if (encoded.length > MAX_STARTUP_FRAME_BYTES) {
    throw new DesktopStartupProtocolError('DESKTOP_STARTUP_FRAME_TOO_LARGE', 'startup frame exceeds the maximum size', {
      maxBytes: MAX_STARTUP_FRAME_BYTES,
      actualBytes: encoded.length
    });
  }
  return encoded;
}

module.exports = {
  CREDENTIAL_CUSTODY_PIPE_FD,
  CONTROL_PIPE_FD,
  CREDENTIAL_PIPE_FD,
  MAX_STARTUP_FRAME_BYTES,
  STARTUP_PROTOCOL_VERSION,
  STARTUP_FRAME_PROTOCOL_VERSION,
  M1_STARTUP_CONTRACT_VERSION,
  READY_PROTOCOL_VERSION,
  RUNTIME_MODE_DESKTOP_HOSTED,
  DesktopStartupProtocolError,
  createApiSessionToken,
  encodeStartupFrame,
  validateStartupFrame,
  deriveCustodyPipeName
};

// Windows cannot reliably deliver data from a child process to the parent over
// an inherited stdio fd (the custody pipe at CREDENTIAL_CUSTODY_PIPE_FD is the
// only child->parent pipe and it never reaches the parent under child_process
// fork/spawn on Windows). We therefore transport credential custody over an
// explicit net pipe whose name is derived deterministically from the
// fd6PipeInstanceId that both the parent and the child already share. The
// parent opens a net.Server on this name; the child connects to it. This keeps
// the existing stream-based custody protocol intact while avoiding the broken
// stdio inheritance path.
function deriveCustodyPipeName(fd6PipeInstanceId) {
  if (!fd6PipeInstanceId) return '';
  const safe = String(fd6PipeInstanceId).replace(/[^a-zA-Z0-9]/g, '');
  if (process.platform === 'win32') return `\\\\.\\pipe\\yance-custody-${safe}`;
  return path.join(os.tmpdir(), `yance-custody-${safe}.sock`);
}
