'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../config');
const { registerSynapseUserWithSharedSecret, matrixBaseUrl, matrixServerName } = require('./synapseSharedSecretRegistration');

const RECEIPT_DOCUMENT_TYPE = 'YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_RECEIPT_V1';
const PENDING_DOCUMENT_TYPE = 'YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_PENDING_V1';
const RECEIPT_BASENAME = 'matrix-local-human-identity.json';
const PENDING_BASENAME = 'matrix-local-human-identity.pending.json';

// Platform-managed Matrix namespace. Bridged identities are provisioned by the
// platform itself (the Facebook mautrix bridge uses `yance_fb_<sha256-24>`), and
// every platform-managed account lives under the `yance_` prefix. An end user
// must never be able to claim a localpart inside that namespace, so the prefix
// is reserved outright instead of trying to enumerate bridge accounts.
const RESERVED_LOCALPART_PREFIXES = Object.freeze(['yance_']);
const RESERVED_LOCALPARTS = Object.freeze(['admin', 'root', 'system', 'synapse']);

const SECRET_MARKER_PATTERN = /password|passphrase|access[_-]?token|matrixAccessToken|shared[_-]?secret/iu;

function clean(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.reasonCode = code;
  error.status = status;
  error.details = details;
  return error;
}

function receiptPath() {
  return path.join(PATHS.secure, RECEIPT_BASENAME);
}

function pendingPath() {
  return path.join(PATHS.secure, PENDING_BASENAME);
}

function localpartIsReserved(localpart) {
  const value = clean(localpart).toLowerCase();
  return RESERVED_LOCALPART_PREFIXES.some(prefix => value.startsWith(prefix))
    || RESERVED_LOCALPARTS.includes(value);
}

function validateLocalpart(value) {
  const localpart = clean(value).toLowerCase();
  if (!localpart) throw fail('MATRIX_LOCAL_IDENTITY_LOCALPART_REQUIRED', 'Matrix username is required.', 400);
  if (localpart !== clean(value)) throw fail('MATRIX_LOCAL_IDENTITY_LOCALPART_CANONICAL_REQUIRED', 'Matrix username must already be lowercase and trimmed.', 400);
  if (!/^[a-z0-9][a-z0-9._=-]{2,63}$/.test(localpart)) {
    throw fail('MATRIX_LOCAL_IDENTITY_LOCALPART_INVALID', 'Matrix username must be 3-64 lowercase letters, numbers, dot, underscore, equals, or hyphen, starting with a letter or number.', 400);
  }
  if (localpartIsReserved(localpart)) {
    throw fail('MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED', 'Matrix username is reserved for platform-managed identities.', 400, { localpart, reservedPrefixes: [...RESERVED_LOCALPART_PREFIXES] });
  }
  return localpart;
}

function validatePassword(password, confirmPassword = password) {
  const value = String(password == null ? '' : password);
  if (value.length < 12) throw fail('MATRIX_LOCAL_IDENTITY_PASSWORD_TOO_SHORT', 'Matrix password must be at least 12 characters.', 400);
  if (/\s/.test(value)) throw fail('MATRIX_LOCAL_IDENTITY_PASSWORD_WHITESPACE_DENIED', 'Matrix password must not contain whitespace.', 400);
  if (value !== String(confirmPassword == null ? '' : confirmPassword)) {
    throw fail('MATRIX_LOCAL_IDENTITY_PASSWORD_CONFIRMATION_MISMATCH', 'Matrix passwords do not match.', 400);
  }
  return value;
}

// Durable state must never carry a secret. The check is intentionally applied
// to the persisted field names and to the live secret values rather than to the
// whole document: a legitimate user localpart such as `alice_support` is not a
// secret and must not be able to trip the gate.
function assertNoSecrets(value, serialized, liveSecrets = []) {
  if (SECRET_MARKER_PATTERN.test(Object.keys(value).join(' '))) {
    throw fail('MATRIX_LOCAL_IDENTITY_SECRET_RECEIPT_DENIED', 'Matrix local identity state must not persist secret fields.', 500);
  }
  const haystack = serialized.toLowerCase();
  for (const secret of liveSecrets) {
    const needle = String(secret == null ? '' : secret);
    if (needle.length >= 8 && haystack.includes(needle.toLowerCase())) {
      throw fail('MATRIX_LOCAL_IDENTITY_SECRET_RECEIPT_DENIED', 'Matrix local identity state must not persist secret values.', 500);
    }
  }
}

