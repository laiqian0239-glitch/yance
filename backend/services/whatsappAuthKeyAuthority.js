'use strict';

const crypto = require('node:crypto');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');

const KEY_REFERENCE = 'whatsapp-auth-data-key:v1';
const KEY_PURPOSE = 'WHATSAPP_AUTH_AND_RETRY_PROJECTION';
const KEY_ALGORITHM = 'AES-256-GCM';
const INITIAL_KEY_VERSION = 1;
const KEY_BYTES = 32;
const ACTOR_CONTEXT = Object.freeze({ actor: 'backend-core' });
const PRIVATE = new WeakMap();

function authorityError(code, message) {
  const error = new Error(message);
  error.name = 'WhatsAppAuthKeyAuthorityError';
  error.code = code;
  error.reasonCode = code;
  return error;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_AUTHORITY_INVALID',
      'WhatsApp auth key authority private state is unavailable'
    );
  }
  return state;
}

function stoppedError() {
  return authorityError(
    'WHATSAPP_AUTH_KEY_AUTHORITY_STOPPED',
    'WhatsApp auth key authority owner has been permanently stopped'
  );
}

function assertOperational(state) {
  if (state.stopped) throw stoppedError();
  if (state.terminalErrorCode) {
    throw authorityError(
      state.terminalErrorCode,
      'WhatsApp auth key authority is in a terminal failed state'
    );
  }
}

function secureStorageAvailable(securityGuard) {
  if (!securityGuard || securityGuard.available !== true) return false;
  if (typeof securityGuard.snapshot !== 'function') return true;
  const snapshot = securityGuard.snapshot();
  return snapshot?.secureStorageAvailable !== false;
}

function assertDependencies(state) {
  assertOperational(state);
  if (!secureStorageAvailable(state.securityGuard)) {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_SECURE_STORAGE_UNAVAILABLE',
      'CredentialVault secure storage is unavailable'
    );
  }
  if (!state.credentials
    || typeof state.credentials.get !== 'function'
    || typeof state.credentials.persist !== 'function') {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_CREDENTIAL_CAPABILITY_REQUIRED',
      'SecurityGuard credential capability is unavailable'
    );
  }
}

function decodeCanonicalKey(value) {
  if (typeof value !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/u.test(value)) {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_RECORD_INVALID',
      'CredentialVault WhatsApp key record is invalid'
    );
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== value) {
    key.fill(0);
    throw authorityError(
      'WHATSAPP_AUTH_KEY_RECORD_INVALID',
      'CredentialVault WhatsApp key record is invalid'
    );
  }
  return key;
}

function validateVaultRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_RECORD_MISSING',
      'CredentialVault WhatsApp key record is missing'
    );
  }
  if (record.algorithm !== KEY_ALGORITHM
    || record.purpose !== KEY_PURPOSE
    || record.keyVersion !== INITIAL_KEY_VERSION
    || !Number.isFinite(Date.parse(String(record.createdAt || '')))) {
    throw authorityError(
      'WHATSAPP_AUTH_KEY_RECORD_INVALID',
      'CredentialVault WhatsApp key record is invalid'
    );
  }
  const key = decodeCanonicalKey(record.keyBase64);
  return Object.freeze({
    key,
    keyVersion: record.keyVersion,
    createdAt: String(record.createdAt)
  });
}

function publicSnapshot(state) {
  let lifecycleState = 'created';
  if (state.stopped) lifecycleState = 'stopped';
  else if (state.terminalErrorCode) lifecycleState = 'failed';
  else if (state.cipher) lifecycleState = 'started';
  else if (state.prepared) lifecycleState = 'prepared';
  return Object.freeze({
    module: 'WhatsAppAuthKeyAuthority',
    state: lifecycleState,
    prepared: state.prepared,
    started: Boolean(state.cipher),
    keyReference: KEY_REFERENCE,
    algorithm: KEY_ALGORITHM,
    purpose: KEY_PURPOSE,
    keyVersion: state.keyVersion,
    createdAt: state.createdAt,
    startInFlight: Boolean(state.startPromise),
    terminalReasonCode: state.terminalErrorCode || ''
  });
}

function digestKey(key) {
  return crypto.createHash('sha256').update(key).digest();
}

function sameCandidate(expected, validated) {
  if (!expected) return true;
  const actualDigest = digestKey(validated.key);
  try {
    return expected.keyVersion === validated.keyVersion
      && expected.createdAt === validated.createdAt
      && expected.keyDigest.length === actualDigest.length
      && crypto.timingSafeEqual(expected.keyDigest, actualDigest);
  } finally {
    actualDigest.fill(0);
  }
}

