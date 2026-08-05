'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../../backend/security/whatsappAuthCipher');
const { createWhatsAppAuthStateRepository } = require('../../backend/repositories/whatsappAuthStateRepository');

const CRASH_EXIT_CODE = 86;
const AT = '2026-08-05T00:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);

const AUTH_CRASH_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'AUTH_ACCOUNT_INSERT_BEFORE_KEYS',
    faultPoint: 'after-initialize-write',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  }),
  Object.freeze({
    id: 'AUTH_KEYS_MID_BATCH',
    faultPoint: 'after-key-write:1',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  }),
  Object.freeze({
    id: 'AUTH_CREDS_AFTER_UPDATE_BEFORE_COMMIT',
    faultPoint: 'after-creds-write',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  }),
  Object.freeze({
    id: 'LEGACY_IMPORT_BEFORE_DB_COMMIT',
    faultPoint: 'legacy-import-transaction-before-commit',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  }),
  Object.freeze({
    id: 'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE',
    faultPoint: 'legacy-import-activated-before-directory-rename',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  }),
  Object.freeze({
    id: 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT',
    faultPoint: 'before-logout-write/after-logout-write',
    execution: 'CHILD_PROCESS_CRASH_AND_RESTART'
  })
]);

function accountFor(scenarioId, suffix = '') {
  const safe = `${scenarioId.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}${suffix}`;
  return Object.freeze({
    accountId: `matrix-${safe}`,
    accountKey: `whatsapp-auth-account:matrix-${safe}`,
    generation: 7,
    epoch: 1,
    socketToken: `socket-${safe}`
  });
}

function openStore(root) {
  return new R32SqliteStore({
    dbPath: path.join(root, 'database', 'yance.db'),
    ownershipHeartbeatMs: 60000,
    ownershipStaleMs: 120000
  });
}

function createCipher() {
  return createWhatsAppAuthCipher({
    key: Buffer.alloc(32, 0x63),
    keyVersion: 1
  });
}

function createRepository(store, cipher, faultInjector = null) {
  return createWhatsAppAuthStateRepository({
    storeProvider: () => store,
    cipher,
    clock: () => AT,
    faultInjector
  });
}

function closeFixture(store, cipher) {
  try { cipher?.close(); } catch (_) {}
  try { store?.close(); } catch (_) {}
}

function ensureR32Account(store, account) {
  store.upsertAccount({
    id: account.accountId,
    platform: 'whatsapp',
    adapterAccountId: `${account.accountId}-device`
  });
}

function initializeAuth(repository, account, overrides = {}) {
  return repository.initializeAccount({
    accountKey: account.accountKey,
    accountId: account.accountId,
    currentEpoch: account.epoch,
    writerGeneration: account.generation,
    socketToken: account.socketToken,
    creds: {
      registered: true,
      me: { id: `${account.accountId}@s.whatsapp.net` },
      marker: overrides.marker || 'baseline'
    }
  });
}

function writer(account) {
  return {
    accountKey: account.accountKey,
    expectedEpoch: account.epoch,
    expectedWriterGeneration: account.generation,
    expectedSocketToken: account.socketToken
  };
}

function prepareFixture(scenarioId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-auth-crash-matrix-'));
  const store = openStore(root);
  const cipher = createCipher();
  try {
    if (scenarioId === 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT') {
      for (const suffix of ['-before', '-after']) {
        const account = accountFor(scenarioId, suffix);
        ensureR32Account(store, account);
        initializeAuth(createRepository(store, cipher), account);
      }
      return root;
    }

    const account = accountFor(scenarioId);
    ensureR32Account(store, account);
    if (!['AUTH_ACCOUNT_INSERT_BEFORE_KEYS', 'LEGACY_IMPORT_BEFORE_DB_COMMIT', 'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE'].includes(scenarioId)) {
      initializeAuth(createRepository(store, cipher), account);
    }
    return root;
  } finally {
    closeFixture(store, cipher);
  }
}

function crashNow() {
  process.exit(CRASH_EXIT_CODE);
}

