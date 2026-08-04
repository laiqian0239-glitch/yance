'use strict';

const crypto = require('node:crypto');

const ALGORITHM = 'AES-256-GCM';
const NODE_ALGORITHM = 'aes-256-gcm';
const CIPHER_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HKDF_SALT = Buffer.from('yance:oss1a:whatsapp-auth:v1', 'utf8');
const AAD_ORDER = Object.freeze([
  'schemaVersion',
  'recordType',
  'accountKey',
  'accountId',
  'currentEpoch',
  'category',
  'keyId',
  'canonicalMessageId'
]);
const RECORD_TYPES = Object.freeze({
  AUTH_CREDS: Object.freeze(['schemaVersion', 'accountKey', 'accountId', 'currentEpoch']),
  AUTH_KEY: Object.freeze([
    'schemaVersion', 'accountKey', 'accountId', 'currentEpoch', 'category', 'keyId'
  ]),
  RETRY_PAYLOAD: Object.freeze(['schemaVersion', 'accountId', 'canonicalMessageId'])
});
const INDEX_PURPOSES = Object.freeze([
  'IDENTITY_JID',
  'REMOTE_JID',
  'MESSAGE_ID',
  'PARTICIPANT',
  'CACHE_KEY',
  'SOURCE_DIRECTORY',
  'CLEANUP_REFERENCE'
]);
const INDEX_PURPOSE_SET = new Set(INDEX_PURPOSES);
const PRIVATE = new WeakMap();

function cipherError(code, message) {
  const error = new Error(message);
  error.name = 'WhatsAppAuthCipherError';
  error.code = code;
  error.reasonCode = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactBuffer(value, length, code) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw cipherError(code, 'Encrypted envelope is malformed');
  }
  const buffer = Buffer.from(value);
  if (length != null && buffer.length !== length) {
    throw cipherError(code, 'Encrypted envelope is malformed');
  }
  return buffer;
}

function normalizeString(value, field, required) {
  if (value == null || value === '') {
    if (required) throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', `AAD field ${field} is required`);
    return '';
  }
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', `AAD field ${field} is invalid`);
  }
  return value;
}

function normalizeInteger(value, field, required) {
  if (value == null || value === '') {
    if (required) throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', `AAD field ${field} is required`);
    return 0;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', `AAD field ${field} is invalid`);
  }
  return value;
}

function buildTypedAad(recordType, identity) {
  const required = RECORD_TYPES[recordType];
  if (!required) {
    throw cipherError(
      'WHATSAPP_AUTH_CIPHER_RECORD_TYPE_UNSUPPORTED',
      'WhatsApp auth record type is unsupported'
    );
  }
  if (!isPlainObject(identity) || Object.getOwnPropertySymbols(identity).length) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', 'AAD identity must be a plain object');
  }
  const descriptors = Object.getOwnPropertyDescriptors(identity);
  const allowed = new Set(AAD_ORDER.filter(field => field !== 'recordType'));
  for (const key of Object.getOwnPropertyNames(identity)) {
    const descriptor = descriptors[key];
    if (!allowed.has(key) || descriptor?.get || descriptor?.set) {
      throw cipherError('WHATSAPP_AUTH_CIPHER_AAD_INVALID', 'AAD identity contains an unsupported field');
    }
  }
  const requiredSet = new Set(required);
  const normalized = Object.freeze({
    schemaVersion: normalizeInteger(identity.schemaVersion, 'schemaVersion', requiredSet.has('schemaVersion')),
    recordType,
    accountKey: normalizeString(identity.accountKey, 'accountKey', requiredSet.has('accountKey')),
    accountId: normalizeString(identity.accountId, 'accountId', requiredSet.has('accountId')),
    currentEpoch: normalizeInteger(identity.currentEpoch, 'currentEpoch', requiredSet.has('currentEpoch')),
    category: normalizeString(identity.category, 'category', requiredSet.has('category')),
    keyId: normalizeString(identity.keyId, 'keyId', requiredSet.has('keyId')),
    canonicalMessageId: normalizeString(
      identity.canonicalMessageId,
      'canonicalMessageId',
      requiredSet.has('canonicalMessageId')
    )
  });
  return Buffer.from(JSON.stringify(AAD_ORDER.map(field => normalized[field])), 'utf8');
}

function deriveKey(source, info) {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    source,
    HKDF_SALT,
    Buffer.from(info, 'utf8'),
    KEY_BYTES
  ));
}

function privateState(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw cipherError('WHATSAPP_AUTH_CIPHER_INVALID', 'Cipher private state is unavailable');
  return state;
}

function assertOpen(instance) {
  const state = privateState(instance);
  if (state.closed) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_CLOSED', 'WhatsApp auth cipher is closed');
  }
  return state;
}

function validateEnvelope(state, envelope) {
  if (!isPlainObject(envelope)) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_ENVELOPE_INVALID', 'Encrypted envelope is malformed');
  }
  if (envelope.cipherVersion !== state.cipherVersion) {
    throw cipherError(
      'WHATSAPP_AUTH_CIPHER_VERSION_UNSUPPORTED',
      'Encrypted envelope cipher version is unsupported'
    );
  }
  if (envelope.keyVersion !== state.keyVersion) {
    throw cipherError(
      'WHATSAPP_AUTH_CIPHER_KEY_VERSION_UNSUPPORTED',
      'Encrypted envelope key version is unsupported'
    );
  }
  const nonce = exactBuffer(
    envelope.nonce,
    NONCE_BYTES,
    'WHATSAPP_AUTH_CIPHER_ENVELOPE_INVALID'
  );
  const ciphertext = exactBuffer(
    envelope.ciphertext,
    null,
    'WHATSAPP_AUTH_CIPHER_ENVELOPE_INVALID'
  );
  const authTag = exactBuffer(
    envelope.authTag,
    AUTH_TAG_BYTES,
    'WHATSAPP_AUTH_CIPHER_ENVELOPE_INVALID'
  );
  if (!/^[a-f0-9]{64}$/u.test(String(envelope.ciphertextSha256 || ''))) {
    throw cipherError('WHATSAPP_AUTH_CIPHER_ENVELOPE_INVALID', 'Encrypted envelope is malformed');
  }
  const actualHash = crypto.createHash('sha256').update(ciphertext).digest();
  const expectedHash = Buffer.from(envelope.ciphertextSha256, 'hex');
  if (expectedHash.length !== actualHash.length || !crypto.timingSafeEqual(expectedHash, actualHash)) {
    throw cipherError(
      'WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED',
      'Encrypted WhatsApp auth record failed authentication'
    );
  }
  return { nonce, ciphertext, authTag };
}

