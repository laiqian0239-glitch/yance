'use strict';

const fs = require('fs');
const path = require('path');

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
  const existingReadable = new Set(credentialVaultHost.entries().map(([ref]) => ref));
  for (const file of files) {
    try {
      const sourceVault = createVault(file);
      if (typeof sourceVault.load === 'function') await sourceVault.load();
      const readableEntries = new Map(sourceVault.entries());
      const sourceReport = { file, readable: readableEntries.size, total: sourceVault.refs().length };
      for (const ref of sourceVault.refs()) {
        if (existingReadable.has(ref)) {
          report.skippedRefs.push({ ref, file, reason: 'destination-already-has-readable-ref' });
          continue;
        }
        if (!readableEntries.has(ref)) {
          report.unreadableRefs.push({ ref, file, reason: 'safe-storage-decryption-failed' });
          continue;
        }
        const replacedUnreadable = destinationRefs.has(ref);
        await credentialVaultHost.persistFromMigration(ref, readableEntries.get(ref), { applicationLeaseToken: options.applicationLeaseToken || null });
        destinationRefs.add(ref);
        existingReadable.add(ref);
        if (replacedUnreadable) report.replacedUnreadableRefs.push({ ref, file });
        else report.importedRefs.push({ ref, file });
      }
      report.sources.push(sourceReport);
    } catch (error) {
      report.ok = false;
      report.sources.push({ file, error: error.message, reasonCode: error.reasonCode || error.code || '' });
    }
  }
  return report;
}

module.exports = { candidateVaultFiles, recoverCredentialVaults };
