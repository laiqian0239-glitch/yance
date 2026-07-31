'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');

function lifecycleSafeStorage(options = {}) {
  const key = crypto.createHash('sha256').update(options.keySeed || 'wp4-authority-lifecycle').digest();
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString(value) {
      if (options.encryptError) throw options.encryptError;
      const iv = Buffer.alloc(12, 17);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      if (options.decryptError) throw options.decryptError;
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
function paths(root) {
  const secure = path.join(root, 'secure');
  return {
    secure,
    vaultFile: path.join(secure, 'credentials.safe.json'),
    metadataPath: path.join(secure, 'vault-meta.json'),
    transactionPath: path.join(secure, 'credential-authority-journal.json'),
    intentPath: path.join(secure, 'credential-authority-lifecycle-intent.json'),
    completedPath: path.join(secure, 'credential-authority-completed.json')
  };
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function seedLegacyVault(root, entries = [['legacy/one', { token: 'redacted-one' }], ['legacy/two', { token: 'redacted-two' }]], options = {}) {
  const p = paths(root);
  const vault = new CredentialVault(p.vaultFile, { safeStorage: lifecycleSafeStorage(options) });
  let raw = {};
  for (const [ref, value] of entries) {
    vault.values = raw;
    raw = vault.prepareMutation('persist', ref, value).after;
  }
  writeJson(p.vaultFile, raw);
  return { paths: p, raw, refs: entries.map(([ref]) => ref) };
}
module.exports = { lifecycleSafeStorage, paths, seedLegacyVault, writeJson };
