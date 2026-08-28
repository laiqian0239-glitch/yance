#!/usr/bin/env node
'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { validateJournal, headEvent } = require('../../electron/desktopHost/credentialAuthority');
const { lifecycleSafeStorage, paths, seedLegacyVault, writeJson } = require('./credential-authority-lifecycle-fixture');

const ROOT = path.resolve(__dirname, '../..');
const CHILD = path.join(__dirname, 'credential-authority-lifecycle-child.js');
const GENESIS_POINTS = Object.freeze([
  'GENESIS_BEFORE_ANY_FILE', 'GENESIS_AFTER_INTENT', 'GENESIS_AFTER_VAULT_ATOMIC_REPLACE',
  'GENESIS_AFTER_JOURNAL', 'GENESIS_BEFORE_METADATA', 'GENESIS_AFTER_METADATA',
  'GENESIS_BEFORE_COMPLETED_MARKER', 'GENESIS_AFTER_COMPLETED_MARKER', 'AUTHORITY_ACTIVE_BEFORE_FIRST_FD5'
]);
const MIGRATION_POINTS = Object.freeze([
  'MIGRATION_AFTER_LEGACY_READ', 'MIGRATION_AFTER_INTENT', 'MIGRATION_AFTER_JOURNAL',
  'MIGRATION_BEFORE_METADATA', 'MIGRATION_AFTER_METADATA', 'MIGRATION_BEFORE_COMPLETED_MARKER',
  'MIGRATION_AFTER_COMPLETED_MARKER', 'MIGRATION_AFTER_COMPLETION_BEFORE_FIRST_FD5'
]);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function makeHost(root, safeStorage = lifecycleSafeStorage()) {
  const p = paths(root);
  const vault = new CredentialVault(p.vaultFile, { safeStorage });
  return new CredentialVaultHost({ vault, metadataPath: p.metadataPath, transactionPath: p.transactionPath, lifecycleIntentPath: p.intentPath, lifecycleCompletedPath: p.completedPath });
}
function runChild(root, point, mode = 'SIGKILL') {
  return childProcess.spawnSync(process.execPath, [CHILD, root, point, mode], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
}

async function verifyActive(root, expectedRefs, operationType) {
  const p = paths(root);
  const host = makeHost(root);
  await host.initialize();
  const before = host.snapshotMetadata();
  const refs = host.refs().slice().sort();
  const frameResult = await host.createHydrationFrame({
    startupNonce: `matrix-${operationType}`, backendSessionId: `matrix-${operationType}-session`, fd6PipeInstanceId: `matrix-${operationType}-fd6`,
    oneTimeToken: 'z'.repeat(43), backendPid: process.pid, manifestSha256: 'b'.repeat(64)
  });
  const frame = frameResult.frame;
  const journal = read(p.transactionPath); validateJournal(journal);
  const marker = read(p.completedPath);
  const genesisEvents = journal.authorityEvents.filter(event => ['GENESIS', 'MIGRATION_GENESIS'].includes(event.eventType));
  const second = makeHost(root);
  await second.initialize();
  const after = second.snapshotMetadata();
  const checks = {
    authorityActive: before.lifecycle.state === 'ACTIVE',
    expectedOperation: before.lifecycle.operationType === operationType,
    referencesPreserved: JSON.stringify(refs) === JSON.stringify([...expectedRefs].sort()),
    uniqueInitialAuthority: genesisEvents.length === 1,
    uniqueVaultEpoch: marker.vaultEpoch === genesisEvents[0]?.vaultEpoch && after.vaultEpoch === before.vaultEpoch,
    generationAdvancedOnceByFd5: before.generation === 0 && frame.generation === 1 && after.generation === 1,
    journalChainValid: headEvent(journal).generation === 1,
    metadataMatchesHead: after.authorityHeadDigest === headEvent(journal).eventDigest,
    noActiveTransaction: after.activeTransactionId === '',
    intentCleared: !fs.existsSync(p.intentPath),
    completedMarkerPresent: fs.existsSync(p.completedPath)
  };
  const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
  return {
    status: failed.length ? 'FAIL' : 'PASS', checks, failed,
    vaultEpoch: before.vaultEpoch, metadataGeneration: after.generation,
    journalTransactionCount: Object.keys(journal.transactions || {}).length,
    authorityEventCount: journal.authorityEvents.length, latestAuthorityGeneration: headEvent(journal).generation,
    vaultReferenceCount: refs.length, decryptedEntryCount: second.entriesStrict().length,
    frameEntryCount: frame.payload.entries.length, activeTransactionId: after.activeTransactionId,
    backendFinalState: 'NOT_STARTED_AUTHORITY_ONLY', secretValueRecorded: false, secretHashRecorded: false
  };
}
async function scenario(kind, point, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-${kind.toLowerCase()}-`));
  try {
    const expectedRefs = kind === 'MIGRATION' ? entries.map(([ref]) => ref) : [];
    if (kind === 'MIGRATION') seedLegacyVault(root, entries);
    const child = runChild(root, point);
    const crashed = child.status !== 0 || Boolean(child.signal);
    const verified = await verifyActive(root, expectedRefs, kind);
    return { id: `${kind}_${point}`, kind, crashPoint: point, status: crashed && verified.status === 'PASS' ? 'PASS' : 'FAIL', exitCode: child.status, terminationSignal: child.signal || '', stderrTail: String(child.stderr || '').slice(-1000), ...verified };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
async function baselineCase(id, kind, entries, createLegacyFile = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-${id.toLowerCase()}-`));
  try {
    const p = paths(root);
    if (kind === 'MIGRATION') {
      if (createLegacyFile && entries.length === 0) writeJson(p.vaultFile, {});
      else seedLegacyVault(root, entries);
    }
    const expectedRefs = entries.map(([ref]) => ref);
    const verified = await verifyActive(root, expectedRefs, kind);
    return { id, kind, crashPoint: 'NONE_BASELINE', status: verified.status, exitCode: 0, terminationSignal: '', ...verified };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
async function migrationFailurePreservesLegacyVaultCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-migration-failure-preservation-'));
  try {
    const entries = [['legacy/one', { token: 'redacted-one' }], ['legacy/two', { token: 'redacted-two' }]];
    const seeded = seedLegacyVault(root, entries);
    const p = seeded.paths;
    const originalBytes = fs.readFileSync(p.vaultFile);
    const originalRaw = read(p.vaultFile);
    const child = runChild(root, 'MIGRATION_AFTER_INTENT', 'THROW');
    const childFailed = child.status !== 0 || Boolean(child.signal);
    const bytesAfterFailure = fs.existsSync(p.vaultFile) ? fs.readFileSync(p.vaultFile) : Buffer.alloc(0);
    const byteExactPreserved = originalBytes.equals(bytesAfterFailure);
    let strictRefsAfterFailure = [];
    let strictDecryptAfterFailure = false;
    try {
      const legacyVault = new CredentialVault(p.vaultFile, { safeStorage: lifecycleSafeStorage() });
      await legacyVault.load();
      strictRefsAfterFailure = legacyVault.entriesStrict().map(([ref]) => ref).sort();
      strictDecryptAfterFailure = JSON.stringify(strictRefsAfterFailure) === JSON.stringify(entries.map(([ref]) => ref).sort());
    } catch (_) {}

    let recovery = null;
    let recoveryReasonCode = '';
    try {
      recovery = await verifyActive(root, entries.map(([ref]) => ref), 'MIGRATION');
    } catch (cause) {
      recoveryReasonCode = cause.reasonCode || cause.code || cause.message || 'UNKNOWN';
    }
    const rawAfterRecovery = fs.existsSync(p.vaultFile) ? read(p.vaultFile) : null;
    const recoveryPreservedSourceImage = rawAfterRecovery && JSON.stringify(rawAfterRecovery) === JSON.stringify(originalRaw);
    const checks = {
      realChildFailureObserved: childFailed,
      injectedFailureReported: String(child.stderr || '').includes('WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_INJECTED_FAILURE'),
      originalVaultByteExactAfterFailure: byteExactPreserved,
      originalVaultStrictlyDecryptableAfterFailure: strictDecryptAfterFailure,
      originalReferenceCountPreservedAfterFailure: strictRefsAfterFailure.length === entries.length,
      sameMigrationResumedToActive: recovery?.status === 'PASS',
      sourceVaultImagePreservedThroughRecovery: Boolean(recoveryPreservedSourceImage)
    };
    const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
    return {
      id: 'MIGRATION_INJECTED_FAILURE_AFTER_INTENT_PRESERVES_LEGACY_VAULT',
      kind: 'MIGRATION', crashPoint: 'MIGRATION_AFTER_INTENT_THROW',
      status: failed.length ? 'FAIL' : 'PASS', checks, failed,
      exitCode: child.status, terminationSignal: child.signal || '', stderrTail: String(child.stderr || '').slice(-1000),
      recoveryReasonCode, vaultReferenceCount: strictRefsAfterFailure.length,
      decryptedEntryCount: strictRefsAfterFailure.length, frameEntryCount: recovery?.frameEntryCount ?? 0,
      metadataGeneration: recovery?.metadataGeneration ?? 0,
      journalTransactionCount: recovery?.journalTransactionCount ?? 0,
      latestAuthorityGeneration: recovery?.latestAuthorityGeneration ?? 0,
      activeTransactionId: recovery?.activeTransactionId ?? '',
      backendFinalState: recovery?.status === 'PASS' ? 'NOT_STARTED_AUTHORITY_ONLY' : 'NOT_STARTED_FAIL_CLOSED',
      secretValueRecorded: false, secretHashRecorded: false
    };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function negativeCases() {
  const rows = [];
  for (const type of ['STRUCTURE_CORRUPTED', 'DECRYPT_FAILED']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-migration-negative-'));
    try {
      const p = paths(root);
      if (type === 'STRUCTURE_CORRUPTED') writeJson(p.vaultFile, []);
      else { seedLegacyVault(root, [['legacy/corrupt', { token: 'redacted' }]]); const raw = read(p.vaultFile); raw['legacy/corrupt'].encrypted = Buffer.from('corrupted').toString('base64'); writeJson(p.vaultFile, raw); }
      let reasonCode = '';
      try { const host = makeHost(root); await host.initialize(); } catch (error) { reasonCode = error.reasonCode || error.code || ''; }
      const preserved = fs.existsSync(p.vaultFile) && fs.statSync(p.vaultFile).size > 0;
      const pass = Boolean(reasonCode) && preserved && !fs.existsSync(p.completedPath);
      rows.push({ id: `MIGRATION_${type}`, kind: 'MIGRATION', crashPoint: type, status: pass ? 'PASS' : 'FAIL', reasonCode, originalVaultPreserved: preserved, metadataGeneration: 0, journalTransactionCount: 0, vaultReferenceCount: type === 'DECRYPT_FAILED' ? 1 : 'UNREADABLE', decryptedEntryCount: 0, frameEntryCount: 0, activeTransactionId: '', backendFinalState: 'NOT_STARTED_FAIL_CLOSED', secretValueRecorded: false, secretHashRecorded: false });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  return rows;
}
async function runCredentialAuthorityLifecycleMatrix() {
  const rows = [
    await baselineCase('GENESIS_CLEAN_FIRST_START', 'GENESIS', []),
    await baselineCase('MIGRATION_EMPTY_WP3_VAULT', 'MIGRATION', [], true),
    await baselineCase('MIGRATION_MULTI_REFERENCE_WP3_VAULT', 'MIGRATION', [['legacy/one', { token: 'redacted-one' }], ['legacy/two', { token: 'redacted-two' }]])
  ];
  for (const point of GENESIS_POINTS) rows.push(await scenario('GENESIS', point, []));
  for (const point of MIGRATION_POINTS) rows.push(await scenario('MIGRATION', point, [['legacy/one', { token: 'redacted-one' }], ['legacy/two', { token: 'redacted-two' }]]));
  rows.push(await migrationFailurePreservesLegacyVaultCase());
  rows.push(...await negativeCases());
  const failedCaseIds = rows.filter(row => row.status !== 'PASS').map(row => row.id);
  const value = { schemaVersion: 1, matrix: 'CREDENTIAL_AUTHORITY_LIFECYCLE', status: failedCaseIds.length ? 'FAIL' : 'PASS', caseCount: rows.length, passCount: rows.length - failedCaseIds.length, failedCaseIds, genesisCrashPointCount: GENESIS_POINTS.length, migrationCrashPointCount: MIGRATION_POINTS.length, cases: rows, secretValueRecorded: false, secretHashRecorded: false };
  if (failedCaseIds.length) { const error = new Error(`Credential authority lifecycle matrix failed: ${failedCaseIds.join(', ')}`); error.reasonCode = 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_MATRIX_FAILED'; error.matrix = value; throw error; }
  return value;
}
module.exports = { GENESIS_POINTS, MIGRATION_POINTS, runCredentialAuthorityLifecycleMatrix };
if (require.main === module) runCredentialAuthorityLifecycleMatrix().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_MATRIX_FAILED'} ${error.stack || error.message}\n`); if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`); process.exit(1); });
