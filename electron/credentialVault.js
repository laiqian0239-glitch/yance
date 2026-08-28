'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJsonAsync, readFileTextAsync } = require('./desktopHost/asyncDurability');

const DIRECT_MUTATION_FORBIDDEN = 'CREDENTIAL_VAULT_DIRECT_MUTATION_FORBIDDEN';
const DECRYPT_FAILED = 'CREDENTIAL_VAULT_DECRYPT_FAILED';
const ENTRY_CORRUPTED = 'CREDENTIAL_VAULT_ENTRY_CORRUPTED';
const SECURE_STORAGE_UNAVAILABLE = 'CREDENTIAL_VAULT_SECURE_STORAGE_UNAVAILABLE';

function resolveSafeStorage(injected) {
  if (injected) return injected;
  try { return require('electron').safeStorage; } catch (_) { return { isEncryptionAvailable: () => false }; }
}
function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
function error(reasonCode, message, details = {}) { const result = new Error(message || reasonCode); result.reasonCode = reasonCode; result.code = reasonCode; Object.assign(result, details); return result; }
function validBase64(value) {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try { return Buffer.from(value, 'base64').toString('base64') === value; } catch (_) { return false; }
}

class CredentialVault {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.fs = options.fs || fs;
    this.safeStorage = resolveSafeStorage(options.safeStorage);
    this.clock = options.clock || (() => new Date().toISOString());
    this.values = {};
    this.loadError = null;
    this.loadExists = false;
    this.mutationAuthorityToken = null;
    this._loadPromise = null;
    // Real disk load is deferred to an explicit awaitable initialize step so the
    // constructor never blocks the Electron main event loop. Callers must await
    // load() before reading this.values or treating loadError/loadExists as
    // authoritative.
  }

  get available() { return Boolean(this.safeStorage?.isEncryptionAvailable?.()); }

  async load() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      this.loadError = null;
      this.loadExists = false;
      let text = null;
      try {
        text = await readFileTextAsync(this.file, this.fs);
      } catch (cause) {
        this.values = {};
        this.loadError = cause;
        return;
      }
      if (text === null) { this.values = {}; return; } // ENOENT: fresh vault
      this.loadExists = true;
      try {
        const data = JSON.parse(text || '{}');
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw error(ENTRY_CORRUPTED, 'Credential vault root must be an object');
        this.values = data;
      } catch (cause) {
        this.values = {};
        this.loadError = cause;
      }
    })();
    return this._loadPromise;
  }

  bindMutationAuthority(token) {
    if (!token || (this.mutationAuthorityToken && this.mutationAuthorityToken !== token)) throw error(DIRECT_MUTATION_FORBIDDEN, 'Credential vault mutation authority cannot be rebound');
    this.mutationAuthorityToken = token;
    return true;
  }
  _assertMutationAuthority(token) {
    if (!this.mutationAuthorityToken || token !== this.mutationAuthorityToken) throw error(DIRECT_MUTATION_FORBIDDEN, 'Credential vault can only be modified by CredentialVaultHost');
  }

  async _atomicWrite(nextValues) {
    await atomicWriteJsonAsync(this.file, nextValues, { fsApi: this.fs });
  }

  async saveValues(nextValues, authorityToken) {
    this._assertMutationAuthority(authorityToken);
    const copy = clone(nextValues);
    await this._atomicWrite(copy);
    this.values = copy;
    this.loadExists = true;
    return true;
  }

  snapshotRaw() { return clone(this.values); }
  replaceRaw(nextValues, authorityToken) { return this.saveValues(nextValues, authorityToken); }

  _encryptedRow(value) {
    if (!this.available) throw error(SECURE_STORAGE_UNAVAILABLE, 'Operating-system secure credential storage is unavailable');
    let encrypted;
    try { encrypted = this.safeStorage.encryptString(JSON.stringify(value || {})); }
    catch (cause) { throw error('CREDENTIAL_VAULT_ENCRYPT_FAILED', 'Credential encryption failed', { cause }); }
    if (!Buffer.isBuffer(encrypted) && !(encrypted instanceof Uint8Array)) throw error('CREDENTIAL_VAULT_ENCRYPT_FAILED', 'Credential encryption did not return ciphertext');
    return { version: 1, encrypted: Buffer.from(encrypted).toString('base64'), updatedAt: this.clock(), portability: 'local-machine-user' };
  }

  prepareMutation(operation, ref, value) {
    const key = String(ref || '').trim();
    if (!key) throw error('INVALID_CREDENTIAL_REF', 'Credential reference is required');
    const before = this.snapshotRaw();
    const after = clone(before);
    if (operation === 'persist') after[key] = this._encryptedRow(value);
    else if (operation === 'remove') delete after[key];
    else throw error('CREDENTIAL_CUSTODY_OPERATION_INVALID', 'Credential custody operation is invalid');
    return Object.freeze({ operation, ref: key, before, after });
  }

  getRequired(ref) {
    const key = String(ref || '').trim();
    if (!key || !Object.prototype.hasOwnProperty.call(this.values, key)) return null;
    const row = this.values[key];
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.version !== 1 || !validBase64(row.encrypted)) throw error(ENTRY_CORRUPTED, 'Credential vault entry is malformed', { ref: key });
    if (!this.available) throw error(SECURE_STORAGE_UNAVAILABLE, 'Operating-system secure credential storage is unavailable', { ref: key });
    let plaintext;
    try { plaintext = this.safeStorage.decryptString(Buffer.from(row.encrypted, 'base64')); }
    catch (cause) { throw error(DECRYPT_FAILED, 'Credential vault entry decryption failed', { ref: key, cause }); }
    if (typeof plaintext !== 'string' || !plaintext) throw error(DECRYPT_FAILED, 'Credential vault entry decrypted to an invalid value', { ref: key });
    let value;
    try { value = JSON.parse(plaintext); }
    catch (cause) { throw error(ENTRY_CORRUPTED, 'Decrypted credential JSON is invalid', { ref: key, cause }); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(ENTRY_CORRUPTED, 'Decrypted credential value must be an object', { ref: key });
    return value;
  }

  get(ref) { return this.getRequired(ref); }
  refs() { return Object.keys(this.values); }
  entriesStrict() {
    const refs = this.refs().sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
    const entries = refs.map(ref => [ref, this.getRequired(ref)]);
    if (entries.length !== refs.length || entries.some(([, value]) => value === null)) throw error('CREDENTIAL_VAULT_HYDRATION_REFERENCE_MISMATCH', 'Credential vault references and decrypted entries do not match');
    return entries;
  }
  entries() { return this.entriesStrict(); }

  set() { throw error(DIRECT_MUTATION_FORBIDDEN, 'Direct CredentialVault.set is forbidden'); }
  remove() { throw error(DIRECT_MUTATION_FORBIDDEN, 'Direct CredentialVault.remove is forbidden'); }
  reset() { throw error(DIRECT_MUTATION_FORBIDDEN, 'Direct CredentialVault.reset is forbidden'); }
}

module.exports = {
  CredentialVault, DECRYPT_FAILED, DIRECT_MUTATION_FORBIDDEN, ENTRY_CORRUPTED,
  SECURE_STORAGE_UNAVAILABLE, validBase64
};
