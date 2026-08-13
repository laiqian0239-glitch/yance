'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inferTargetLanguage } = require('../services/contextAwareReplyBrain');
const { chineseFirst } = require('../services/localizedContentAuthority');

test('contact language authority overrides Chinese UI/persona preference for customer replies', () => {
  const target = inferTargetLanguage({
    contactLanguage: { currentLanguage: 'de', confidence: 0.95 },
    persona: { truthSafePacket: { preferredLanguage: '中文' } },
    incomingMessage: { text: 'Danke für deine Nachricht.' }
  });
  assert.equal(target, 'German');
});

test('relationship trajectory reads the Chinese understanding overlay without losing original evidence', () => {
  const insight = {
    summary: 'The customer is open to meeting.',
    nextAction: 'Suggest a date.',
    evidence: [{ quote: 'Gern, nächste Woche.', label: 'acceptance', source: 'message', confidence: 0.9 }],
    chineseUnderstanding: {
      summary: '客户愿意见面。',
      nextAction: '建议一个具体日期。',
      evidence: [{ translatedZh: '好的，下周吧。', label: '接受邀请' }]
    }
  };
  const localized = chineseFirst(insight);
  assert.equal(localized.summary, '客户愿意见面。');
  assert.equal(localized.evidence[0].quote, 'Gern, nächste Woche.');
  assert.equal(localized.evidence[0].translatedZh, '好的，下周吧。');
});

test('reply learning retains bounded language and generation provenance without private reply text', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',targetLanguage:'de',modelId:'m1',personaTruthReceipt:{pass:true},generationMetadata:{targetLanguageCode:'de',modelId:'m1'}});assert.equal(row.signal.metadata.targetLanguage,'de');assert.equal(row.signal.metadata.modelId,'m1');assert.equal(row.signal.metadata.rawPrivateChatPersisted,false); });

test('conversation runtime exposes bilingual display, translation retry and explicit contact-language controls', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-bilingual-experience-runtime.js'), 'utf8');
  assert.match(source, /chatTranslationMode/);
  assert.match(source, /setTranslationMode/);
  assert.match(source, /createTranslationJob/);
  assert.match(source, /cancelTranslationJob/);
  assert.match(source, /setContactLanguage/);
  assert.match(source, /中文只用于你理解/);
});

test('relationship and media views prefer Chinese understanding while retaining original text', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const insightSource = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-insights-runtime.js'), 'utf8');
  const mediaSource = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(insightSource, /chineseUnderstanding/);
  assert.match(insightSource, /localizedObject/);
  assert.match(mediaSource, /bilingual-original/);
  assert.match(mediaSource, /chineseFirstContent/);
});