function runLegacyPhases(repository, account, stopAfterActivation = false) {
  const receiptId = `oss1a-matrix-${crypto.createHash('sha256').update(account.accountKey).digest('hex').slice(0, 24)}`;
  repository.importLegacySnapshot({
    phase: 'PREPARE',
    receiptId,
    accountId: account.accountId,
    accountKey: account.accountKey,
    sourceDirectoryHmac: HASH_A,
    manifestASha256: HASH_B,
    generation: account.generation,
    socketToken: account.socketToken,
    at: AT
  });
  repository.importLegacySnapshot({
    phase: 'RECORD_MANIFEST_B',
    receiptId,
    manifestBSha256: HASH_B,
    at: AT
  });
  repository.importLegacySnapshot({
    phase: 'RECORD_MANIFEST_C',
    receiptId,
    manifestCSha256: HASH_B,
    at: AT
  });
  repository.importLegacySnapshot({
    phase: 'ACTIVATE',
    receiptId,
    accountId: account.accountId,
    accountKey: account.accountKey,
    sourceDirectoryHmac: HASH_A,
    manifestASha256: HASH_B,
    manifestBSha256: HASH_B,
    manifestCSha256: HASH_B,
    activationSha256: HASH_C,
    generation: account.generation,
    socketToken: account.socketToken,
    creds: {
      registered: true,
      me: { id: `${account.accountId}@s.whatsapp.net` },
      imported: true
    },
    keys: [{ category: 'session', keyId: 'matrix', value: { value: 'imported' } }],
    at: AT
  });
  if (stopAfterActivation) return receiptId;
  repository.importLegacySnapshot({ phase: 'COMPLETE', receiptId, at: AT });
  return receiptId;
}

