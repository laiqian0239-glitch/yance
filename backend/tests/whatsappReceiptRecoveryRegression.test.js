'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
    getExternalMessage: () => ({ ...baseMessage }),
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
    getExternalMessage: () => null,
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

test('WhatsApp adapter registers one Baileys batch processor and no independent event listeners', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  assert.match(source, /createWhatsAppBaileysEventProcessor/u);
  assert.match(source, /socket\.ev\.process\(/u);
  assert.equal(source.includes('socketGuard.bind(socket.ev'), false);
  assert.equal(source.includes('socket.ev.on('), false);
  assert.match(source, /const\s+eventHandlers\s*=\s*new Map\(\)/u);
});

test('messages.upsert remains one intact handler payload so existing per-message receipt logic stays authoritative', async () => {
  const { createWhatsAppBaileysEventProcessor } = require('../services/whatsappBaileysEventProcessor');
  const upsert = Object.freeze({
    type: 'notify',
    messages: Object.freeze([
      Object.freeze({ key: Object.freeze({ id: 'm1' }) }),
      Object.freeze({ key: Object.freeze({ id: 'm2' }) })
    ])
  });
  let received = null;
  const processor = createWhatsAppBaileysEventProcessor({
    guard: Object.freeze({
      details: Object.freeze({ generation: 1, epoch: 1, socketToken: 'receipt-regression' }),
      assertCurrent() { return true; }
    }),
    handlers: {
      'messages.upsert': async payload => {
        received = payload;
        return Object.freeze({
          ok: true,
          committed: true,
          replayRequired: false,
          reasonCode: '',
          value: Object.freeze({ receiptCount: payload.messages.length })
        });
      }
    },
    createContext: () => Object.freeze({ traceId: 'receipt-regression', generation: 1, epoch: 1 })
  });

  const result = await processor.process({ 'messages.upsert': upsert });
  assert.equal(received, upsert);
  assert.equal(result.ok, true);
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].eventName, 'messages.upsert');
  assert.equal(result.stages[0].value.receiptCount, 2);
});