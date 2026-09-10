'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-account-repository-concurrency-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `account-repository-concurrency-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const accountRepository = require('../repositories/accountRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');
const accountManager = require('../services/accountManager');
const whatsapp = require('../services/whatsappAdapter');

test.after(() => {
  try { closeStore(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('account repository writes queue behind an unrelated async SQLite owner instead of aborting WhatsApp login', async () => {
  const store = getStore();
  let releaseOwner;
  let ownerStarted;
  const release = new Promise(resolve => { releaseOwner = resolve; });
  const started = new Promise(resolve => { ownerStarted = resolve; });

  const owner = store.transactionAsync(async () => {
    store.setMeta('concurrent-owner', { active: true });
    ownerStarted();
    await release;
    store.setMeta('concurrent-owner', { active: false });
  });

  await started;

  let settled = false;
  const create = accountRepository.create({
    id: 'wa-concurrency-regression',
    platform: 'whatsapp',
    displayName: 'WhatsApp 账号',
    identityLabel: '登录后自动识别'
  }).finally(() => { settled = true; });

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false, 'repository write should wait for the owning transaction instead of throwing SQLITE_TRANSACTION_BUSY_CONTEXT');

  releaseOwner();
  await owner;
  const created = await create;

  assert.equal(created.id, 'wa-concurrency-regression');
  assert.equal(accountRepository.get(created.id)?.platform, 'whatsapp');
});

test('WhatsApp connect is not rolled back when its audit write overlaps another SQLite transaction', async () => {
  const store = getStore();
  const account = await accountRepository.create({
    id: 'wa-connect-regression',
    platform: 'whatsapp',
    adapterAccountId: 'wa-connect-regression',
    displayName: 'WhatsApp 账号',
    identityLabel: '登录后自动识别'
  });

  const originalStart = whatsapp.start;
  const originalStop = whatsapp.stop;
  const originalHydration = { ...accountManager.hydration };
  accountManager.hydration = {
    phase: 'ready',
    ready: true,
    startedAt: originalHydration.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    errorCode: ''
  };
  let stopped = false;
  whatsapp.start = async () => ({ accountId: account.adapterAccountId, state: 'connecting', qrReady: false, user: null });
  whatsapp.stop = async () => { stopped = true; return { ok: true, state: 'stopped' }; };

  let releaseOwner;
  let ownerStarted;
  const release = new Promise(resolve => { releaseOwner = resolve; });
  const started = new Promise(resolve => { ownerStarted = resolve; });
  const owner = store.transactionAsync(async () => {
    store.setMeta('connect-overlap-owner', { active: true });
    ownerStarted();
    await release;
  });

  try {
    await started;
    let settled = false;
    const connecting = accountManager.connect(account.id).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false, 'connect should remain pending while the audit write is serialized');

    releaseOwner();
    await owner;
    const connected = await connecting;

    assert.equal(connected.id, account.id);
    assert.equal(connected.state, 'connecting');
    assert.equal(stopped, false, 'adapter must not be stopped merely because an unrelated transaction was active');
    assert.equal(accountManager.getLifecycleState(account.id).state, 'connecting');
  } finally {
    whatsapp.start = originalStart;
    whatsapp.stop = originalStop;
    accountManager.hydration = originalHydration;
  }
});
