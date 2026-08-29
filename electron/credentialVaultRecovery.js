'use strict';

const fs = require('fs');
const path = require('path');
const { SECURE_STORAGE_UNAVAILABLE } = require('./credentialVault');
const { recoverGraphitiNeo4jCredential } = require('./graphitiNeo4jCredentialProvisioning');

async function candidateVaultFiles(roots = [], destinationFile = '') {
  const destination = destinationFile ? path.resolve(destinationFile) : '';
  const result = [];
  const seen = new Set();
  const relativeCandidates = [
    path.join('secure', 'credentials.safe.json'),
    path.join('security', 'credentials.safe.json'),
    'credentials.safe.json'
  ];
  const p = fs.promises;
  for (const root of roots) {
    for (const relative of relativeCandidates) {
      const file = path.resolve(String(root), relative);
      if (file === destination || seen.has(file)) continue;
      try {
        const stat = await p.stat(file);
        if (!stat.isFile()) continue;
        const parsed = JSON.parse((await p.readFile(file, 'utf8')) || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      } catch (_) { continue; }
      seen.add(file);
      result.push(file);
    }
  }
  return result;
}

function errorReasonCode(error) {
  return String(error?.reasonCode || error?.code || '');
}

function readVaultRef(vault, ref) {
  if (typeof vault.getRequired === 'function') return vault.getRequired(ref);
  if (typeof vault.get === 'function') return vault.get(ref);
  throw new Error('CREDENTIAL_VAULT_REF_READ_REQUIRED');
}

async function recoverCredentialVaults(options = {}) {
  const destinationVault = options.destinationVault;
  const credentialVaultHost = options.credentialVaultHost;
  const createVault = options.createVault;
  if (!destinationVault || !credentialVaultHost || typeof credentialVaultHost.persistFromMigration !== 'function' || typeof createVault !== 'function') {
    throw new Error('CREDENTIAL_VAULT_RECOVERY_ARGUMENTS_REQUIRED');
  }
  const files = await candidateVaultFiles(options.legacyRoots || [], options.destinationFile || destinationVault.file || '');
  if (typeof credentialVaultHost.initialize === 'function') await credentialVaultHost.initialize();
  const report = {
    ok: true,
    scannedFiles: files.length,
    importedRefs: [],
    replacedUnreadableRefs: [],
    skippedRefs: [],
    unreadableRefs: [],
    sources: [],
    portability: 'same-machine-user-only',
    at: new Date().toISOString()
  };

  const destinationRefs = new Set(credentialVaultHost.refs());
  const existingReadable = new Set();
  const destinationUnreadable = new Map();
  for (const ref of destinationRefs) {
    try {
      credentialVaultHost.get(ref);
      existingReadable.add(ref);
    } catch (error) {
      const reasonCode = errorReasonCode(error);
      if (reasonCode === SECURE_STORAGE_UNAVAILABLE) throw error;
      destinationUnreadable.set(ref, error);
    }
  }

  for (const file of files) {
    try {
      const sourceVault = createVault(file);
      if (typeof sourceVault.load === 'function') await sourceVault.load();
      const sourceRefs = typeof sourceVault.refs === 'function' ? sourceVault.refs() : [];
      let readable = 0;
      const sourceReport = { file, readable: 0, total: sourceRefs.length };
      for (const ref of sourceRefs) {
        if (existingReadable.has(ref)) {
          report.skippedRefs.push({ ref, file, reason: 'destination-already-has-readable-ref' });
          continue;
        }
        let value;
        try {
          value = readVaultRef(sourceVault, ref);
          if (value === null) throw Object.assign(new Error('Credential vault reference is unreadable'), { reasonCode: 'CREDENTIAL_VAULT_DECRYPT_FAILED' });
          readable += 1;
        } catch (error) {
          const reasonCode = errorReasonCode(error);
          if (reasonCode === SECURE_STORAGE_UNAVAILABLE) throw error;
          report.unreadableRefs.push({ ref, file, reason: 'safe-storage-decryption-failed', reasonCode });
          continue;
        }
        const replacedUnreadable = destinationUnreadable.has(ref);
        await credentialVaultHost.persistFromMigration(ref, value, { applicationLeaseToken: options.applicationLeaseToken || null });
        destinationRefs.add(ref);
        existingReadable.add(ref);
        destinationUnreadable.delete(ref);
        if (replacedUnreadable) report.replacedUnreadableRefs.push({ ref, file, reason: 'readable-legacy-source' });
        else report.importedRefs.push({ ref, file });
      }
      sourceReport.readable = readable;
      report.sources.push(sourceReport);
    } catch (error) {
      if (errorReasonCode(error) === SECURE_STORAGE_UNAVAILABLE) throw error;
      report.ok = false;
      report.sources.push({ file, error: error.message, reasonCode: errorReasonCode(error) });
    }
  }

  const recoverSystemCredential = typeof options.recoverSystemCredential === 'function'
    ? options.recoverSystemCredential
    : recoverGraphitiNeo4jCredential;
  for (const [ref, readError] of [...destinationUnreadable.entries()]) {
    const recovered = await recoverSystemCredential({
      ref,
      readError,
      credentialVaultHost,
      applicationLeaseToken: options.applicationLeaseToken || null
    });
    if (recovered?.recovered === true) {
      destinationUnreadable.delete(ref);
      existingReadable.add(ref);
      report.replacedUnreadableRefs.push({ ref, file: options.destinationFile || destinationVault.file || '', reason: 'rotatable-system-credential-regenerated', reasonCode: errorReasonCode(readError) });
    }
  }

  for (const [ref, error] of destinationUnreadable.entries()) {
    report.ok = false;
    report.unreadableRefs.push({
      ref,
      file: options.destinationFile || destinationVault.file || '',
      reason: 'destination-remains-unreadable',
      reasonCode: errorReasonCode(error)
    });
  }
  return report;
}

module.exports = { candidateVaultFiles, recoverCredentialVaults };