// Atomic durable write. Exclusive mode uses O_EXCL so two processes can never
// both enter provisioning; replace mode writes a sibling temp file and renames
// it, so a crash can never leave a half-written receipt behind.
function writeStateAtomic(filePath, value, { exclusive = false, liveSecrets = [] } = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertNoSecrets(value, serialized, liveSecrets);
  const encoded = Buffer.from(serialized, 'utf8');
  if (exclusive) {
    const fd = fs.openSync(filePath, 'wx');
    try {
      fs.writeSync(fd, encoded);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const fd = fs.openSync(tempPath, 'wx');
  try {
    fs.writeSync(fd, encoded);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {
      // The temp file is already gone; the original failure is what matters.
    }
    throw error;
  }
}

function readState(filePath, documentType) {
  if (!fs.existsSync(filePath)) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    throw fail('MATRIX_LOCAL_IDENTITY_RECEIPT_INVALID', 'Stored Matrix local identity state is unreadable.', 500, { file: path.basename(filePath) });
  }
  if (!parsed || typeof parsed !== 'object' || clean(parsed.documentType) !== documentType) {
    throw fail('MATRIX_LOCAL_IDENTITY_RECEIPT_INVALID', 'Stored Matrix local identity state is invalid.', 500, { file: path.basename(filePath) });
  }
  return parsed;
}

function readReceipt() {
  return readState(receiptPath(), RECEIPT_DOCUMENT_TYPE);
}

function readPending() {
  return readState(pendingPath(), PENDING_DOCUMENT_TYPE);
}

function clearPending() {
  try {
    fs.unlinkSync(pendingPath());
  } catch (error) {
    if (clean(error?.code) !== 'ENOENT') throw error;
  }
}

function publicReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return { ok: true, exists: false, identity: null };
  return {
    ok: true,
    exists: true,
    identity: {
      localpart: clean(receipt.localpart),
      matrixUserId: clean(receipt.matrixUserId),
      homeserverName: clean(receipt.homeserverName),
      matrixBaseUrl: clean(receipt.matrixBaseUrl),
      createdAtUtc: clean(receipt.createdAtUtc),
      registrationAuthority: clean(receipt.registrationAuthority)
    }
  };
}

function status() {
  const receipt = readReceipt();
  if (receipt) return publicReceipt(receipt);
  const pending = readPending();
  if (!pending) return publicReceipt(null);
  return {
    ok: true,
    exists: false,
    identity: null,
    blocked: true,
    pending: {
      localpart: clean(pending.localpart),
      homeserverName: clean(pending.homeserverName),
      matrixBaseUrl: clean(pending.matrixBaseUrl),
      requestedAtUtc: clean(pending.requestedAtUtc),
      outcome: 'UNKNOWN_CONFIRMATION_REQUIRED'
    }
  };
}

// A remote call either definitively did not create the account, or it may have.
// Only a definitive rejection is safe to retry; everything else must retain the
// durable pending marker so the account is never created twice.
function classifyRemoteOutcome(error) {
  const code = clean(error?.code);
  const status = Number(error?.status);
  if (code === 'MATRIX_REGISTRATION_NONCE_FAILED'
    || code === 'MATRIX_REGISTRATION_NONCE_MISSING'
    || code === 'MATRIX_REGISTRATION_SHARED_SECRET_REQUIRED'
    || code === 'MATRIX_REGISTRATION_USERNAME_REQUIRED'
    || code === 'MATRIX_REGISTRATION_PASSWORD_REQUIRED') {
    return 'DEFINITE_FAILURE';
  }
  if (Number.isFinite(status) && status >= 400 && status < 500) return 'DEFINITE_FAILURE';
  return 'UNKNOWN_OUTCOME';
}

function upstreamErrcode(error) {
  const body = error?.details?.body;
  if (!body || typeof body !== 'object') return '';
  return clean(body.errcode).slice(0, 64);
}

// Upstream error bodies are never forwarded wholesale: only a bounded errcode
// survives, so a hostile or verbose upstream can never push secrets back out.
function remoteFailure(error, outcome) {
  const causeCode = clean(error?.code, 'MATRIX_REGISTRATION_REMOTE_FAILURE');
  const causeStatus = Number.isFinite(Number(error?.status)) ? Number(error.status) : 0;
  const errcode = upstreamErrcode(error);
  const details = { causeCode, causeStatus, outcome };
  if (errcode) details.upstreamErrcode = errcode;
  if (errcode === 'M_USER_IN_USE') {
    return fail('MATRIX_LOCAL_IDENTITY_LOCALPART_TAKEN', 'That Matrix username is already taken on this homeserver.', 409, details);
  }
  if (outcome === 'UNKNOWN_OUTCOME') {
    return fail('MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN', 'The homeserver did not confirm the outcome of this Matrix registration. The account may already exist and must not be created again automatically.', 502, details);
  }
  return fail('MATRIX_LOCAL_IDENTITY_REGISTRATION_FAILED', clean(error?.message, 'Synapse rejected the Matrix registration request.'), causeStatus >= 400 && causeStatus < 500 ? causeStatus : 502, details);
}

