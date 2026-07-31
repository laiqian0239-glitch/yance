'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'YANCE_FACEBOOK_GATEWAY_AES_256_GCM_V1';

function clone(value) { return structuredClone(value); }
function emptyState() { return { schemaVersion: 1, flows: {}, relays: {} }; }

class EncryptedStore {
  constructor({ filePath, key }) {
    if (!filePath) throw new TypeError('EncryptedStore filePath is required');
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('EncryptedStore key must be a 32-byte Buffer');
    this.filePath = path.resolve(filePath);
    this.key = Buffer.from(key);
    this.state = this._read();
  }

  _read() {
    if (!fs.existsSync(this.filePath)) return emptyState();
    const envelope = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (envelope?.format !== FORMAT) throw Object.assign(new Error('Facebook Gateway encrypted store format is unsupported'), { code: 'FACEBOOK_GATEWAY_STORE_FORMAT_INVALID' });
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw Object.assign(new Error('Facebook Gateway encrypted store envelope is invalid'), { code: 'FACEBOOK_GATEWAY_STORE_ENVELOPE_INVALID' });
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const state = JSON.parse(plaintext.toString('utf8'));
      if (state?.schemaVersion !== 1 || typeof state.flows !== 'object' || typeof state.relays !== 'object') throw new Error('state schema invalid');
      return state;
    } catch (cause) {
      throw Object.assign(new Error('Facebook Gateway encrypted store authentication failed'), { code: 'FACEBOOK_GATEWAY_STORE_AUTH_FAILED', cause });
    }
  }

  snapshot() { return clone(this.state); }

  save(nextState) {
    const state = clone(nextState || emptyState());
    const plaintext = Buffer.from(JSON.stringify(state));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
      format: FORMAT,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch (_) {}
    this.state = state;
    return this.snapshot();
  }
}

module.exports = { EncryptedStore, FORMAT, emptyState };
