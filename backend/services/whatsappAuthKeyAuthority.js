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

function secureStorageAvailable(securityGuard) {
  if (!securityGuard || securityGuard.available !== true) return false;
  if (typeof securityGuard.snapshot !== 'function') return true;
  const snapshot = securityGuard.snapshot();
  return snapshot?.secureStorageAvailable !== false;
}

function assertDependencies(state) {
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
  return Object.freeze({
    module: 'WhatsAppAuthKeyAuthority',
    state: state.cipher ? 'started' : (state.prepared ? 'prepared' : 'created'),
    prepared: state.prepared,
    started: Boolean(state.cipher),
    keyReference: KEY_REFERENCE,
    algorithm: KEY_ALGORITHM,
    purpose: KEY_PURPOSE,
    keyVersion: state.keyVersion,
    createdAt: state.createdAt,
    startInFlight: Boolean(state.startPromise)
  });
}

class WhatsAppAuthKeyAuthority {
  constructor(options = {}) {
    const securityGuard = options.securityGuard;
    const credentials = options.credentials || securityGuard?.credentials;
    PRIVATE.set(this, {
      securityGuard,
      credentials,
      prepared: false,
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
    if (state.cipher) return publicSnapshot(state);
    if (state.startPromise) return state.startPromise;

    const operation = (async () => {
      if (!state.prepared) await this.prepare();
      assertDependencies(state);

      let record = state.credentials.get(KEY_REFERENCE, ACTOR_CONTEXT);
      if (record == null) {
        const generatedKey = crypto.randomBytes(KEY_BYTES);
        let keyBase64 = '';
        try {
          keyBase64 = generatedKey.toString('base64');
          const createdAt = new Date().toISOString();
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

      record = state.credentials.get(KEY_REFERENCE, ACTOR_CONTEXT);
      const validated = validateVaultRecord(record);
      try {
        state.cipher = createWhatsAppAuthCipher({
          key: validated.key,
          keyVersion: validated.keyVersion,
          cipherVersion: 1
        });
        state.keyVersion = validated.keyVersion;
        state.createdAt = validated.createdAt;
      } finally {
        validated.key.fill(0);
      }
      return publicSnapshot(state);
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
    throw authorityError(
      'WHATSAPP_AUTH_KEY_ROTATION_REQUIRES_KEYRING',
      'WhatsApp auth key rotation requires a versioned keyring migration'
    );
  }

  async stop() {
    const state = stateFor(this);
    if (state.startPromise) {
      try { await state.startPromise; } catch (_) {}
    }
    if (state.cipher) state.cipher.close();
    state.cipher = null;
    state.keyVersion = null;
    state.createdAt = '';
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
