'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/replyLanguageAuthority');

test('latest incoming language overrides stale observed profile unless user explicitly locked a language', () => {
  const automatic = authority.resolve({
    contactLanguage: { currentLanguage: 'de', confidence: 0.99 },
    incomingMessage: { text: 'Thanks, tomorrow works well for me.' },
    persona: { truthSafePacket: { preferredLanguage: 'Deutsch' } }
  });
  assert.equal(automatic.code, 'en');
  assert.equal(automatic.source, 'latest_incoming_detected');

  const locked = authority.resolve({
    contactLanguage: { userOverride: 'de', currentLanguage: 'en' },
    incomingMessage: { text: 'Thanks, tomorrow works well for me.' }
  });
  assert.equal(locked.code, 'de');
  assert.equal(locked.source, 'user_override');
});

test('candidate language guard blocks Chinese text for an English customer and tolerates short undetected text', () => {
  const expected = authority.authorityRecord('en', 'latest_incoming_detected', 0.95);
  const mismatch = authority.validateCandidate('听起来很不错，我们明天再聊。', expected);
  assert.equal(mismatch.pass, false);
  assert.equal(mismatch.reasonCode, 'AI_REPLY_LANGUAGE_MISMATCH');
  assert.equal(mismatch.expectedCode, 'en');
  assert.equal(mismatch.actualCode, 'zh');

  const short = authority.validateCandidate('Okay 😊', expected);
  assert.equal(short.pass, true);
  assert.equal(short.status, 'unverified_output');
});


test('script detection preserves Russian and Arabic compatibility when no explicit language hint exists', () => {
  assert.equal(authority.resolve({ incomingMessage: { text: 'Спасибо, поговорим завтра.' } }).code, 'ru');
  assert.equal(authority.resolve({ incomingMessage: { text: 'شكرا، نتحدث غدا.' } }).code, 'ar');
  assert.equal(authority.validateCandidate('Спасибо, поговорим завтра.', authority.authorityRecord('ru', 'latest_incoming_detected', 0.95)).pass, true);
  assert.equal(authority.validateCandidate('听起来不错。', authority.authorityRecord('ar', 'latest_incoming_detected', 0.95)).pass, false);
});
