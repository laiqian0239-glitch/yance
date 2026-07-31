'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parseArgs(argv) {
  const roots = [];
  let preferredRoot = '';
  for (const arg of argv) {
    if (arg.startsWith('--root=')) roots.push(arg.slice('--root='.length));
    else if (arg.startsWith('--preferred-root=')) preferredRoot = arg.slice('--preferred-root='.length);
    else throw Object.assign(new Error(`不支持的参数：${arg}`), { reasonCode: 'WHATSAPP_AUTH_SOURCE_ARGUMENT_INVALID' });
  }
  return { roots, preferredRoot };
}
function safeStat(file) { try { return fs.statSync(file); } catch (_) { return null; } }
function walkFiles(root) {
  const files = [];
  if (!safeStat(root)?.isDirectory()) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}
function readCreds(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const identity = String(value?.me?.id || value?.me?.lid || '').trim();
    return {
      usable: Boolean(identity),
      registered: value?.registered === true,
      identityHash: identity ? sha256(identity).slice(0, 16) : ''
    };
  } catch (_) {
    return { usable: false, registered: false, identityHash: '' };
  }
}
function inspectSession(authRoot, credsFile, directoryName) {
  const sourceDirectory = path.dirname(credsFile);
  const files = walkFiles(sourceDirectory);
  const credential = readCreds(credsFile);
  const newestMtimeMs = files.reduce((value, file) => Math.max(value, Number(safeStat(file)?.mtimeMs || 0)), 0);
  const relative = path.relative(authRoot, sourceDirectory).replace(/\\/g, '/') || '.';
  return {
    authDirectory: directoryName,
    accountDirectory: relative,
    sourceDirectory,
    credsFile,
    fileCount: files.length,
    newestMtimeMs,
    ...credential
  };
}
function inspectAuthDirectory(root, relative) {
  const directory = path.join(root, relative);
  const files = walkFiles(directory);
  const credentialRows = files
    .filter(file => path.basename(file).toLowerCase() === 'creds.json')
    .map(file => inspectSession(directory, file, relative));
  return {
    relative,
    exists: Boolean(safeStat(directory)?.isDirectory()),
    fileCount: files.length,
    credentialCount: credentialRows.length,
    usableCredentialCount: credentialRows.filter(row => row.usable).length,
    registeredCredentialCount: credentialRows.filter(row => row.registered).length,
    newestMtimeMs: credentialRows.reduce((value, row) => Math.max(value, row.newestMtimeMs), 0),
    credentialRows
  };
}
function inspectSource(root) {
  const resolved = path.resolve(root || '.');
  const current = inspectAuthDirectory(resolved, 'whatsapp-auth');
  const legacy = inspectAuthDirectory(resolved, 'baileys-auth');
  const credentials = [...current.credentialRows, ...legacy.credentialRows].map(row => ({ ...row, root: resolved }));
  return {
    root: resolved,
    exists: Boolean(safeStat(resolved)?.isDirectory()),
    current,
    legacy,
    credentials,
    usableCredentialCount: credentials.filter(row => row.usable).length,
    registeredCredentialCount: credentials.filter(row => row.registered).length,
    fileCount: current.fileCount + legacy.fileCount,
    newestMtimeMs: Math.max(current.newestMtimeMs, legacy.newestMtimeMs),
    pass: credentials.some(row => row.usable)
  };
}
function preferredSessions(preferredRoot = '') {
  if (!preferredRoot) return [];
  const preferred = inspectSource(preferredRoot);
  return preferred.credentials.filter(row => row.usable || row.registered);
}
function credentialScore(row, preferred = [], preferredRoot = '') {
  const matchingIdentity = row.identityHash && preferred.some(item => item.identityHash === row.identityHash);
  const matchingDirectory = preferred.some(item => item.accountDirectory === row.accountDirectory);
  const fromPreferredRoot = preferredRoot && path.resolve(row.root) === path.resolve(preferredRoot);
  return (row.registered ? 10000 : 0)
    + (row.usable ? 5000 : 0)
    + (matchingIdentity ? 40000 : 0)
    + (!row.identityHash && matchingDirectory ? 200 : 0)
    + (!matchingIdentity && fromPreferredRoot ? 50 : 0)
    + Math.min(2500, row.fileCount * 5)
    + Math.min(999, Math.floor(row.newestMtimeMs / 1e10));
}
function targetDirectoryFor(row, preferred = []) {
  const byIdentity = row.identityHash ? preferred.find(item => item.identityHash === row.identityHash) : null;
  if (byIdentity?.accountDirectory) return byIdentity.accountDirectory;
  const byDirectory = preferred.find(item => item.accountDirectory === row.accountDirectory);
  if (byDirectory?.accountDirectory) return byDirectory.accountDirectory;
  return row.accountDirectory || '.';
}
function selectSource(roots = [], options = {}) {
  const preferredRoot = options.preferredRoot ? path.resolve(options.preferredRoot) : '';
  const unique = [...new Set(roots.filter(Boolean).map(root => path.resolve(root)))];
  if (preferredRoot && !unique.includes(preferredRoot)) unique.unshift(preferredRoot);
  const candidates = unique.map(inspectSource);
  const preferred = preferredSessions(preferredRoot);
  const credentials = candidates.flatMap(source => source.credentials.map(row => ({
    ...row,
    selectionScore: credentialScore(row, preferred, preferredRoot),
    targetAccountDirectory: targetDirectoryFor(row, preferred)
  })));
  const selectedCredential = credentials
    .filter(row => row.usable)
    .sort((left, right) => right.selectionScore - left.selectionScore
      || Number(right.registered) - Number(left.registered)
      || right.newestMtimeMs - left.newestMtimeMs
      || right.fileCount - left.fileCount
      || left.sourceDirectory.localeCompare(right.sourceDirectory))[0] || null;
  return {
    schemaVersion: 2,
    documentType: 'YANCE_WHATSAPP_AUTH_SOURCE_SELECTION',
    status: selectedCredential ? 'PASS' : 'NOT_FOUND',
    preferredRoot,
    selectedRoot: selectedCredential?.root || '',
    selectedSessionDirectory: selectedCredential?.sourceDirectory || '',
    selectedAuthDirectory: selectedCredential?.authDirectory || '',
    selectedAccountDirectory: selectedCredential?.accountDirectory || '',
    targetAccountDirectory: selectedCredential?.targetAccountDirectory || '',
    selectedIdentityHash: selectedCredential?.identityHash || '',
    selectionReason: selectedCredential ? 'MATCHED_REGISTERED_ACCOUNT_SESSION_NOT_GLOBAL_ROOT' : 'NO_USABLE_WHATSAPP_CREDENTIALS',
    selectedSummary: selectedCredential ? {
      registered: selectedCredential.registered,
      usable: selectedCredential.usable,
      registeredCredentialCount: selectedCredential.registered ? 1 : 0,
      usableCredentialCount: selectedCredential.usable ? 1 : 0,
      fileCount: selectedCredential.fileCount,
      newestMtimeMs: selectedCredential.newestMtimeMs,
      selectionScore: selectedCredential.selectionScore,
      identityHash: selectedCredential.identityHash
    } : null,
    preferredSessions: preferred.map(row => ({ authDirectory: row.authDirectory, accountDirectory: row.accountDirectory, registered: row.registered, usable: row.usable, identityHash: row.identityHash })),
    candidates
  };
}
function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = selectSource(options.roots, { preferredRoot: options.preferredRoot });
  process.stdout.write(canonicalJson(result));
  if (result.status !== 'PASS') process.exitCode = 2;
}
if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(canonicalJson({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'WHATSAPP_AUTH_SOURCE_SELECTION_FAILED', message: error.message }));
    process.exitCode = 1;
  }
}
module.exports = { inspectAuthDirectory, inspectSource, selectSource, preferredSessions, credentialScore };