class WhatsAppAuthKeyAuthority {
  constructor(options = {}) {
    const securityGuard = options.securityGuard;
    const credentials = options.credentials || securityGuard?.credentials;
    PRIVATE.set(this, {
      securityGuard,
      credentials,
      prepared: false,
      stopped: false,
      terminalErrorCode: '',
      cipher: null,
      keyVersion: null,
      createdAt: '',
      startPromise: null
    });
    Object.freeze(this);
  }

  async prepare() {
    const state = stateFor(this);
    assertDependencies(state);
    state.prepared = true;
    return publicSnapshot(state);
  }

  async start() {
    const state = stateFor(this);
    assertOperational(state);
    if (state.cipher) return publicSnapshot(state);
    if (state.startPromise) return state.startPromise;

    const operation = (async () => {
      if (!state.prepared) await this.prepare();
      assertDependencies(state);

      let expectedCandidate = null;
      let validated = null;
      try {
        let record = state.credentials.get(KEY_REFERENCE, ACTOR_CONTEXT);
        if (record == null) {
          const generatedKey = crypto.randomBytes(KEY_BYTES);
          let keyBase64 = '';
          try {
            keyBase64 = generatedKey.toString('base64');
            const createdAt = new Date().toISOString();
            expectedCandidate = {
              keyVersion: INITIAL_KEY_VERSION,
              createdAt,
              keyDigest: digestKey(generatedKey)
            };
            const persisted = await state.credentials.persist(
              KEY_REFERENCE,
              Object.freeze({
                algorithm: KEY_ALGORITHM,
                keyVersion: INITIAL_KEY_VERSION,
                keyBase64,
                createdAt,
                purpose: KEY_PURPOSE
              }),
              ACTOR_CONTEXT
            );
            if (persisted !== true) {
              throw authorityError(
                'WHATSAPP_AUTH_KEY_PERSIST_FAILED',
                'CredentialVault did not persist the WhatsApp auth key'
              );
            }
          } finally {
            generatedKey.fill(0);
            keyBase64 = '';
          }
        }

        assertOperational(state);
        record = state.credentials.get(KEY_REFERENCE, ACTOR_CONTEXT);
        validated = validateVaultRecord(record);
        if (!sameCandidate(expectedCandidate, validated)) {
          state.terminalErrorCode = 'WHATSAPP_AUTH_KEY_AUTHORITY_CONFLICT';
          throw authorityError(
            'WHATSAPP_AUTH_KEY_AUTHORITY_CONFLICT',
            'CredentialVault authoritative reread conflicts with the persisted candidate'
          );
        }
        assertOperational(state);
        state.cipher = createWhatsAppAuthCipher({
          key: validated.key,
          keyVersion: validated.keyVersion,
          cipherVersion: 1
        });
        state.keyVersion = validated.keyVersion;
        state.createdAt = validated.createdAt;
        return publicSnapshot(state);
      } finally {
        if (validated?.key) validated.key.fill(0);
        if (expectedCandidate?.keyDigest) expectedCandidate.keyDigest.fill(0);
      }
    })();

    state.startPromise = operation;
    try {
      return await operation;
    } finally {
      if (state.startPromise === operation) state.startPromise = null;
    }
  }

  getCipher() {
    const state = stateFor(this);
    if (!state.cipher) {
      throw authorityError(
        'WHATSAPP_AUTH_KEY_AUTHORITY_NOT_STARTED',
        'WhatsApp auth key authority has not started'
      );
    }
    return state.cipher;
  }

  async rotate() {
    const state = stateFor(this);
    assertOperational(state);
    throw authorityError(
      'WHATSAPP_AUTH_KEY_ROTATION_REQUIRES_KEYRING',
      'WhatsApp auth key rotation requires a versioned keyring migration'
    );
  }

  async stop() {
    const state = stateFor(this);
    if (state.stopped) return publicSnapshot(state);
    state.stopped = true;
    const inFlight = state.startPromise;
    if (inFlight) {
      try { await inFlight; } catch (_) {}
    }
    if (state.cipher) state.cipher.close();
    state.cipher = null;
    state.keyVersion = null;
    state.createdAt = '';
    state.prepared = false;
    return publicSnapshot(state);
  }

  snapshot() {
    return publicSnapshot(stateFor(this));
  }
}

Object.freeze(WhatsAppAuthKeyAuthority.prototype);

function createWhatsAppAuthKeyAuthority(options = {}) {
  return new WhatsAppAuthKeyAuthority(options);
}

module.exports = Object.freeze({
  KEY_REFERENCE,
  KEY_PURPOSE,
  KEY_ALGORITHM,
  INITIAL_KEY_VERSION,
  WhatsAppAuthKeyAuthority,
  createWhatsAppAuthKeyAuthority
});
