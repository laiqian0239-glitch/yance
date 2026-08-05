'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const baileys = require('@whiskeysockets/baileys');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');
const { createWhatsAppAuthStateRepository } = require('../repositories/whatsappAuthStateRepository');
const { readCredentialState } = require('../services/whatsappAuthResolver');

const ACCOUNT_ID = 'legacy-import-account';
const ACCOUNT_KEY = 'whatsapp-auth-account:legacy-import-account';
const GENERATION = 17;
const SOCKET_TOKEN = 'legacy-import-socket-token';
const AT = '2026-08-05T00:00:00.000Z';

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function loadImporterModule() {
  try {
    return require('../services/whatsappLegacyAuthImporter');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappLegacyAuthImporter')) {
      assert.fail('two-phase whatsappLegacyAuthImporter production module is missing');
    }
    throw error;
  }
}

function createImporter(importerModule, options) {
  const input = Object.freeze({
    repository: options.repository,
    storeProvider: () => options.store,
    cipher: options.cipher,
    baileys,
    archiveRoot: options.archiveRoot,
    clock: () => AT,
    renameDirectory: options.renameDirectory,
    faultInjector: options.faultInjector || null
  });
  if (typeof importerModule.createWhatsAppLegacyAuthImporter === 'function') {
    return importerModule.createWhatsAppLegacyAuthImporter(input);
  }
  if (typeof importerModule.WhatsAppLegacyAuthImporter === 'function') {
    return new importerModule.WhatsAppLegacyAuthImporter(input);
  }
  if (typeof importerModule === 'function') return new importerModule(input);
  assert.fail('whatsappLegacyAuthImporter must export a factory or class');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, baileys.BufferJSON.replacer), 'utf8');
}

function writeValidLegacyDirectory(directory) {
  const creds = baileys.initAuthCreds();
  creds.registered = true;
  creds.me = { id: '15551234567:7@s.whatsapp.net', name: 'Legacy Yance' };
  writeJson(path.join(directory, 'creds.json'), creds);
  writeJson(path.join(directory, 'session-session-a.json'), {
    chainKey: Buffer.from([1, 2, 3]),
    counter: 9
  });
  writeJson(path.join(directory, 'app-state-sync-key-app-a.json'), {
    keyData: Buffer.from([4, 5, 6]),
    fingerprint: { rawId: 1, currentIndex: 2, deviceIndexes: [3] },
    timestamp: 4
  });
  return creds;
}

async function withFixture(callback, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-legacy-import-'));
  const sourceDirectory = path.join(root, 'legacy-auth', 'account');
  const archiveRoot = path.join(root, 'legacy-auth-imported');
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({
    dbPath,
    ownershipHeartbeatMs: 60000,
    ownershipStaleMs: 120000
  });
  const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x71), keyVersion: 1 });
  const repository = createWhatsAppAuthStateRepository({
    storeProvider: () => store,
    cipher,
    clock: () => AT
  });
  try {
    store.upsertAccount({
      id: ACCOUNT_ID,
      platform: 'whatsapp',
      adapterAccountId: 'legacy-import-device'
    });
    if (options.writeValid !== false) writeValidLegacyDirectory(sourceDirectory);
    return await callback({ root, sourceDirectory, archiveRoot, store, cipher, repository });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function importInput(sourceDirectory) {
  return Object.freeze({
    accountId: ACCOUNT_ID,
    accountKey: ACCOUNT_KEY,
    sourceDirectory,
    generation: GENERATION,
    socketToken: SOCKET_TOKEN
  });
}

function accountRow(store) {
  return store.db.prepare(`SELECT account_key,account_id,current_epoch,state,registered,
    writer_generation,writer_socket_token,creds_ciphertext_sha256,logged_out_at,
    quarantine_reason FROM whatsapp_auth_accounts WHERE account_key=?`).get(ACCOUNT_KEY) || null;
}

function receiptRows(store) {
  return store.db.prepare(`SELECT receipt_id,account_key,source_directory_hmac,
    manifest_a_sha256,manifest_b_sha256,manifest_c_sha256,staged_epoch,state,
    activation_sha256,failure_code,cleanup_reference_hmac,created_at,updated_at,
    activated_at,completed_at
    FROM whatsapp_auth_import_receipts WHERE account_key=? ORDER BY receipt_id`).all(ACCOUNT_KEY);
}

function keyRows(store) {
  return store.db.prepare(`SELECT category,key_id,value_present,ciphertext_sha256,epoch
    FROM whatsapp_auth_keys WHERE account_key=? ORDER BY category,key_id`).all(ACCOUNT_KEY);
}

function seedTerminalAuthority(store, cipher, state) {
  const creds = baileys.initAuthCreds();
  creds.registered = state !== 'LOGGED_OUT';
  creds.me = { id: '15550000000:1@s.whatsapp.net' };
  let envelope = null;
  if (state !== 'LOGGED_OUT') {
    envelope = cipher.encrypt('AUTH_CREDS', {
      schemaVersion: 23,
      accountKey: ACCOUNT_KEY,
      accountId: ACCOUNT_ID,
      currentEpoch: 3
    }, Buffer.from(JSON.stringify(creds, baileys.BufferJSON.replacer), 'utf8'));
  }
  store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
    account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
    creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
    identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
    logged_out_at,quarantine_reason
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ACCOUNT_KEY,
    ACCOUNT_ID,
    3,
    state,
    envelope?.cipherVersion ?? null,
    envelope?.keyVersion ?? null,
    envelope?.nonce ?? null,
    envelope?.ciphertext ?? null,
    envelope?.authTag ?? null,
    envelope?.ciphertextSha256 ?? '',
    state === 'LOGGED_OUT' ? 0 : 1,
    state === 'LOGGED_OUT' ? '' : cipher.hmacIndex('IDENTITY_JID', creds.me.id),
    GENERATION,
    SOCKET_TOKEN,
    AT,
    AT,
    state === 'LOGGED_OUT' ? AT : '',
    state === 'QUARANTINED' ? 'badSession' : ''
  );
}

