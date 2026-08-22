'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WhatsAppAdapter } = require('../../backend/services/whatsappAdapter');

const ACCOUNT_ID = 'account-a';
const CHAT_JID = '12025550123@s.whatsapp.net';

function persistedAttempt(overrides = {}) {
  return Object.freeze({
    executionId: 'execution-whatsapp-egress-1',
    intentId: 'intent-whatsapp-egress-1',
    attemptId: 'attempt-whatsapp-egress-1',
    claimId: 'claim-whatsapp-egress-1',
    ownerId: 'owner-whatsapp-egress-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'idempotency-whatsapp-egress-1',
    requestContentSha256: 'a'.repeat(64),
    platform: 'whatsapp',
    accountReference: ACCOUNT_ID,
    ...overrides
  });
}

function isolatedAdapter() {
  const adapter = new WhatsAppAdapter();
  adapter.resolveAccountKey = () => ACCOUNT_ID;
  return adapter;
}

function installOnlineSocket(adapter, socket) {
  adapter.accounts.set(ACCOUNT_ID, {
    socket,
    state: 'online',
    databaseAccountId: ACCOUNT_ID,
    generation: 1
  });
  adapter.generations.set(ACCOUNT_ID, 1);
}

test('WhatsApp physical egress disconnected failures expose one stable structured contract', async t => {
  const cases = [
    ['sendText', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, text: 'hello' }],
    ['sendMedia', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, kind: 'image' }],
    ['sendReaction', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, targetId: 'message-1', emoji: '👍' }],
    ['revokeMessage', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, targetId: 'message-1' }],
    ['sendPresence', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, state: 'composing' }],
    ['markRead', { accountId: ACCOUNT_ID, chatJid: CHAT_JID, messageKeys: [] }]
  ];

  for (const [method, input] of cases) {
    await t.test(method, async () => {
      const adapter = isolatedAdapter();
      await assert.rejects(
        () => adapter[method](input),
        error => {
          assert.notEqual(error?.code, 'SQLITE_BROKER_NOT_READY', `${method}: diagnostic must not depend on SQLite broker state`);
          assert.equal(error?.code, 'WHATSAPP_NOT_CONNECTED', `${method}: stable code required`);
          assert.equal(error?.status, 409, `${method}: stable status required`);
          return true;
        }
      );
    });
  }
});

test('WhatsApp local message validation failure is structured before any provider call', async () => {
  const adapter = isolatedAdapter();
  installOnlineSocket(adapter, Object.freeze({}));

  await assert.rejects(
    () => adapter.sendText({ accountId: ACCOUNT_ID, chatJid: CHAT_JID, text: '   ' }),
    error => {
      assert.notEqual(error?.code, 'SQLITE_BROKER_NOT_READY', 'local validation diagnostic must not depend on SQLite broker state');
      assert.equal(error?.code, 'MESSAGE_TEXT_EMPTY', 'empty text must expose stable code');
      assert.equal(error?.status, 400, 'empty text must expose local-validation status');
      return true;
    }
  );
});

test('WhatsApp provider rejection is conservatively normalized at the physical adapter boundary', async () => {
  const adapter = isolatedAdapter();
  const providerError = new Error('simulated-provider-reject');
  const socket = Object.freeze({
    async sendMessage() {
      throw providerError;
    }
  });
  installOnlineSocket(adapter, socket);

  await assert.rejects(
    () => adapter.sendReaction({
      accountId: ACCOUNT_ID,
      chatJid: CHAT_JID,
      targetId: 'message-provider-reject',
      emoji: '👍',
      executionGeneration: '1',
      physicalAttemptContext: persistedAttempt()
    }),
    error => {
      assert.notEqual(error?.code, 'SQLITE_BROKER_NOT_READY', 'provider diagnostic must not depend on SQLite broker state');
      assert.notEqual(error, providerError, 'raw provider error must not escape unchanged');
      assert.equal(typeof error?.code, 'string', 'provider rejection requires stable code');
      assert.ok(error.code.startsWith('WHATSAPP_EGRESS_'), 'provider rejection code must remain WhatsApp egress scoped');
      assert.ok(Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599, 'provider rejection requires stable HTTP-style status');
      assert.equal(error?.outcomeUnknown, true, 'provider rejection cannot prove remote failure');
      assert.equal(error?.automaticRetryBlocked, true, 'uncertain provider rejection must block automatic resend');
      assert.equal(error?.platform, 'whatsapp', 'provider rejection requires platform metadata');
      assert.equal(error?.accountId, ACCOUNT_ID, 'provider rejection requires account metadata');
      assert.equal(error?.operation, 'reaction', 'provider rejection requires physical operation metadata');
      assert.equal(error?.causeMessage, 'simulated-provider-reject', 'provider rejection preserves bounded cause evidence');
      return true;
    }
  );
});
