'use strict';

const crypto = require('node:crypto');

const CREDENTIAL_CUSTODY_PROTOCOL_VERSION = 3;
const MAX_CREDENTIAL_CUSTODY_FRAME_BYTES = 262144;
const CREDENTIAL_CUSTODY_ACK_TIMEOUT_MS = 10000;
const MAX_CREDENTIAL_CUSTODY_AGE_MS = 60000;
const REQUEST_TYPE = 'credential_custody_request';
const ACK_TYPE = 'credential_custody_ack';
const OPERATIONS = Object.freeze(new Set(['persist', 'remove']));
const ACTIONS = Object.freeze(new Set(['PREPARE', 'COMMIT', 'ABORT', 'QUERY']));
const TRANSACTION_STATES = Object.freeze(new Set(['UNKNOWN', 'NEW', 'PREPARING', 'PREPARED', 'COMMITTING', 'COMMITTED', 'ABORTING', 'ROLLED_BACK', 'FAILED', 'INDETERMINATE']));

class CredentialCustodyProtocolError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message || reasonCode);
    this.name = 'CredentialCustodyProtocolError';
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    this.details = details;
  }
}

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function payloadBytes(payload) { return Buffer.byteLength(JSON.stringify(payload || {}), 'utf8'); }
function newRequestId(randomUUID = crypto.randomUUID) { return randomUUID(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function mutationSha256(operation, ref, value) {
  return crypto.createHash('sha256').update(stable({ operation, ref, value: operation === 'remove' ? null : (value ?? {}) })).digest('hex');
}

function makeCustodyRequest(options = {}) {
  const action = String(options.action || 'PREPARE').toUpperCase();
  const operation = String(options.operation || '');
  const ref = String(options.ref || '');
  const value = operation === 'remove' ? undefined : (options.value ?? {});
  const digest = String(options.mutationSha256 || mutationSha256(operation, ref, value));
  const payload = action === 'PREPARE' ? { ref, ...(operation === 'persist' ? { value } : {}), mutationSha256: digest } : { ref, mutationSha256: digest };
  return Object.freeze({
    type: REQUEST_TYPE,
    protocolVersion: CREDENTIAL_CUSTODY_PROTOCOL_VERSION,
    action,
    requestId: String(options.requestId || newRequestId(options.randomUUID)),
    operation,
    backendPid: Number(options.backendPid || 0),
    startupNonce: String(options.startupNonce || ''),
    backendSessionId: String(options.backendSessionId || ''),
    fd6PipeInstanceId: String(options.fd6PipeInstanceId || ''),
    hydrationGeneration: Number(options.hydrationGeneration || options.generation || 0),
    manifestSha256: String(options.manifestSha256 || ''),
    vaultEpoch: String(options.vaultEpoch || ''),
    generation: Number(options.generation || 0),
    issuedAtUtc: String(options.issuedAtUtc || new Date().toISOString()),
    payloadBytes: payloadBytes(payload),
    payload
  });
}

function validateCustodyRequest(frame, options = {}) {
  if (!isObject(frame) || frame.type !== REQUEST_TYPE) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_FRAME_INVALID', 'Credential custody request is invalid');
  if (frame.protocolVersion !== CREDENTIAL_CUSTODY_PROTOCOL_VERSION) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_PROTOCOL_MISMATCH', 'Credential custody protocol version mismatch');
  if (!ACTIONS.has(frame.action)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACTION_INVALID', 'Credential custody action is invalid');
  if (typeof frame.requestId !== 'string' || !frame.requestId) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_REQUEST_ID_INVALID', 'requestId is required');
  if (!OPERATIONS.has(frame.operation)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_OPERATION_INVALID', 'Credential custody operation is invalid');
  if (!Number.isInteger(frame.backendPid) || frame.backendPid < 1) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_BACKEND_PID_INVALID', 'backendPid must be positive');
  if (!/^[0-9a-f]{64}$/.test(frame.manifestSha256 || '')) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_MANIFEST_INVALID', 'manifestSha256 must be lowercase SHA256');
  if (typeof frame.vaultEpoch !== 'string' || !frame.vaultEpoch) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_VAULT_EPOCH_INVALID', 'vaultEpoch is required');
  if (!Number.isInteger(frame.generation) || frame.generation < 1) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_GENERATION_INVALID', 'generation must be positive');
  const ownerFieldsPresent = ['startupNonce', 'backendSessionId', 'fd6PipeInstanceId'].some(field => typeof frame[field] === 'string' && frame[field]);
  if (ownerFieldsPresent) {
    for (const field of ['startupNonce', 'backendSessionId', 'fd6PipeInstanceId']) if (typeof frame[field] !== 'string' || !frame[field]) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_INVALID', `${field} is required`);
    if (!Number.isInteger(frame.hydrationGeneration) || frame.hydrationGeneration < 1) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_INVALID', 'hydrationGeneration must be positive');
  }
  if (!isObject(frame.payload) || typeof frame.payload.ref !== 'string' || !frame.payload.ref.trim()) throw new CredentialCustodyProtocolError('INVALID_CREDENTIAL_REF', 'Credential reference is required');
  if (!/^[0-9a-f]{64}$/.test(frame.payload.mutationSha256 || '')) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_MUTATION_FINGERPRINT_INVALID', 'Mutation fingerprint is invalid');
  if (frame.action === 'PREPARE') {
    const computed = mutationSha256(frame.operation, frame.payload.ref, frame.payload.value);
    if (computed !== frame.payload.mutationSha256) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_MUTATION_FINGERPRINT_MISMATCH', 'Mutation fingerprint mismatch');
  }
  const actualBytes = payloadBytes(frame.payload);
  if (!Number.isInteger(frame.payloadBytes) || actualBytes !== frame.payloadBytes) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_PAYLOAD_SIZE_MISMATCH', 'Credential custody payload size mismatch', { expected: frame.payloadBytes, actual: actualBytes });
  const issued = Date.parse(frame.issuedAtUtc);
  if (!Number.isFinite(issued)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ISSUED_AT_INVALID', 'issuedAtUtc is invalid');
  if (options.checkFreshness !== false && Math.abs(Number(options.nowMs ?? Date.now()) - issued) > Number(options.maxIssuedAgeMs || MAX_CREDENTIAL_CUSTODY_AGE_MS)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_REQUEST_EXPIRED', 'Credential custody request expired');
  if (options.expectedPid != null && Number(options.expectedPid) !== frame.backendPid) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_BACKEND_PID_MISMATCH', 'Credential custody backend PID mismatch');
  if (options.expectedManifestSha256 != null && String(options.expectedManifestSha256) !== frame.manifestSha256) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_MANIFEST_MISMATCH', 'Credential custody manifest mismatch');
  if (options.expectedVaultEpoch != null && String(options.expectedVaultEpoch) !== frame.vaultEpoch) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_VAULT_EPOCH_MISMATCH', 'Credential custody vault epoch mismatch');
  for (const [field, expected] of [['startupNonce', options.expectedStartupNonce], ['backendSessionId', options.expectedBackendSessionId], ['fd6PipeInstanceId', options.expectedFd6PipeInstanceId]]) {
    if ((ownerFieldsPresent || options.requireOwnerBinding === true) && expected != null && String(expected) !== String(frame[field] || '')) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', `Credential custody ${field} mismatch`);
  }
  if ((ownerFieldsPresent || options.requireOwnerBinding === true) && options.expectedHydrationGeneration != null && Number(options.expectedHydrationGeneration) !== Number(frame.hydrationGeneration || 0)) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'Credential custody hydration generation mismatch');
  return frame;
}

function makeCustodyAck(request, result = {}) {
  const state = String(result.transactionState || (result.success ? 'COMMITTED' : 'FAILED'));
  const payload = { persisted: result.persisted === true, operation: request.operation, ref: request.payload.ref, transactionState: state, durableReplay: result.durableReplay === true };
  return Object.freeze({
    type: ACK_TYPE,
    protocolVersion: CREDENTIAL_CUSTODY_PROTOCOL_VERSION,
    action: request.action,
    requestId: request.requestId,
    backendPid: request.backendPid,
    startupNonce: String(request.startupNonce || ''),
    backendSessionId: String(request.backendSessionId || ''),
    fd6PipeInstanceId: String(request.fd6PipeInstanceId || ''),
    hydrationGeneration: Number(request.hydrationGeneration || request.generation),
    manifestSha256: request.manifestSha256,
    vaultEpoch: String(result.vaultEpoch || request.vaultEpoch),
    previousGeneration: Number(result.previousGeneration ?? request.generation),
    generation: Number(result.generation ?? request.generation),
    mutationSha256: request.payload.mutationSha256,
    authorityEventId: String(result.authorityEventId || ''),
    authorityHeadDigest: String(result.authorityHeadDigest || ''),
    issuedAtUtc: String(result.issuedAtUtc || new Date().toISOString()),
    success: result.success === true,
    retryable: result.retryable === true,
    reasonCode: result.success === true ? '' : String(result.reasonCode || 'CREDENTIAL_VAULT_PERSIST_FAILED'),
    payloadBytes: payloadBytes(payload),
    payload
  });
}

function validateCustodyAck(frame, request, options = {}) {
  if (!isObject(frame) || frame.type !== ACK_TYPE) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_INVALID', 'Credential custody acknowledgement is invalid');
  if (frame.protocolVersion !== CREDENTIAL_CUSTODY_PROTOCOL_VERSION || frame.action !== request.action) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_PROTOCOL_MISMATCH', 'Credential custody acknowledgement protocol mismatch');
  if (frame.requestId !== request.requestId) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_REQUEST_MISMATCH', 'Credential custody acknowledgement requestId mismatch');
  if (frame.backendPid !== request.backendPid || frame.manifestSha256 !== request.manifestSha256 || frame.vaultEpoch !== request.vaultEpoch || frame.mutationSha256 !== request.payload.mutationSha256) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_BINDING_MISMATCH', 'Credential custody acknowledgement binding mismatch');
  for (const field of ['startupNonce', 'backendSessionId', 'fd6PipeInstanceId']) {
    if (String(request[field] || '') !== String(frame[field] || '')) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', `Credential custody acknowledgement ${field} mismatch`);
  }
  if (Number(frame.hydrationGeneration || request.generation) !== Number(request.hydrationGeneration || request.generation)) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'Credential custody acknowledgement hydration generation mismatch');
  if (frame.payload?.transactionState === 'COMMITTED' && (typeof frame.authorityEventId !== 'string' || !frame.authorityEventId || !/^[0-9a-f]{64}$/.test(frame.authorityHeadDigest || ''))) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_BINDING_MISMATCH', 'Committed credential acknowledgement is missing authority event binding');
  if (!TRANSACTION_STATES.has(frame.payload?.transactionState)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_TRANSACTION_STATE_INVALID', 'Credential transaction state is invalid');
  const durableReplay = frame.payload?.durableReplay === true;
  if (durableReplay) {
    if (!['COMMITTED', 'ROLLED_BACK', 'FAILED'].includes(frame.payload.transactionState)) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_DURABLE_REPLAY_INVALID', 'Durable replay must reference a terminal transaction');
    if (!Number.isInteger(frame.previousGeneration) || !Number.isInteger(frame.generation) || frame.previousGeneration < 0 || frame.generation < frame.previousGeneration) throw new CredentialCustodyProtocolError('CREDENTIAL_GENERATION_MISMATCH', 'Durable replay generation metadata is invalid');
    if (frame.payload.transactionState === 'COMMITTED' && (frame.generation !== frame.previousGeneration + 1 || frame.payload.persisted !== true)) throw new CredentialCustodyProtocolError('CREDENTIAL_GENERATION_MISMATCH', 'Durable committed result generation is invalid');
    if (frame.payload.transactionState !== 'COMMITTED' && frame.payload.persisted === true) throw new CredentialCustodyProtocolError('WP4_CREDENTIAL_QUERY_FALSE_COMMITTED', 'Non-committed durable result cannot report persisted');
  } else {
    if (frame.previousGeneration !== request.generation) throw new CredentialCustodyProtocolError('CREDENTIAL_GENERATION_MISMATCH', 'Credential custody acknowledgement previous generation mismatch');
    if (frame.success === true && frame.payload.transactionState === 'COMMITTED' && (!Number.isInteger(frame.generation) || frame.generation !== request.generation + 1 || frame.payload.persisted !== true)) throw new CredentialCustodyProtocolError('CREDENTIAL_GENERATION_MISMATCH', 'Committed credential acknowledgement generation is invalid');
  }
  const actualBytes = payloadBytes(frame.payload);
  if (!Number.isInteger(frame.payloadBytes) || frame.payloadBytes !== actualBytes) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_SIZE_MISMATCH', 'Credential custody acknowledgement payload size mismatch');
  const issued = Date.parse(frame.issuedAtUtc);
  if (!Number.isFinite(issued) || (options.checkFreshness !== false && Math.abs(Number(options.nowMs ?? Date.now()) - issued) > Number(options.maxIssuedAgeMs || MAX_CREDENTIAL_CUSTODY_AGE_MS))) throw new CredentialCustodyProtocolError('CREDENTIAL_CUSTODY_ACK_EXPIRED', 'Credential custody acknowledgement expired');
  return frame;
}

function encodeCustodyFrame(frame) {
  const encoded = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
  if (encoded.length > MAX_CREDENTIAL_CUSTODY_FRAME_BYTES) throw new CredentialCustodyProtocolError('CREDENTIAL_MESSAGE_TOO_LARGE', 'Credential custody frame exceeds maximum size');
  return encoded;
}

module.exports = { ACK_TYPE, ACTIONS, CREDENTIAL_CUSTODY_ACK_TIMEOUT_MS, CREDENTIAL_CUSTODY_PROTOCOL_VERSION, CredentialCustodyProtocolError, MAX_CREDENTIAL_CUSTODY_FRAME_BYTES, REQUEST_TYPE, TRANSACTION_STATES, encodeCustodyFrame, makeCustodyAck, makeCustodyRequest, mutationSha256, payloadBytes, validateCustodyAck, validateCustodyRequest };
