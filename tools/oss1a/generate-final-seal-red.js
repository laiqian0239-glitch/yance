'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());

function file(relative) { return path.join(root, relative); }
function read(relative) { return fs.readFileSync(file(relative), 'utf8'); }
function write(relative, value) { fs.writeFileSync(file(relative), value); }
function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`missing replacement anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`ambiguous replacement anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function relocateRegistrationBoundary() {
  const sourcePath = 'backend/tests/oss1aWhatsappRegistrationIdZero.test.js';
  const targetPath = 'backend/tests/oss1aWhatsappLegacyAuthImport.test.js';
  const source = read(sourcePath);
  const marker = 'function credentialStateForRegistrationId(registrationId) {';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('registration boundary marker missing');
  const addition = source.slice(start).trim();
  const target = read(targetPath).trimEnd();
  if (target.includes(marker)) throw new Error('registration boundary already relocated');
  write(targetPath, `${target}\n\n${addition}\n`);
  fs.unlinkSync(file(sourcePath));
}

function updateMessageOrderingFixture() {
  const relative = 'backend/tests/messageIdentityEvidenceOrdering.test.js';
  let source = read(relative);
  const before = `const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-identity-evidence-order-'));
process.env.YANCE_DATA_DIR = dataRoot;

const messageStore = require('../services/messageStore');
const { getStore, closeStore } = require('../repositories/storeProvider');

const store = getStore();
store.upsertAccount({ id: 'page-identity-order', accountId: 'page-identity-order', adapterAccountId: 'page-identity-order', platform: 'facebook', state: 'online', canSend: false, canReceive: true });

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});`;
  const after = `const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-identity-evidence-order-'));
process.env.YANCE_DATA_DIR = dataRoot;

const dbPath = path.join(dataRoot, 'database', 'yance.db');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

resetSqliteConnectionBrokerForTests();
const authorityHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: 'message-identity-evidence-ordering-test'
});
const broker = createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityHost.capability
});
const store = broker.open();
const messageStore = require('../services/messageStore');

store.upsertAccount({ id: 'page-identity-order', accountId: 'page-identity-order', adapterAccountId: 'page-identity-order', platform: 'facebook', state: 'online', canSend: false, canReceive: true });

test.after(() => {
  try { broker.close(); } catch (_) {}
  try { authorityHost.close(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});`;
  source = replaceOnce(source, before, after, 'message ordering broker fixture');
  write(relative, source);
}

function updateRepositoryContract() {
  const relative = 'backend/tests/oss1aWhatsappAuthRepository.test.js';
  let source = read(relative);
  source = replaceOnce(
    source,
    `  for (const method of [
    'loadAccount',`,
    `  for (const method of [
    'inspectAccount',
    'loadAccount',`,
    'repository interface inspectAccount'
  );
  const anchor = `\nrequire('./oss1aWhatsappAuthRepositoryCrashMatrix.test');`;
  const testBlock = `

test('readiness inspection is metadata-only, frozen and fail-closed for terminal authority state', () => {
  const repositoryModule = loadRepositoryModule();
  withFixture(({ store, cipher }) => {
    let decryptCalls = 0;
    const countingCipher = Object.freeze({
      encrypt: (...args) => cipher.encrypt(...args),
      decrypt(...args) {
        decryptCalls += 1;
        return cipher.decrypt(...args);
      },
      hmacIndex: (...args) => cipher.hmacIndex(...args),
      snapshot: () => cipher.snapshot()
    });
    const repository = createRepository(repositoryModule, { store, cipher: countingCipher });

    const active = repository.inspectAccount(ACCOUNT_KEY);
    assert.deepEqual(active, {
      accountKey: ACCOUNT_KEY,
      accountId: ACCOUNT_ID,
      currentEpoch: EPOCH,
      state: 'ACTIVE',
      writerGeneration: GENERATION,
      registered: true,
      hasIdentity: true,
      hasCreds: true,
      usable: true,
      loggedOutAt: '',
      quarantineReason: ''
    });
    assert.equal(Object.isFrozen(active), true);
    assert.equal(decryptCalls, 0, 'readiness inspection must never decrypt credential material');

    store.db.prepare(\`UPDATE whatsapp_auth_accounts SET
      state='LOGGED_OUT',registered=0,logged_out_at=?,updated_at=?
      WHERE account_key=?\`).run(AT, AT, ACCOUNT_KEY);
    const terminal = repository.inspectAccount(ACCOUNT_KEY);
    assert.equal(terminal.state, 'LOGGED_OUT');
    assert.equal(terminal.usable, false);
    assert.equal(decryptCalls, 0);
    assert.equal(repository.inspectAccount('missing-account'), null);
  });
});
`;
  source = replaceOnce(source, anchor, `${testBlock}${anchor}`, 'repository readiness inspection test');
  write(relative, source);
}

