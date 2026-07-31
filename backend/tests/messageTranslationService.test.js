'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageTranslationService } = require('../services/messageTranslationService');

function fakeStore(seed = {}) {
  const messages = new Map(Object.entries(seed));
  return {
    messages,
    getMessage(id) { return messages.get(id) || null; },
    upsertMessage(input) { messages.set(input.id, { ...input }); return input.id; }
  };
}

test('message translation is persisted with auditable fields', async () => {
  const store = fakeStore({
    m1: { id: 'm1', sessionKey: 'conv1', conversationId: 'conv1', contactId: 'c1', text: 'Guten Morgen', direction: 'inbound' }
  });
  let observed = false;
  const service = new MessageTranslationService({
    storeProvider: () => store,
    aiGateway: {},
    bilingualUnderstandingService: {
      translateToChinese: async input => ({
        sourceText: input.text,
        sourceLanguage: 'de',
        translatedZh: '早上好',
        translationStatus: 'success',
        translationModel: 'translategemma:4b',
        translatedAt: '2026-07-20T00:00:00.000Z'
      })
    },
    contactLanguageAuthority: { observeMessage: () => { observed = true; } },
    logger: { warn() {} }
  });
  const result = await service.translateMessage('m1');
  assert.equal(result.status, 'success');
  assert.equal(store.getMessage('m1').translatedZh, '早上好');
  assert.equal(store.getMessage('m1').translationModel, 'translategemma:4b');
  assert.equal(observed, true);
});

test('existing successful translation is reused until source text changes', async () => {
  const store = fakeStore({
    m1: { id: 'm1', sessionKey: 'conv1', text: 'Hallo', sourceText: 'Hallo', translatedZh: '你好', translationStatus: 'success' }
  });
  let calls = 0;
  const service = new MessageTranslationService({
    storeProvider: () => store,
    bilingualUnderstandingService: { translateToChinese: async () => { calls += 1; return {}; } },
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {} }
  });
  const result = await service.translateMessage('m1');
  assert.equal(result.status, 'cached');
  assert.equal(calls, 0);
});
