'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isolatedBackendEnvironment } = require('../../tools/wp4/isolated-backend-environment');
const { request } = require('../../tools/wp4/production-credential-runtime');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const {
  APPLICATION_CONTAINED,
  CredentialVaultHost
} = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialVault } = require('../../electron/credentialVault');
const { createInstalledResources } = require('../wp2/helpers');

const KEY_REFERENCE = 'whatsapp-auth-data-key:v1';
const KEY_PURPOSE = 'WHATSAPP_AUTH_AND_RETRY_PROJECTION';

function createSafeStorage() {
  const key = crypto.createHash('sha256')
    .update('oss1a-whatsapp-dek-custody-test')
    .digest();
  return Object.freeze({
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final()
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12)
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final()
      ]).toString('utf8');
    }
  });
}

function collectFiles(root) {
  const files = [];
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.push(full);
    }
  };
  visit(root);
  return files;
}

function keyAuthoritySnapshot(health) {
  const participant = health?.productionServices?.participants?.find(
    row => row?.name === 'whatsapp-auth-key-authority'
  );
  assert.ok(participant, 'production health must expose the WhatsApp key authority participant');
  assert.equal(participant.critical, true);
  return participant.snapshot;
}

function assertCredentialCounts(state, expectedGeneration, expectedEntries, expectedPayloadBytes) {
  const app = state.credentialMetadata;
  const sqlite = state.sqliteCredentialMetadata;
  assert.equal(app.generation, expectedGeneration, 'AppRuntime credential generation');
  assert.equal(sqlite.generation, expectedGeneration, 'SQLite credential generation');
  assert.equal(app.entryCount, expectedEntries, 'AppRuntime entry count');
  assert.equal(app.vaultReferenceCount, expectedEntries, 'AppRuntime vault reference count');
  assert.equal(app.decryptedEntryCount, expectedEntries, 'AppRuntime decrypted entry count');
  assert.equal(app.frameEntryCount, expectedEntries, 'AppRuntime frame entry count');
  assert.equal(app.restoredReferenceCount, expectedEntries, 'AppRuntime restored reference count');
  assert.equal(sqlite.referenceCount, expectedEntries, 'SQLite reference count');
  assert.equal(app.payloadBytes, expectedPayloadBytes, 'AppRuntime payload bytes');
  assert.equal(sqlite.payloadBytes, expectedPayloadBytes, 'SQLite payload bytes');
  assert.equal(state.security.credentialRefs, expectedEntries, 'SecurityGuard credential refs');
  assert.equal(state.secureBridge.credentialRefs, expectedEntries, 'secureBridge credential refs');
}

function assertValidDekRecord(value) {
  assert.equal(value?.algorithm, 'AES-256-GCM');
  assert.equal(value?.keyVersion, 1);
  assert.equal(value?.purpose, KEY_PURPOSE);
  assert.equal(Buffer.from(String(value?.keyBase64 || ''), 'base64').length, 32);
  assert.equal(Number.isFinite(Date.parse(String(value?.createdAt || ''))), true);
}