class WhatsAppAuthCipher {
  constructor(options = {}) {
    const key = exactBuffer(
      options.key,
      KEY_BYTES,
      'WHATSAPP_AUTH_CIPHER_KEY_INVALID'
    );
    const keyVersion = Number(options.keyVersion);
    const cipherVersion = options.cipherVersion == null
      ? CIPHER_VERSION
      : Number(options.cipherVersion);
    if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
      throw cipherError('WHATSAPP_AUTH_CIPHER_KEY_VERSION_INVALID', 'Cipher key version is invalid');
    }
    if (cipherVersion !== CIPHER_VERSION) {
      throw cipherError('WHATSAPP_AUTH_CIPHER_VERSION_UNSUPPORTED', 'Cipher version is unsupported');
    }
    const masterKey = Buffer.from(key);
    const encryptionKey = deriveKey(masterKey, 'encryption');
    const indexRootKey = deriveKey(masterKey, 'index-root');
    masterKey.fill(0);
    PRIVATE.set(this, {
      algorithm: ALGORITHM,
      cipherVersion,
      keyVersion,
      encryptionKey,
      indexRootKey,
      purposeKeys: new Map(),
      closed: false
    });
    Object.freeze(this);
  }

  encrypt(recordType, aadIdentity, plaintextBuffer) {
    const state = assertOpen(this);
    const plaintext = exactBuffer(
      plaintextBuffer,
      null,
      'WHATSAPP_AUTH_CIPHER_PLAINTEXT_INVALID'
    );
    const aad = buildTypedAad(recordType, aadIdentity);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv(NODE_ALGORITHM, state.encryptionKey, nonce, {
      authTagLength: AUTH_TAG_BYTES
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Object.freeze({
      cipherVersion: state.cipherVersion,
      keyVersion: state.keyVersion,
      nonce,
      ciphertext,
      authTag,
      ciphertextSha256: crypto.createHash('sha256').update(ciphertext).digest('hex')
    });
  }

  decrypt(recordType, aadIdentity, envelope) {
    const state = assertOpen(this);
    const aad = buildTypedAad(recordType, aadIdentity);
    const normalized = validateEnvelope(state, envelope);
    try {
      const decipher = crypto.createDecipheriv(
        NODE_ALGORITHM,
        state.encryptionKey,
        normalized.nonce,
        { authTagLength: AUTH_TAG_BYTES }
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(normalized.authTag);
      return Buffer.concat([
        decipher.update(normalized.ciphertext),
        decipher.final()
      ]);
    } catch (_) {
      throw cipherError(
        'WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED',
        'Encrypted WhatsApp auth record failed authentication'
      );
    }
  }

  hmacIndex(purpose, value) {
    const state = assertOpen(this);
    const normalizedPurpose = String(purpose || '');
    if (!INDEX_PURPOSE_SET.has(normalizedPurpose)) {
      throw cipherError(
        'WHATSAPP_AUTH_CIPHER_INDEX_PURPOSE_UNSUPPORTED',
        'WhatsApp auth index purpose is unsupported'
      );
    }
    const input = Buffer.isBuffer(value) || value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(String(value == null ? '' : value), 'utf8');
    if (!input.length) {
      throw cipherError('WHATSAPP_AUTH_CIPHER_INDEX_VALUE_INVALID', 'Index value is empty');
    }
    let purposeKey = state.purposeKeys.get(normalizedPurpose);
    if (!purposeKey) {
      purposeKey = deriveKey(state.indexRootKey, `index:${normalizedPurpose}`);
      state.purposeKeys.set(normalizedPurpose, purposeKey);
    }
    return crypto.createHmac('sha256', purposeKey).update(input).digest('hex');
  }

  close() {
    const state = privateState(this);
    if (state.closed) return false;
    state.closed = true;
    state.encryptionKey.fill(0);
    state.indexRootKey.fill(0);
    for (const purposeKey of state.purposeKeys.values()) purposeKey.fill(0);
    state.purposeKeys.clear();
    return true;
  }

  snapshot() {
    const state = privateState(this);
    return Object.freeze({
      module: 'WhatsAppAuthCipher',
      algorithm: state.algorithm,
      cipherVersion: state.cipherVersion,
      keyVersion: state.keyVersion,
      closed: state.closed,
      recordTypes: Object.freeze(Object.keys(RECORD_TYPES)),
      indexPurposes: Object.freeze([...INDEX_PURPOSES])
    });
  }
}

Object.freeze(WhatsAppAuthCipher.prototype);

function createWhatsAppAuthCipher(options = {}) {
  return new WhatsAppAuthCipher(options);
}

module.exports = Object.freeze({
  ALGORITHM,
  CIPHER_VERSION,
  RECORD_TYPES,
  INDEX_PURPOSES,
  WhatsAppAuthCipher,
  createWhatsAppAuthCipher
});
