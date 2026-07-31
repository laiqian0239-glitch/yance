'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/socialChineseUnderstandingService');

test('social Chinese understanding translates user-facing JSON and preserves original evidence quote outside the overlay', async () => {
  let prompt = '';
  const result = await service.translateBundle({
    contactId: 'c1',
    conversationId: 'conv1',
    analysis: {
      summary: 'The customer wants to meet next week.',
      evidence: [{ quote: 'Treffen wir uns nächste Woche?', translatedZh: '下周见面吗？', label: 'meeting request' }]
    },
    profile: { facts: { city: 'Berlin' } },
    insights: { nextAction: 'Confirm a suitable day.' }
  }, {
    aiGateway: {
      execute: async input => {
        prompt = input.messages[1].content;
        return {
          model: 'translategemma:4b',
          structured: {
            analysis: {
              summary: '客户希望下周见面。',
              evidence: [{ translatedZh: '下周见面吗？', label: '见面请求' }]
            },
            profile: { facts: { city: 'Berlin' } },
            insights: { nextAction: '确认合适的日期。' }
          }
        };
      }
    }
  });
  assert.equal(result.translationStatus, 'success');
  assert.equal(result.translated.analysis.summary, '客户希望下周见面。');
  assert.equal(result.translated.analysis.evidence[0].translatedZh, '下周见面吗？');
  assert.equal(result.translated.analysis.evidence[0].quote, undefined);
  assert.doesNotMatch(prompt, /Treffen wir uns nächste Woche\?/);
});

test('already-Chinese social content returns identity translation without a model call', async () => {
  let called = false;
  const result = await service.translateBundle({
    analysis: { summary: '客户表达了见面意愿。' },
    profile: {},
    insights: { nextAction: '确认日期。' }
  }, { aiGateway: { execute: async () => { called = true; } } });
  assert.equal(called, false);
  assert.equal(result.translationStatus, 'success');
  assert.equal(result.translationModel, 'identity');
});