function readJournal(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function dekTransactions(journal) {
  return Object.values(journal.transactions || {}).filter(
    row => row?.source === 'FD6'
      && row?.operation === 'persist'
      && row?.ref === KEY_REFERENCE
  );
}

test('real FD6 custody persists the WhatsApp DEK and the next backend owner restores it through FD5', { timeout: 180000 }, async () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-dek-custody-'));
  const secureRoot = path.join(dataRoot, 'secure');
  const paths = {
    vault: path.join(secureRoot, 'credentials.safe.json'),
    metadata: path.join(secureRoot, 'vault-meta.json'),
    journal: path.join(secureRoot, 'credential-authority-journal.json'),
    lifecycleIntent: path.join(secureRoot, 'credential-authority-lifecycle-intent.json'),
    lifecycleCompleted: path.join(secureRoot, 'credential-authority-completed.json')
  };
  const release = createInstalledResources({
    gitCommit: '7'.repeat(40),
    sourceTree: '8'.repeat(40)
  });
  const vault = new CredentialVault(paths.vault, {
    safeStorage: createSafeStorage()
  });
  const vaultHost = new CredentialVaultHost({
    vault,
    metadataPath: paths.metadata,
    transactionPath: paths.journal,
    lifecycleIntentPath: paths.lifecycleIntent,
    lifecycleCompletedPath: paths.lifecycleCompleted
  });
  const backendHost = new BackendProcessHost();
  let stopped = false;
  let rawKeyForms = [];
  const startOptions = {
    entry: path.join(repoRoot, 'backend', 'desktopHostedEntry.js'),
    cwd: repoRoot,
    execPath: process.execPath,
    env: isolatedBackendEnvironment({
      YANCE_DATA_DIR: dataRoot,
      YANCE_PORT: '0',
      YANCE_HOST: '127.0.0.1',
      YANCE_MODEL_TIMEOUT_MS: '5000',
      YANCE_APP_ROOT: repoRoot,
      YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1',
      YANCE_WP4_CREDENTIAL_CUSTODY_PROBE: '1'
    }),
    releaseStartupConfig: {
      resourcesPath: release.resourcesPath,
      expectedBuildId: release.manifest.buildId,
      manifestSha256: release.manifestSha256
    },
    credentialHandshakeRequired: true,
    credentialVaultHost: vaultHost,
    credentialTimeoutMs: 15000,
    readyTimeoutMs: 60000,
    readyHealthCheckPath: '/api/health',
    readyHealthCheckTimeoutMs: 5000,
    readyHealthCheckRetries: 60,
    readyHealthCheckRetryDelayMs: 150,
    createCredentialSnapshot: context => vaultHost.createHydrationFrame(context)
  };

  try {
    const firstOwner = await backendHost.start(startOptions);
    assert.equal(firstOwner.hydration?.entryCount, 0, 'first owner must start from an empty FD5 snapshot');

    const firstHealthResponse = await request(
      firstOwner.readiness.port,
      firstOwner.apiSessionToken,
      '/api/health'
    );
    assert.equal(firstHealthResponse.statusCode, 200);
    const firstKeyAuthority = keyAuthoritySnapshot(firstHealthResponse.body);
    assert.equal(firstKeyAuthority.state, 'started');
    assert.equal(firstKeyAuthority.started, true);
    assert.equal(firstKeyAuthority.keyVersion, 1);

    const firstStateResponse = await request(
      firstOwner.readiness.port,
      firstOwner.apiSessionToken,
      '/api/wp4/credential-state'
    );
    assert.equal(firstStateResponse.statusCode, 200);
    const firstState = firstStateResponse.body;
    const firstMetadata = vaultHost.snapshotMetadata();
    assert.equal(firstMetadata.generation, 2, 'FD5 hydration then FD6 persist must advance generation to 2');
    assert.equal(firstMetadata.referenceCount, 1);
    assertCredentialCounts(firstState, 2, 1, firstState.credentialMetadata.payloadBytes);
    assert.ok(firstState.credentialMetadata.payloadBytes > 0);

    const firstDek = vaultHost.get(KEY_REFERENCE);
    assertValidDekRecord(firstDek);
    rawKeyForms = [
      firstDek.keyBase64,
      Buffer.from(firstDek.keyBase64, 'base64').toString('hex'),
      crypto.createHash('sha256').update(firstDek.keyBase64).digest('hex'),
      crypto.createHash('sha256').update(firstDek.keyBase64).digest('base64')
    ];

    const firstJournal = readJournal(paths.journal);
    const firstDekTransactions = dekTransactions(firstJournal);
    assert.equal(firstDekTransactions.length, 1, 'the first owner must commit exactly one FD6 DEK persist');
    assert.equal(firstDekTransactions[0].state, 'COMMITTED');
    assert.equal(firstDekTransactions[0].generation, 2);
    assert.equal(
      JSON.stringify(firstDekTransactions[0]).includes(firstDek.keyBase64),
      false,
      'the authority journal must not contain the raw DEK'
    );

    const secondOwner = await backendHost.restart({
      ...startOptions,
      gracefulMs: 8000,
      forceMs: 8000
    });
    assert.equal(secondOwner.hydration?.entryCount, 1, 'next owner FD5 must contain the persisted DEK');
    assert.equal(secondOwner.hydration?.generation, 3);

    const secondHealthResponse = await request(
      secondOwner.readiness.port,
      secondOwner.apiSessionToken,
      '/api/health'
    );
    assert.equal(secondHealthResponse.statusCode, 200);
    const secondKeyAuthority = keyAuthoritySnapshot(secondHealthResponse.body);
    assert.equal(secondKeyAuthority.state, 'started');
    assert.equal(secondKeyAuthority.keyVersion, firstKeyAuthority.keyVersion);
    assert.equal(secondKeyAuthority.createdAt, firstKeyAuthority.createdAt);

    const secondStateResponse = await request(
      secondOwner.readiness.port,
      secondOwner.apiSessionToken,
      '/api/wp4/credential-state'
    );
    assert.equal(secondStateResponse.statusCode, 200);
    const secondState = secondStateResponse.body;
    const secondMetadata = vaultHost.snapshotMetadata();
    assert.equal(secondMetadata.generation, 3);
    assert.equal(secondMetadata.referenceCount, 1);
    assertCredentialCounts(
      secondState,
      3,
      1,
      secondOwner.hydration.payloadBytes
    );

    const secondDek = vaultHost.get(KEY_REFERENCE);
    assert.deepEqual(secondDek, firstDek, 'next owner must restore the exact authoritative DEK record');
    const secondJournal = readJournal(paths.journal);
    assert.equal(
      dekTransactions(secondJournal).length,
      1,
      'a valid FD5-restored DEK must not be persisted again by the next owner'
    );

    const generationBeforeContainment = secondMetadata.generation;
    vaultHost.setApplicationFence({
      reasonCode: APPLICATION_CONTAINED,
      rejectionReasonCode: 'OSS1A_REJECTED_OWNER_DEK_PERSIST',
      coordinatorState: 'FATAL_OWNER_CONTAINMENT',
      backendPid: secondOwner.child.pid,
      ownerSession: vaultHost.activeOwnerSession,
      retryable: false,
      fatal: true
    });
    const conflictingDek = {
      algorithm: 'AES-256-GCM',
      keyVersion: 1,
      keyBase64: Buffer.alloc(32, 0x6b).toString('base64'),
      createdAt: '2026-08-05T00:00:00.000Z',
      purpose: KEY_PURPOSE
    };
    const containedResponse = await request(
      secondOwner.readiness.port,
      secondOwner.apiSessionToken,
      '/api/wp4/credential-persist-probe',
      {
        method: 'POST',
        body: { ref: KEY_REFERENCE, value: conflictingDek },
        timeoutMs: 15000
      }
    );
    assert.ok(containedResponse.statusCode >= 400);
    assert.equal(containedResponse.body?.reasonCode, APPLICATION_CONTAINED);
    assert.deepEqual(vaultHost.get(KEY_REFERENCE), firstDek);
    assert.equal(vaultHost.snapshotMetadata().generation, generationBeforeContainment);
    assert.equal(dekTransactions(readJournal(paths.journal)).length, 1);
    vaultHost.clearApplicationFence({ force: true });

    await backendHost.stop({ gracefulMs: 8000, forceMs: 8000 });
    stopped = true;

    const corpus = Buffer.concat(
      collectFiles(dataRoot).map(file => fs.readFileSync(file))
    ).toString('latin1');
    for (const form of rawKeyForms) {
      assert.equal(corpus.includes(form), false, 'raw DEK material must not persist in runtime files or logs');
    }
  } finally {
    if (!stopped) {
      try { vaultHost.clearApplicationFence({ force: true }); } catch (_) {}
      await backendHost.stop({ gracefulMs: 8000, forceMs: 8000 }).catch(() => {});
    }
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(release.resourcesPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
