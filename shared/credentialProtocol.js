'use strict';

const crypto = require('node:crypto');

const CREDENTIAL_PROTOCOL_VERSION = 3;
const MAX_CREDENTIAL_FRAME_BYTES = 262144;
const CREDENTIAL_HYDRATION_TIMEOUT_MS = 10000;
const MAX_ISSUED_AGE_MS = 60000;

class CredentialProtocolError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message || reasonCode);
    this.name = 'CredentialProtocolError';
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    this.details = details;
    this.failedPhase = 'credential_hydration';
  }
}

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function secretPayloadBytes(payload) { return Buffer.byteLength(JSON.stringify(payload || { entries: [] }), 'utf8'); }
function createCredentialOneTimeToken(randomBytes = crypto.randomBytes) {
  const value = randomBytes(32).toString('base64url');
  if (value.length < 43) throw new CredentialProtocolError('CREDENTIAL_ONE_TIME_TOKEN_GENERATION_FAILED', 'Credential token must contain at least 256 bits of entropy');
  return value;
}

function validateCredentialFrame(frame, options = {}) {
  if (!isObject(frame)) throw new CredentialProtocolError('CREDENTIAL_FRAME_INVALID', 'Credential frame must be an object');
  const strings = ['startupNonce', 'oneTimeToken', 'manifestSha256', 'vaultEpoch', 'authorityEventId', 'authorityHeadDigest', 'issuedAtUtc'];
  for (const field of strings) {
    if (typeof frame[field] !== 'string' || !frame[field]) throw new CredentialProtocolError('CREDENTIAL_FRAME_INVALID', `${field} is required`, { field });
  }
  if (frame.type !== 'credential_snapshot') throw new CredentialProtocolError('CREDENTIAL_FRAME_TYPE_INVALID', 'Credential frame type is invalid');
  if (frame.protocolVersion !== CREDENTIAL_PROTOCOL_VERSION) {
    throw new CredentialProtocolError('CREDENTIAL_PROTOCOL_VERSION_MISMATCH', 'Credential protocol version mismatch', { expected: CREDENTIAL_PROTOCOL_VERSION, actual: frame.protocolVersion });
  }
  if (!Number.isInteger(frame.backendPid) || frame.backendPid < 1) throw new CredentialProtocolError('CREDENTIAL_BACKEND_PID_INVALID', 'backendPid must be a positive integer');
  if (!Number.isInteger(frame.generation) || frame.generation < 1) throw new CredentialProtocolError('CREDENTIAL_GENERATION_INVALID', 'generation must be a positive integer');
  if (!Number.isInteger(frame.payloadBytes) || frame.payloadBytes < 0) throw new CredentialProtocolError('CREDENTIAL_PAYLOAD_SIZE_INVALID', 'payloadBytes must be a non-negative integer');
  if (!/^[0-9a-f]{64}$/.test(frame.authorityHeadDigest)) throw new CredentialProtocolError('CREDENTIAL_AUTHORITY_HEAD_INVALID', 'authorityHeadDigest must be lowercase SHA256');
  for (const field of ['vaultReferenceCount', 'decryptedEntryCount', 'frameEntryCount']) if (!Number.isInteger(frame[field]) || frame[field] < 0) throw new CredentialProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', `${field} must be a non-negative integer`);
  if (!/^[0-9a-f]{64}$/.test(frame.manifestSha256)) throw new CredentialProtocolError('CREDENTIAL_MANIFEST_HASH_INVALID', 'manifestSha256 must be lowercase SHA256');
  if (!isObject(frame.payload) || !Array.isArray(frame.payload.entries)) throw new CredentialProtocolError('CREDENTIAL_PAYLOAD_INVALID', 'Credential payload entries are required');
  if (frame.vaultReferenceCount !== frame.decryptedEntryCount || frame.decryptedEntryCount !== frame.frameEntryCount || frame.frameEntryCount !== frame.payload.entries.length) {
    throw new CredentialProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', 'Credential hydration reference counts do not match');
  }
  const refs = frame.payload.entries.map(row => String(row?.ref || '').trim());
  if (refs.some(ref => !ref) || new Set(refs).size !== refs.length) throw new CredentialProtocolError('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', 'Credential frame references must be non-empty and unique');
  const actualPayloadBytes = secretPayloadBytes(frame.payload);
  if (actualPayloadBytes !== frame.payloadBytes) {
    throw new CredentialProtocolError('CREDENTIAL_PAYLOAD_SIZE_MISMATCH', 'Credential payloadBytes does not match payload bytes', { expected: frame.payloadBytes, actual: actualPayloadBytes });
  }
  const issued = Date.parse(frame.issuedAtUtc);
  if (!Number.isFinite(issued)) throw new CredentialProtocolError('CREDENTIAL_ISSUED_AT_INVALID', 'issuedAtUtc must be an ISO timestamp');
  const nowMs = Number(options.nowMs ?? Date.now());
  if (options.checkFreshness !== false && Math.abs(nowMs - issued) > Number(options.maxIssuedAgeMs || MAX_ISSUED_AGE_MS)) {
    throw new CredentialProtocolError('CREDENTIAL_FRAME_EXPIRED', 'Credential frame is outside the accepted issue window');
  }
  if (options.expectedPid != null && Number(options.expectedPid) !== frame.backendPid) {
    throw new CredentialProtocolError('CREDENTIAL_WRONG_BACKEND_PID', 'Credential frame backendPid mismatch', { expectedPid: Number(options.expectedPid), actualPid: frame.backendPid });
  }
  if (options.expectedStartupNonce != null && String(options.expectedStartupNonce) !== frame.startupNonce) {
    throw new CredentialProtocolError('CREDENTIAL_STARTUP_NONCE_MISMATCH', 'Credential frame startupNonce mismatch');
  }
  if (options.expectedManifestSha256 != null && String(options.expectedManifestSha256) !== frame.manifestSha256) {
    throw new CredentialProtocolError('CREDENTIAL_WRONG_MANIFEST', 'Credential frame manifest SHA256 mismatch');
  }
  if (options.expectedVaultEpoch != null && String(options.expectedVaultEpoch) !== frame.vaultEpoch) {
    throw new CredentialProtocolError('CREDENTIAL_VAULT_EPOCH_STARTUP_MISMATCH', 'Credential frame vaultEpoch does not match startup control metadata');
  }
  return frame;
}

