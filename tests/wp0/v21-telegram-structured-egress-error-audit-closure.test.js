'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TelegramAdapter } = require('../../backend/services/telegramAdapter');
const expressionReferences = require('../../backend/services/telegramExpressionReferenceService');

const ACCOUNT_ID = 'telegram-egress-account';
const CHAT_ID = '424242';

function installConnected(adapter, client) {
  adapter.sessions.set(ACCOUNT_ID, { client, state: 'connected' });
}

function fakeApi() {
  class Empty {
    constructor(input = {}) { Object.assign(this, input); }
  }
  return {
    ReactionEmoji: Empty,
    SendMessageCancelAction: Empty,
    SendMessageTypingAction: Empty,
    messages: {
      SendReaction: Empty,
      SetTyping: Empty
    }
  };
}

async function expectStructuredProviderFailure(method, operation, invoke, providerError) {
  await assert.rejects(
    invoke,
    error => {
      assert.notEqual(error?.code, 'SQLITE_BROKER_NOT_READY', `${method}: diagnostic must not depend on SQLite broker state`);
      assert.notEqual(error, providerError, `${method}: raw GramJS provider error must not escape unchanged`);
      assert.equal(typeof error?.code, 'string', `${method}: provider rejection requires stable code`);
      assert.ok(error.code.startsWith('TELEGRAM_EGRESS_'), `${method}: provider rejection code must remain Telegram egress scoped`);
      assert.ok(Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599, `${method}: provider rejection requires stable HTTP-style status`);
      assert.equal(error?.outcomeUnknown, true, `${method}: provider rejection cannot prove remote failure`);
      assert.equal(error?.automaticRetryBlocked, true, `${method}: uncertain provider rejection must block automatic resend`);
      assert.equal(error?.platform, 'telegram', `${method}: provider rejection requires platform metadata`);
      assert.equal(error?.accountId, ACCOUNT_ID, `${method}: provider rejection requires account metadata`);
      assert.equal(error?.operation, operation, `${method}: provider rejection requires physical operation metadata`);
      assert.equal(error?.causeMessage, providerError.message, `${method}: provider rejection preserves bounded cause evidence`);
      return true;
    }
  );
}

function rejectingError(method) {
  return new Error(`simulated-${method}-provider-reject`);
}

test('Telegram physical egress provider rejections are conservatively normalized at the adapter boundary', async t => {
  await t.test('sendNativeExpression', async t => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('native-expression');
    installConnected(adapter, { async sendFile() { throw providerError; } });
    const created = expressionReferences.create({ accountId: ACCOUNT_ID, kind: 'sticker', document: { id: 'document-1' } });
    t.after(() => expressionReferences.revoke(created.reference));
    await expectStructuredProviderFailure(
      'sendNativeExpression',
      'native-expression',
      () => adapter.sendNativeExpression(ACCOUNT_ID, CHAT_ID, created.reference, {}),
      providerError
    );
  });

  await t.test('sendText', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('text');
    installConnected(adapter, { async sendMessage() { throw providerError; } });
    await expectStructuredProviderFailure(
      'sendText',
      'text',
      () => adapter.sendText(ACCOUNT_ID, CHAT_ID, 'hello'),
      providerError
    );
  });

  await t.test('sendMedia', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('media');
    installConnected(adapter, { async sendFile() { throw providerError; } });
    await expectStructuredProviderFailure(
      'sendMedia',
      'media',
      () => adapter.sendMedia(ACCOUNT_ID, CHAT_ID, { kind: 'document', filePath: __filename }),
      providerError
    );
  });

  await t.test('sendReaction', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('reaction');
    adapter.loadSdk = () => ({ Api: fakeApi() });
    installConnected(adapter, {
      async getInputEntity() { return { id: 'peer-1' }; },
      async invoke() { throw providerError; }
    });
    await expectStructuredProviderFailure(
      'sendReaction',
      'reaction',
      () => adapter.sendReaction(ACCOUNT_ID, CHAT_ID, '100', '👍'),
      providerError
    );
  });

  await t.test('revokeMessage', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('revoke');
    installConnected(adapter, { async deleteMessages() { throw providerError; } });
    await expectStructuredProviderFailure(
      'revokeMessage',
      'revoke',
      () => adapter.revokeMessage(ACCOUNT_ID, CHAT_ID, '100'),
      providerError
    );
  });

  await t.test('markRead', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('read');
    installConnected(adapter, { async markAsRead() { throw providerError; } });
    await expectStructuredProviderFailure(
      'markRead',
      'read',
      () => adapter.markRead(ACCOUNT_ID, CHAT_ID, [{ id: '100' }]),
      providerError
    );
  });

  await t.test('sendPresence', async () => {
    const adapter = new TelegramAdapter();
    const providerError = rejectingError('presence');
    adapter.loadSdk = () => ({ Api: fakeApi() });
    installConnected(adapter, {
      async getInputEntity() { return { id: 'peer-1' }; },
      async invoke() { throw providerError; }
    });
    await expectStructuredProviderFailure(
      'sendPresence',
      'presence',
      () => adapter.sendPresence(ACCOUNT_ID, CHAT_ID, 'composing'),
      providerError
    );
  });
});