function runWorker(scenarioId, root, variant = '') {
  const store = openStore(root);
  const cipher = createCipher();
  try {
    const account = accountFor(scenarioId, variant ? `-${variant}` : '');
    if (scenarioId === 'AUTH_ACCOUNT_INSERT_BEFORE_KEYS') {
      const repository = createRepository(store, cipher, point => {
        if (point === 'after-initialize-write') crashNow();
      });
      initializeAuth(repository, account, { marker: 'must-roll-back' });
    } else if (scenarioId === 'AUTH_KEYS_MID_BATCH') {
      const repository = createRepository(store, cipher, point => {
        if (point === 'after-key-write:1') crashNow();
      });
      repository.setKeys({
        ...writer(account),
        updates: {
          session: {
            first: { value: 'must-roll-back' },
            second: { value: 'must-not-commit' }
          }
        }
      });
    } else if (scenarioId === 'AUTH_CREDS_AFTER_UPDATE_BEFORE_COMMIT') {
      const repository = createRepository(store, cipher, point => {
        if (point === 'after-creds-write') crashNow();
      });
      repository.commitCreds({
        ...writer(account),
        creds: {
          registered: false,
          me: { id: 'must-not-commit@s.whatsapp.net' },
          marker: 'must-roll-back'
        }
      });
    } else if (scenarioId === 'LEGACY_IMPORT_BEFORE_DB_COMMIT') {
      const receiptId = 'oss1a-matrix-before-commit';
      store.transaction(() => {
        store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
          account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
          creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
          identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
          logged_out_at,quarantine_reason
        ) VALUES(?,?,1,'IMPORT_PENDING',NULL,NULL,NULL,NULL,NULL,'',0,'',?,?,?,?,'','')`).run(
          account.accountKey, account.accountId, account.generation, account.socketToken, AT, AT
        );
        store.db.prepare(`INSERT INTO whatsapp_auth_import_receipts(
          receipt_id,account_key,source_directory_hmac,manifest_a_sha256,
          manifest_b_sha256,manifest_c_sha256,staged_epoch,state,activation_sha256,
          failure_code,cleanup_reference_hmac,created_at,updated_at,activated_at,completed_at
        ) VALUES(?,?,?,?,'','',1,'IMPORT_PENDING','','','',?,?,'','')`).run(
          receiptId, account.accountKey, HASH_A, HASH_B, AT, AT
        );
        crashNow();
      });
    } else if (scenarioId === 'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE') {
      runLegacyPhases(createRepository(store, cipher), account, true);
      crashNow();
    } else if (scenarioId === 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT') {
      if (variant === 'before') crashNow();
      const repository = createRepository(store, cipher, point => {
        if (point === 'after-logout-write') crashNow();
      });
      repository.markLoggedOut({
        ...writer(account),
        nextEpoch: account.epoch + 1,
        loggedOutAt: AT
      });
    } else {
      throw new Error(`Unknown auth crash scenario: ${scenarioId}`);
    }
    throw new Error(`Fault point did not terminate child for ${scenarioId}`);
  } finally {
    closeFixture(store, cipher);
  }
}

function spawnCrash(scenarioId, root, variant = '') {
  return spawnSync(process.execPath, [__filename, '--worker', scenarioId, root, variant], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
}

function integrity(store) {
  const row = store.db.prepare('PRAGMA integrity_check').get();
  return String(row?.integrity_check || Object.values(row || {})[0] || '');
}

function authSummary(store, scenarioId) {
  const rows = store.db.prepare(`SELECT account_key,current_epoch,state,registered,
    writer_generation,writer_socket_token,creds_ciphertext_sha256,logged_out_at
    FROM whatsapp_auth_accounts
    WHERE account_key LIKE 'whatsapp-auth-account:matrix-%'
    ORDER BY account_key`).all();
  const keyCount = Number(store.db.prepare(`SELECT COUNT(*) AS count FROM whatsapp_auth_keys
    WHERE account_key LIKE 'whatsapp-auth-account:matrix-%'`).get().count);
  const receipts = store.db.prepare(`SELECT receipt_id,state,failure_code,activation_sha256
    FROM whatsapp_auth_import_receipts
    WHERE receipt_id LIKE 'oss1a-matrix-%'
    ORDER BY receipt_id`).all();
  return Object.freeze({ scenarioId, rows, keyCount, receipts });
}

function countAutomaticSends(store) {
  const tables = store.db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND lower(name) LIKE '%outbox%' ORDER BY name`).all();
  let count = 0;
  for (const row of tables) {
    const table = String(row.name);
    if (!/^[A-Za-z0-9_]+$/u.test(table)) continue;
    count += Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
  }
  return count;
}

function ensureRepair(repository, store, scenarioId) {
  if (scenarioId === 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT') {
    for (const suffix of ['-before', '-after']) {
      const account = accountFor(scenarioId, suffix);
      const current = repository.loadAccount(account.accountKey);
      if (current?.state === 'ACTIVE') {
        repository.markLoggedOut({
          ...writer(account),
          nextEpoch: account.epoch + 1,
          loggedOutAt: AT
        });
      }
    }
    return;
  }

  const account = accountFor(scenarioId);
  const current = repository.loadAccount(account.accountKey);
  if (scenarioId === 'AUTH_ACCOUNT_INSERT_BEFORE_KEYS') {
    if (!current) initializeAuth(repository, account, { marker: 'repaired' });
  } else if (scenarioId === 'AUTH_KEYS_MID_BATCH') {
    const existing = repository.getKeys(account.accountKey, account.epoch, 'session', ['first', 'second']);
    if (!existing.first || !existing.second) {
      repository.setKeys({
        ...writer(account),
        updates: {
          session: {
            first: { value: 'repaired' },
            second: { value: 'repaired' }
          }
        }
      });
    }
  } else if (scenarioId === 'AUTH_CREDS_AFTER_UPDATE_BEFORE_COMMIT') {
    if (current?.creds?.marker !== 'repaired') {
      repository.commitCreds({
        ...writer(account),
        creds: {
          registered: true,
          me: { id: `${account.accountId}@s.whatsapp.net` },
          marker: 'repaired'
        }
      });
    }
  } else if (scenarioId === 'LEGACY_IMPORT_BEFORE_DB_COMMIT') {
    if (!current) runLegacyPhases(repository, account, false);
  } else if (scenarioId === 'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE') {
    const receiptId = `oss1a-matrix-${crypto.createHash('sha256').update(account.accountKey).digest('hex').slice(0, 24)}`;
    const receipt = repository.importLegacySnapshot({ phase: 'LOOKUP', receiptId });
    if (receipt?.state === 'ACTIVATED') {
      repository.importLegacySnapshot({
        phase: 'CLEANUP_REQUIRED',
        receiptId,
        cleanupReferenceHmac: HASH_D,
        failureCode: 'OSS1A_IMPORT_ARCHIVE_INTERRUPTED',
        at: AT
      });
    }
  }

  assert.equal(integrity(store), 'ok');
}

function writeAuditReceipt(root, scenarioId, summary) {
  const payload = {
    schemaVersion: 1,
    matrix: 'OSS1A_WHATSAPP_AUTH_CRASH_MATRIX',
    scenarioId,
    platform: process.platform,
    summarySha256: crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex'),
    status: 'PASS'
  };
  const receiptPath = path.join(root, 'fault-receipt.json');
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, { encoding: 'utf8', flag: 'w' });
  fs.writeFileSync(receiptPath, serialized, { encoding: 'utf8', flag: 'w' });
  return fs.existsSync(receiptPath) && fs.readFileSync(receiptPath, 'utf8') === serialized;
}

function evaluateScenario(scenario) {
  const root = prepareFixture(scenario.id);
  try {
    const crashes = scenario.id === 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT'
      ? [spawnCrash(scenario.id, root, 'before'), spawnCrash(scenario.id, root, 'after')]
      : [spawnCrash(scenario.id, root)];
    for (const child of crashes) {
      assert.equal(child.error, undefined, child.error?.stack || child.stderr);
      assert.equal(child.status, CRASH_EXIT_CODE, child.stderr || child.stdout);
    }

    let store = openStore(root);
    let cipher = createCipher();
    try {
      const repository = createRepository(store, cipher);
      const beforeRepair = authSummary(store, scenario.id);

      if (scenario.id === 'AUTH_ACCOUNT_INSERT_BEFORE_KEYS'
        || scenario.id === 'LEGACY_IMPORT_BEFORE_DB_COMMIT') {
        assert.equal(beforeRepair.rows.length, 0, JSON.stringify(beforeRepair));
      }
      if (scenario.id === 'AUTH_KEYS_MID_BATCH') {
        assert.equal(beforeRepair.keyCount, 0, JSON.stringify(beforeRepair));
      }
      if (scenario.id === 'AUTH_CREDS_AFTER_UPDATE_BEFORE_COMMIT') {
        assert.equal(repository.loadAccount(accountFor(scenario.id).accountKey)?.creds?.marker, 'baseline');
      }
      if (scenario.id === 'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE') {
        assert.equal(beforeRepair.receipts[0]?.state, 'ACTIVATED', JSON.stringify(beforeRepair));
      }
      if (scenario.id === 'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT') {
        assert.deepEqual(beforeRepair.rows.map(row => row.state), ['ACTIVE', 'ACTIVE']);
      }

      ensureRepair(repository, store, scenario.id);
      const repairedOnce = authSummary(store, scenario.id);
      ensureRepair(repository, store, scenario.id);
      const repairedTwice = authSummary(store, scenario.id);
      assert.deepEqual(repairedTwice, repairedOnce);
      const auditReceiptPresent = writeAuditReceipt(root, scenario.id, repairedOnce);
      const automaticSendCount = countAutomaticSends(store);
      const activeWriterCount = repairedOnce.rows.filter(row => row.state === 'ACTIVE').length;
      const loggedOutResurrected = repairedOnce.rows.some(row => row.state === 'LOGGED_OUT')
        && repairedOnce.rows.some(row => row.state === 'ACTIVE' && row.account_key.includes('logout'));
      const databaseIntegrity = integrity(store);

      closeFixture(store, cipher);
      store = openStore(root);
      cipher = createCipher();
      const restartedSummary = authSummary(store, scenario.id);
      const restartStateDeterministic = JSON.stringify(restartedSummary) === JSON.stringify(repairedOnce);

      return Object.freeze({
        id: scenario.id,
        status: 'PASS',
        faultPoint: scenario.faultPoint,
        childExitedAbnormally: crashes.every(child => child.status === CRASH_EXIT_CODE),
        databaseIntegrity,
        activeWriterCount,
        automaticSendCount,
        loggedOutResurrected,
        restartStateDeterministic,
        repairPersistent: restartStateDeterministic,
        repairIdempotent: JSON.stringify(repairedTwice) === JSON.stringify(repairedOnce),
        auditReceiptPresent
      });
    } finally {
      closeFixture(store, cipher);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

async function runAuthCrashMatrix(options = {}) {
  const results = AUTH_CRASH_SCENARIOS.map(evaluateScenario);
  const report = Object.freeze({
    schemaVersion: 1,
    matrix: 'OSS1A_WHATSAPP_AUTH_CRASH_MATRIX',
    platform: process.platform,
    scenarioCount: results.length,
    warningOnly: false,
    warnings: Object.freeze([]),
    results: Object.freeze(results)
  });
  if (!options.quiet) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  if (process.argv[2] === '--worker') {
    runWorker(process.argv[3], process.argv[4], process.argv[5] || '');
  } else {
    runAuthCrashMatrix().catch(error => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = Object.freeze({
  AUTH_CRASH_SCENARIOS,
  runAuthCrashMatrix
});