function encodeCredentialFrame(frame) {
  validateCredentialFrame(frame, { checkFreshness: false });
  const encoded = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
  if (encoded.length > MAX_CREDENTIAL_FRAME_BYTES) {
    throw new CredentialProtocolError('CREDENTIAL_MESSAGE_TOO_LARGE', 'Credential frame exceeds maximum size', { maxBytes: MAX_CREDENTIAL_FRAME_BYTES, actualBytes: encoded.length });
  }
  return encoded;
}

function makeCredentialFrame(options = {}) {
  const entries = Array.isArray(options.entries) ? options.entries
    .map(row => ({ ref: String(row.ref || ''), value: row.value ?? null }))
    .filter(row => row.ref)
    .sort((a, b) => Buffer.from(a.ref).compare(Buffer.from(b.ref))) : [];
  const payload = { entries };
  return Object.freeze({
    type: 'credential_snapshot',
    startupNonce: String(options.startupNonce || ''),
    oneTimeToken: String(options.oneTimeToken || ''),
    backendPid: Number(options.backendPid || 0),
    protocolVersion: CREDENTIAL_PROTOCOL_VERSION,
    manifestSha256: String(options.manifestSha256 || ''),
    vaultEpoch: String(options.vaultEpoch || ''),
    generation: Number(options.generation || 0),
    authorityEventId: String(options.authorityEventId || ''),
    authorityHeadDigest: String(options.authorityHeadDigest || ''),
    vaultReferenceCount: Number(options.vaultReferenceCount ?? entries.length),
    decryptedEntryCount: Number(options.decryptedEntryCount ?? entries.length),
    frameEntryCount: entries.length,
    issuedAtUtc: String(options.issuedAtUtc || new Date().toISOString()),
    payloadBytes: secretPayloadBytes(payload),
    payload
  });
}

module.exports = {
  CREDENTIAL_HYDRATION_TIMEOUT_MS,
  CREDENTIAL_PROTOCOL_VERSION,
  MAX_CREDENTIAL_FRAME_BYTES,
  CredentialProtocolError,
  createCredentialOneTimeToken,
  encodeCredentialFrame,
  makeCredentialFrame,
  secretPayloadBytes,
  validateCredentialFrame
};
