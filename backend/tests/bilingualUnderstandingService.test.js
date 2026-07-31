'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/bilingualUnderstandingService');

test('detects common German and Chinese text', () => {
  assert.equal(service.inferLanguage('Danke, wir treffen uns morgen.'), 'de');
  assert.equal(service.inferLanguage('明天见'), 'zh');
});

test('Chinese input is returned without a model call', async () => {
  let called = false;
  const result = await service.translateToChinese({ text: '你好' }, { aiGateway: { execute: async () => { called = true; } } });
  assert.equal(called, false);
  assert.equal(result.translatedZh, '你好');
  assert.equal(result.translationStatus, 'success');
});

test('foreign reply receives auditable Chinese understanding', async () => {
  const result = await service.translateToChinese({ text: 'Ich freue mich auf unser Treffen.', sourceLanguage: 'de' }, {
    aiGateway: {
      execute: async input => {
        assert.equal(input.task, 'translation');
        return { text: '我很期待我们的见面。', model: 'translategemma:4b' };
      }
    }
  });
  assert.equal(result.sourceLanguage, 'de');
  assert.equal(result.translatedZh, '我很期待我们的见面。');
  assert.equal(result.translationModel, 'translategemma:4b');
});

test('translation failure is explicit and non-destructive', async () => {
  const result = await service.translateToChinese({ text: 'Hello' }, { aiGateway: { execute: async () => { throw Object.assign(new Error('offline'), { code: 'NO_MODEL' }); } } });
  assert.equal(result.sourceText, 'Hello');
  assert.equal(result.translationStatus, 'failed');
  assert.equal(result.translationErrorCode, 'NO_MODEL');
});

test('missing translation gateway is an explicit retryable failure, not a silent success', async () => {
  const result = await service.translateToChinese({ text: 'Hello' }, { aiGateway: {} });
  assert.equal(result.sourceText, 'Hello');
  assert.equal(result.translationStatus, 'failed');
  assert.equal(result.translationErrorCode, 'TRANSLATION_MODEL_UNAVAILABLE');
  assert.match(result.translationError, /翻译模型/);
});