let inFlight = null;

async function provisionLocked(input = {}) {
  if (readReceipt()) {
    throw fail('MATRIX_LOCAL_IDENTITY_ALREADY_EXISTS', 'A local Matrix human identity already exists for this installation.', 409);
  }
  const pending = readPending();
  if (pending) {
    throw fail('MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN', 'A previous Matrix registration attempt was never confirmed. The account may already exist and must not be created again automatically.', 409, {
      localpart: clean(pending.localpart),
      requestedAtUtc: clean(pending.requestedAtUtc),
      outcome: 'UNKNOWN_CONFIRMATION_REQUIRED'
    });
  }

  const localpart = validateLocalpart(input.localpart);
  const password = validatePassword(input.password, input.confirmPassword);
  const homeserverName = matrixServerName(input);
  const baseUrl = matrixBaseUrl(input);
  const expectedUserId = `@${localpart}:${homeserverName}`;

  // Record the durable intent BEFORE talking to the homeserver. From this point
  // on, a crash, a power loss, or an unconfirmed response can never leave the
  // installation believing no account exists.
  writeStateAtomic(pendingPath(), {
    documentType: PENDING_DOCUMENT_TYPE,
    localpart,
    homeserverName,
    matrixBaseUrl: baseUrl,
    requestedAtUtc: new Date().toISOString(),
    state: 'registration-requested'
  }, { exclusive: true, liveSecrets: [password] });

  let registered = null;
  try {
    registered = await registerSynapseUserWithSharedSecret({
      username: localpart,
      password,
      matrixBaseUrl: baseUrl,
      matrixServerName: homeserverName,
      signal: input.signal || null
    });
  } catch (error) {
    const outcome = classifyRemoteOutcome(error);
    if (outcome === 'DEFINITE_FAILURE') clearPending();
    throw remoteFailure(error, outcome);
  }

  const matrixUserId = clean(registered?.matrixUserId, expectedUserId);
  if (matrixUserId !== expectedUserId) {
    clearPending();
    throw fail('MATRIX_LOCAL_IDENTITY_SCOPE_MISMATCH', 'Synapse returned a Matrix identity outside the requested local user scope.', 502, { expectedUserId, matrixUserId });
  }

  const receipt = {
    documentType: RECEIPT_DOCUMENT_TYPE,
    localpart,
    matrixUserId,
    homeserverName,
    matrixBaseUrl: clean(registered?.matrixBaseUrl, baseUrl),
    createdAtUtc: new Date().toISOString(),
    registrationAuthority: 'synapse-shared-secret-registration'
  };

  try {
    writeStateAtomic(receiptPath(), receipt, { exclusive: false, liveSecrets: [password, registered?.matrixAccessToken] });
  } catch (error) {
    // The account exists on the homeserver but was not durably recorded here.
    // Keep the pending marker so the next startup reports the unknown outcome
    // instead of blindly attempting a second registration.
    throw fail('MATRIX_LOCAL_IDENTITY_PERSIST_FAILED', 'The local Matrix identity was created on the homeserver, but the local receipt could not be persisted. The registration stays pending so it is never created twice.', 500, {
      causeCode: clean(error?.code, 'PERSIST_FAILED'),
      outcome: 'REMOTE_CREATED_LOCAL_UNCONFIRMED'
    });
  }

  try {
    clearPending();
  } catch (_) {
    // The authoritative receipt is durable. A lingering pending marker is only
    // stale reporting state and must not fail a successful provisioning.
  }
  return publicReceipt(receipt);
}

async function provision(input = {}) {
  if (inFlight) {
    throw fail('MATRIX_LOCAL_IDENTITY_PROVISION_IN_PROGRESS', 'A local Matrix identity creation is already in progress.', 409);
  }
  const run = provisionLocked(input);
  const release = () => {
    inFlight = null;
  };
  inFlight = run.then(release, release);
  return run;
}

module.exports = {
  receiptPath,
  pendingPath,
  validateLocalpart,
  localpartIsReserved,
  validatePassword,
  classifyRemoteOutcome,
  status,
  provision
};
