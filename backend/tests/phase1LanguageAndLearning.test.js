'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inferTargetLanguage } = require('../services/contextAwareReplyBrain');
const { applySignals, inferFeedbackSignals } = require('../store/social/replyFeedbackLearningEngine');
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

test('reply learning retains customer language, Chinese understanding and generation provenance', () => {
  const signals = inferFeedbackSignals({
    eventType: 'sent',
    originalText: 'Ich freue mich auf dich.',
    finalText: 'Ich freue mich sehr darauf, dich zu sehen.',
    replyStrategy: { recommendedLength: 'short' }
  });
  const result = applySignals({}, signals, {
    id: 'sent:o1',
    eventType: 'sent',
    contactId: 'c1',
    conversationId: 'conv1',
    finalText: 'Ich freue mich sehr darauf, dich zu sehen.',
    platform: 'whatsapp',
    targetLanguage: 'German',
    translatedZh: '我非常期待见到你。',
    translationModel: 'translategemma:4b',
    modelId: 'qwen3.5:4b',
    model: 'qwen3.5:4b',
    replyTask: 'quick_reply',
    styleVariant: '更温柔',
    generationMetadata: { routeTask: 'quick_reply', targetLanguage: 'German' },
    source: 'local_model'
  }, { now: '2026-07-20T00:00:00.000Z' });
  assert.equal(result.changed, true);
  const example = result.profile.recentExamples.at(-1);
  assert.equal(example.platform, 'whatsapp');
  assert.equal(example.targetLanguage, 'German');
  assert.equal(example.translatedZh, '我非常期待见到你。');
  assert.equal(example.styleVariant, '更温柔');
  assert.equal(example.generationMetadata.routeTask, 'quick_reply');
});

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
