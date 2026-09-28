'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTemporalContext,
  buildModelMessages,
  validateTemporalCandidate,
} = require('../services/contextAwareReplyBrain');

function staleMorningKnownZone() {
  return buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '早上好呀', sentAt: '2026-09-27T06:20:00.000Z' },
    contactTimeZone: 'Europe/Berlin',
    contactTimeZoneConfidence: 'high',
  });
}

test('stale morning greeting rejects a direct current morning reply', () => {
  const result = validateTemporalCandidate('早上好～今天怎么样？', staleMorningKnownZone());
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'AI_REPLY_TEMPORAL_MISMATCH');
});

test('stale greeting allows explicit acknowledgement of the earlier message', () => {
  const result = validateTemporalCandidate('刚看到你早上的消息，今天过得怎么样？', staleMorningKnownZone());
  assert.equal(result.pass, true);
});
test('unknown contact timezone rejects unsupported current-daypart assertions', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '早上好呀', sentAt: '2026-09-27T06:20:00.000Z' },
  });
  assert.equal(validateTemporalCandidate('下午好，今天怎么样？', temporal).pass, false);
  assert.equal(validateTemporalCandidate('刚看到你早上的消息，今天怎么样？', temporal).pass, true);
});

test('cross-day context rejects expired direct plan wording', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '今晚见', sentAt: '2026-09-26T18:00:00.000Z' },
    contactTimeZone: 'Europe/Berlin',
    contactTimeZoneConfidence: 'high',
  });
  assert.equal(temporal.replyTemporalMode, 'cross_day');
  assert.equal(validateTemporalCandidate('今晚见～', temporal).pass, false);
});

test('timeless current replies remain valid', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '最近怎么样？', sentAt: '2026-09-27T13:35:00.000Z' },
    contactTimeZone: 'Europe/Berlin',
  });
  assert.equal(validateTemporalCandidate('还不错，你呢？', temporal).pass, true);
});
test('reply model prompt carries the temporal hard rule from the packet', () => {
  const temporalContext = staleMorningKnownZone();
  const messages = buildModelMessages({
    customer: { platform: 'telegram' },
    incomingMessage: { text: '早上好呀', sentAt: temporalContext.incomingMessageInstant },
    temporalContext,
    director: {},
    persona: { truthSafePacket: {} },
    contactLanguage: {},
  });
  assert.match(messages[0].content, /时间语境/u);
  assert.match(messages[0].content, /不得机械镜像.*旧问候/u);
});