test('resolver does not classify me.id-only legacy credentials as usable auth state', async () => {
  await withFixture(({ sourceDirectory }) => {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    writeJson(path.join(sourceDirectory, 'creds.json'), {
      registered: true,
      me: { id: '15551234567:1@s.whatsapp.net' }
    });
    const state = readCredentialState(sourceDirectory);
    assert.equal(state.hasIdentity, true);
    assert.equal(state.usable, false);
    assert.equal(state.importable, false);
    assert.equal(state.reasonCode, 'WHATSAPP_LEGACY_SIGNAL_STATE_INCOMPLETE');
  }, { writeValid: false });
});

test('stable legacy directory imports once, activates encrypted authority and archives the source', async () => {
  const importerModule = loadImporterModule();
  await withFixture(async ({ sourceDirectory, archiveRoot, store, cipher, repository }) => {
    const importer = createImporter(importerModule, { store, cipher, repository, archiveRoot });
    const first = await importer.importDirectory(importInput(sourceDirectory));

    assert.equal(first.imported, true);
    assert.equal(first.state, 'COMPLETED');
    assert.equal(first.cleanupRequired, false);
    assert.equal(fs.existsSync(sourceDirectory), false);
    assert.equal(fs.existsSync(path.join(archiveRoot, first.receiptId)), true);

    const account = accountRow(store);
    assert.equal(account.state, 'ACTIVE');
    assert.equal(account.current_epoch, 1);
    assert.equal(account.writer_generation, GENERATION);
    assert.equal(account.writer_socket_token, SOCKET_TOKEN);
    assert.equal(account.registered, 1);
    assert.equal(account.creds_ciphertext_sha256.length, 64);

    const receipts = receiptRows(store);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].receipt_id, first.receiptId);
    assert.equal(receipts[0].state, 'COMPLETED');
    assert.equal(receipts[0].manifest_a_sha256, receipts[0].manifest_b_sha256);
    assert.equal(receipts[0].manifest_b_sha256, receipts[0].manifest_c_sha256);
    assert.equal(receipts[0].source_directory_hmac.length, 64);
    assert.equal(JSON.stringify(receipts[0]).includes(sourceDirectory), false);

    const keys = keyRows(store);
    assert.equal(keys.length, 2);
    assert.deepEqual(keys.map(row => `${row.category}:${row.key_id}`), [
      'app-state-sync-key:app-a',
      'session:session-a'
    ]);
    assert.equal(keys.every(row => row.ciphertext_sha256.length === 64), true);

    const second = await importer.importDirectory(importInput(path.join(archiveRoot, first.receiptId)));
    assert.equal(second.imported, false);
    assert.equal(second.receiptId, first.receiptId);
    assert.equal(receiptRows(store).length, 1);
  });
});

