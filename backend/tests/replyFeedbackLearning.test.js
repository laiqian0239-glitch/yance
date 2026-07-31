'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inferFeedbackSignals,
  applySignals,
  learnedPersonaPatch
} = require('../store/social/replyFeedbackLearningEngine');

function applyThree(signalInput) {
  let profile = {};
  let result;
  for (let index = 1; index <= 3; index += 1) {
    const signals = inferFeedbackSignals(signalInput);
    result = applySignals(profile, signals, {
      id: `e${index}`,
      eventType: signalInput.eventType,
      contactId: 'c1'
    }, { now: `2026-07-16T00:00:0${index}.000Z` });
    profile = result.profile;
  }
  return result;
}

test('reply feedback needs repeated evidence before becoming effective', () => {
  let profile = {};
  for (let index = 1; index <= 2; index += 1) {
    const result = applySignals(profile, inferFeedbackSignals({
      eventType: 'sent',
      originalText: 'This is a much longer reply with a question and several details?',
      finalText: 'Much shorter.'
    }), { id: `e${index}`, eventType: 'sent', contactId: 'c1' });
    profile = result.profile;
  }
  assert.equal(profile.effective.replyLength, undefined);
  const third = applySignals(profile, inferFeedbackSignals({
    eventType: 'sent',
    originalText: 'This is a much longer reply with a question and several details?',
    finalText: 'Much shorter.'
  }), { id: 'e3', eventType: 'sent', contactId: 'c1' });
  assert.equal(third.profile.effective.replyLength.value, 'short');
  assert.equal(third.profile.effective.questionFrequency.value, 'low');
});

test('explicit rejection reasons create strong negative style evidence', () => {
  const result = applyThree({
    eventType: 'rejected',
    rejectionReason: '太长了，而且问题太多，不要这么正式'
  });
  assert.equal(result.profile.effective.replyLength.value, 'short');
  assert.equal(result.profile.effective.questionFrequency.value, 'low');
  assert.equal(result.profile.effective.formality.value, 'casual');
});

test('learned persona patch only contains safe expression preferences', () => {
  const patch = learnedPersonaPatch({
    replyLength: { value: 'short', confidence: 0.8, evidenceCount: 3 },
    tone: { value: 'flirty', confidence: 0.75, evidenceCount: 4 },
    identity: { value: 'invented', confidence: 1, evidenceCount: 99 }
  });
  assert.equal(patch.preferences.replyLength.value, 'short');
  assert.equal(patch.preferences.tone.value, 'flirty');
  assert.equal(patch.preferences.identity, undefined);
});