function updateProductionReadinessContract() {
  const relative = 'backend/tests/platformProductionReadinessAuthority.test.js';
  let source = read(relative).trimEnd();
  const addition = `

test('WhatsApp credential readiness comes only from the shared SQLite auth repository authority', () => {
  const adapter = new WhatsAppAdapter();
  const inspected = [];
  let repositoryState = {
    accountKey: 'wa-authority',
    accountId: 'wa-database',
    currentEpoch: 4,
    state: 'ACTIVE',
    writerGeneration: 9,
    registered: true,
    hasIdentity: true,
    hasCreds: true,
    usable: true,
    loggedOutAt: '',
    quarantineReason: ''
  };
  const sharedRepository = Object.freeze({
    inspectAccount(accountKey) {
      inspected.push(accountKey);
      return repositoryState ? Object.freeze({ ...repositoryState }) : null;
    },
    loadAccount() { throw new Error('credential readiness must not decrypt auth state'); },
    initializeAccount() { throw new Error('not used by readiness projection'); },
    activateWriter() { throw new Error('not used by readiness projection'); },
    assertWriter() { throw new Error('not used by readiness projection'); },
    commitCreds() { throw new Error('not used by readiness projection'); },
    getKeys() { throw new Error('not used by readiness projection'); },
    setKeys() { throw new Error('not used by readiness projection'); }
  });
  adapter.configureRuntimeAuthorities({
    whatsappAuthKeyAuthority: Object.freeze({
      getCipher() { throw new Error('credential readiness must not request a cipher'); }
    }),
    storeProvider() { throw new Error('credential readiness must use the injected repository'); },
    whatsappAuthStateRepository: sharedRepository
  });

  const ready = adapter.credentialState('wa-authority', { force: true });
  assert.equal(ready.authority, 'sqlite-primary-store');
  assert.equal(ready.accountKey, 'wa-authority');
  assert.equal(ready.usable, true);
  assert.equal(ready.registered, true);
  assert.equal(ready.currentEpoch, 4);
  assert.equal(ready.state, 'ACTIVE');
  assert.deepEqual(inspected, ['wa-authority']);
  assert.equal(Object.prototype.hasOwnProperty.call(ready, 'directory'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ready, 'legacyDirectory'), false);

  repositoryState = { ...repositoryState, state: 'LOGGED_OUT', registered: false, usable: false };
  adapter.invalidateCredentialState('wa-authority');
  const loggedOut = adapter.credentialState('wa-authority', { force: true });
  assert.equal(loggedOut.state, 'LOGGED_OUT');
  assert.equal(loggedOut.usable, false);
  assert.equal(adapter.hasCredentials('wa-authority'), false);
});

test('WhatsApp readiness diagnostics never expose auth leases, sockets or credential material', () => {
  const adapter = new WhatsAppAdapter();
  adapter.accounts.set('wa-redacted', {
    state: 'online',
    databaseAccountId: 'wa-database',
    socket: { secret: 'socket-secret' },
    socketToken: 'socket-token-secret',
    authLease: { state: { creds: { secret: 'credential-secret' }, keys: { secret: 'key-secret' } } },
    authEpoch: 7,
    user: { name: 'Ready Account' }
  });
  const status = adapter.status()[0];
  const serialized = JSON.stringify(status);
  assert.equal(status.state, 'online');
  assert.equal(serialized.includes('socket-secret'), false);
  assert.equal(serialized.includes('socket-token-secret'), false);
  assert.equal(serialized.includes('credential-secret'), false);
  assert.equal(serialized.includes('key-secret'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'authLease'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'socket'), false);
});
`;
  if (source.includes('WhatsApp credential readiness comes only from the shared SQLite auth repository authority')) {
    throw new Error('production readiness contract already added');
  }
  write(relative, `${source}${addition}\n`);
}

relocateRegistrationBoundary();
updateMessageOrderingFixture();
updateRepositoryContract();
updateProductionReadinessContract();
