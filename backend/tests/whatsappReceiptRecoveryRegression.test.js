'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipDuplicateReceipt } = require('../services/whatsappAdapter');

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