test('manifest mutation after PREPARED fails closed and preserves IMPORT_PENDING with zero active material', async () => {
  const importerModule = loadImporterModule();
  await withFixture(async ({ sourceDirectory, archiveRoot, store, cipher, repository }) => {
    const importer = createImporter(importerModule, {
      store,
      cipher,
      repository,
      archiveRoot,
      faultInjector(point) {
        if (point === 'after-manifest-a') {
          writeJson(path.join(sourceDirectory, 'session-mutated.json'), { mutation: true });
        }
      }
    });

    await assert.rejects(
      importer.importDirectory(importInput(sourceDirectory)),
      expectCode('WHATSAPP_LEGACY_AUTH_MANIFEST_CHANGED')
    );

    const account = accountRow(store);
    assert.equal(account.state, 'IMPORT_PENDING');
    assert.equal(account.creds_ciphertext_sha256, '');
    assert.equal(keyRows(store).length, 0);
    const receipts = receiptRows(store);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].state, 'IMPORT_PENDING');
    assert.equal(receipts[0].manifest_a_sha256.length, 64);
    assert.equal(receipts[0].manifest_b_sha256.length, 64);
    assert.notEqual(receipts[0].manifest_a_sha256, receipts[0].manifest_b_sha256);
    assert.equal(fs.existsSync(sourceDirectory), true);
  });
});

test('archive rename failure leaves database ACTIVE and receipt CLEANUP_REQUIRED without file fallback', async () => {
  const importerModule = loadImporterModule();
  await withFixture(async ({ sourceDirectory, archiveRoot, store, cipher, repository }) => {
    let renameCalls = 0;
    const importer = createImporter(importerModule, {
      store,
      cipher,
      repository,
      archiveRoot,
      renameDirectory(source, destination) {
        renameCalls += 1;
        const error = Object.assign(new Error('simulated Windows file lock'), {
          code: 'EPERM'
        });
        throw error;
      }
    });

    const result = await importer.importDirectory(importInput(sourceDirectory));
    assert.equal(result.imported, true);
    assert.equal(result.state, 'CLEANUP_REQUIRED');
    assert.equal(result.cleanupRequired, true);
    assert.equal(renameCalls, 1);
    assert.equal(accountRow(store).state, 'ACTIVE');
    assert.equal(keyRows(store).length, 2);
    assert.equal(receiptRows(store)[0].state, 'CLEANUP_REQUIRED');
    assert.equal(receiptRows(store)[0].failure_code, 'WHATSAPP_LEGACY_AUTH_ARCHIVE_RENAME_FAILED');
    assert.equal(receiptRows(store)[0].cleanup_reference_hmac.length, 64);
    assert.equal(fs.existsSync(sourceDirectory), true);

    const duplicate = await importer.importDirectory(importInput(sourceDirectory));
    assert.equal(duplicate.imported, false);
    assert.equal(duplicate.state, 'CLEANUP_REQUIRED');
    assert.equal(renameCalls, 1, 'repeat import must not create a second activation or retry implicitly');
    assert.equal(receiptRows(store).length, 1);
  });
});

for (const terminalState of ['LOGGED_OUT', 'QUARANTINED']) {
  test(`${terminalState} authority blocks legacy directory resurrection`, async () => {
    const importerModule = loadImporterModule();
    await withFixture(async ({ sourceDirectory, archiveRoot, store, cipher, repository }) => {
      seedTerminalAuthority(store, cipher, terminalState);
      const before = accountRow(store);
      const importer = createImporter(importerModule, { store, cipher, repository, archiveRoot });
      await assert.rejects(
        importer.importDirectory(importInput(sourceDirectory)),
        expectCode('WHATSAPP_LEGACY_AUTH_RESURRECTION_BLOCKED')
      );
      assert.deepEqual(accountRow(store), before);
      assert.equal(receiptRows(store).length, 0);
      assert.equal(keyRows(store).length, 0);
      assert.equal(fs.existsSync(sourceDirectory), true);
    });
  });
}

test('isolated orphan reconciliation suite enforces legacy tombstones', () => {
  const childProcess = require('node:child_process');
  const suite = path.resolve(__dirname, 'whatsappOrphanAccountReconciliation.test.js');
  const result = childProcess.spawnSync(process.execPath, ['--test', '--test-concurrency=1', suite], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, YANCE_TEST_ONLY_SQLITE_BROKER_RESET: '1' }
  });
  assert.match(result.stdout, /legacy auth discovery stays diagnostic and database tombstone blocks filesystem resurrection/u, result.stdout);
  assert.match(result.stdout, /# tests 4(?:\r?\n|$)/u, result.stdout);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
