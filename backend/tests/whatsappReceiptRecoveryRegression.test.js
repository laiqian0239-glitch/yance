'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-whatsapp-receipt-recovery-'));
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
  instanceId: `whatsapp-receipt-recovery-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const { closeR32Store } = require('../lib/r32StoreSingleton');
const { shouldSkipDuplicateReceipt } = require('../services/whatsappAdapter');

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

const baseMessage = Object.freeze({
  id: 'local-1',
  externalMessageId: 'remote-1',
  chatJid: '15550001111@s.whatsapp.net',
  type: 'text'
});

test('WhatsApp duplicate receipt skips only when the message is already persisted', () => {
  const calls = [];
  const skipped = shouldSkipDuplicateReceipt({
    claim: { duplicate: true },
    message: baseMessage,
    accountId: 'wa-account',
    hasExternalMessage(input) { calls.push(input); return true; }
  });
  assert.equal(skipped, true);
  assert.deepEqual(calls, [{ accountId: 'wa-account', chatJid: baseMessage.chatJid, targetId: baseMessage.externalMessageId }]);
});

test('WhatsApp duplicate receipt retries when the previous SQLite write did not persist', () => {
  assert.equal(shouldSkipDuplicateReceipt({
    claim: { duplicate: true },
    message: baseMessage,
    accountId: 'wa-account',
    hasExternalMessage: () => false
  }), false);
});

test('WhatsApp reaction and revoke receipts remain replayable because their handlers are idempotent', () => {
  for (const type of ['reaction', 'revoke']) {
    let checked = false;
    assert.equal(shouldSkipDuplicateReceipt({
      claim: { duplicate: true },
      message: { ...baseMessage, type },
      accountId: 'wa-account',
      hasExternalMessage: () => { checked = true; return true; }
    }), false);
    assert.equal(checked, false);
  }
});
