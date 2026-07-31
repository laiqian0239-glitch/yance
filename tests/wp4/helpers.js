'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { BootCoordinator } = require('../../backend/runtime/BootCoordinator');
const { RuntimeOwnership } = require('../../backend/runtime/RuntimeOwnership');
const { CREDENTIAL_PROTOCOL_VERSION, makeCredentialFrame } = require('../../shared/credentialProtocol');

function temporaryRoot(prefix = 'yance-wp4-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function dbPath(root) { return path.join(root, 'store', 'runtime.db'); }
function sha(seed = 'a') { return crypto.createHash('sha256').update(seed).digest('hex'); }
function startup(overrides = {}) {
  const entries = overrides.entries || [];
  const authorityEventId = overrides.authorityEventId || crypto.randomUUID();
  const authorityHeadDigest = overrides.authorityHeadDigest || sha(`authority:${authorityEventId}`);
  return {
    buildId: 'WP4-TEST-BUILD',
    startupNonce: overrides.startupNonce || crypto.randomUUID(),
    apiSessionToken: 'a'.repeat(43),
    backendPid: overrides.backendPid || process.pid,
    manifestSha256: overrides.manifestSha256 || sha('manifest'),
    credentialProtocolVersion: CREDENTIAL_PROTOCOL_VERSION,
    credentialOneTimeToken: overrides.oneTimeToken || 'b'.repeat(43),
    credentialVaultEpoch: overrides.vaultEpoch || crypto.randomUUID(),
    credentialGeneration: Number(overrides.generation || 1),
    credentialAuthorityEventId: authorityEventId,
    credentialAuthorityHeadDigest: authorityHeadDigest,
    credentialVaultReferenceCount: Number(overrides.vaultReferenceCount ?? entries.length),
    credentialDecryptedEntryCount: Number(overrides.decryptedEntryCount ?? entries.length),
    credentialFrameEntryCount: Number(overrides.frameEntryCount ?? entries.length),
    credentialResetAuthorization: overrides.resetAuthorization || null
  };
}
function frameFor(context, overrides = {}) {
  const entries = overrides.entries || [];
  return makeCredentialFrame({
    startupNonce: overrides.startupNonce || context.startupNonce,
    oneTimeToken: overrides.oneTimeToken || context.credentialOneTimeToken,
    backendPid: overrides.backendPid || context.backendPid,
    manifestSha256: overrides.manifestSha256 || context.manifestSha256,
    vaultEpoch: overrides.vaultEpoch || context.credentialVaultEpoch,
    generation: overrides.generation || context.credentialGeneration || 1,
    authorityEventId: overrides.authorityEventId || context.credentialAuthorityEventId,
    authorityHeadDigest: overrides.authorityHeadDigest || context.credentialAuthorityHeadDigest,
    vaultReferenceCount: Number(overrides.vaultReferenceCount ?? entries.length),
    decryptedEntryCount: Number(overrides.decryptedEntryCount ?? entries.length),
    issuedAtUtc: overrides.issuedAtUtc || new Date().toISOString(),
    entries
  });
}
async function createOwnership(root, options = {}) {
  const ownership = new RuntimeOwnership({ dataRoot: root, dbPath: dbPath(root), buildId: 'WP4-TEST-BUILD', leaseDurationMs: 3000, heartbeatIntervalMs: 750, ...options });
  await ownership.acquire();
  return ownership;
}
async function createCredentialRuntime(options = {}) {
  const root = options.root || temporaryRoot();
  const context = options.context || startup();
  const entries = options.entries || [];
  const suppliedHydration = options.hydration || {};
  const hydrationEntries = suppliedHydration.entries || entries;
  const hydration = {
    vaultEpoch: suppliedHydration.vaultEpoch || context.credentialVaultEpoch,
    generation: Number(suppliedHydration.generation ?? context.credentialGeneration),
    authorityEventId: suppliedHydration.authorityEventId || context.credentialAuthorityEventId,
    authorityHeadDigest: suppliedHydration.authorityHeadDigest || context.credentialAuthorityHeadDigest,
    vaultReferenceCount: Number(suppliedHydration.vaultReferenceCount ?? hydrationEntries.length),
    decryptedEntryCount: Number(suppliedHydration.decryptedEntryCount ?? hydrationEntries.length),
    frameEntryCount: Number(suppliedHydration.frameEntryCount ?? hydrationEntries.length),
    payloadBytes: Number(suppliedHydration.payloadBytes ?? Buffer.byteLength(JSON.stringify({ entries: hydrationEntries }), 'utf8')),
    entryCount: Number(suppliedHydration.entryCount ?? hydrationEntries.length),
    entries: hydrationEntries
  };
  const coordinator = new BootCoordinator({
    context,
    buildId: context.buildId,
    dataRoot: root,
    dbPath: dbPath(root),
    requireCredentialHydration: true,
    hydrateCredentials: options.hydrateCredentials || (async () => hydration),
    externalWorkerStarters: options.externalWorkerStarters || {}
  });
  await coordinator.start();
  return { root, context, hydration, coordinator, runtime: coordinator.runtime, async close() { await coordinator.stop('wp4-test'); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}
module.exports = { createCredentialRuntime, createOwnership, dbPath, frameFor, sha, startup, temporaryRoot };
