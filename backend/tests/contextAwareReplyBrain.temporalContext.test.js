'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTemporalContext,
  extractTemporalExpressions,
} = require('../services/contextAwareReplyBrain');

test('Berlin owner clock follows DST instead of a fixed UTC offset', () => {
  const before = buildTemporalContext({ now: '2026-03-29T00:30:00.000Z' });
  const after = buildTemporalContext({ now: '2026-03-29T01:30:00.000Z' });
  assert.equal(before.ownerTimeZone, 'Europe/Berlin');
  assert.equal(before.ownerLocalTime, '01:30:00');
  assert.equal(after.ownerLocalTime, '03:30:00');
});

test('known-zone stale morning greeting becomes acknowledge_previous_time', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '早上好呀', sentAt: '2026-09-27T06:20:00.000Z' },
    contactTimeZone: 'Europe/Berlin',
    contactTimeZoneConfidence: 'high',
  });
  assert.equal(temporal.contactTimeZone, 'Europe/Berlin');
  assert.equal(temporal.incomingDaypart, 'morning');
  assert.equal(temporal.elapsedSeconds, 26_400);
  assert.equal(temporal.temporalMismatch, true);
  assert.equal(temporal.replyTemporalMode, 'acknowledge_previous_time');
  assert.deepEqual(temporal.temporalExpressions, ['morning_greeting']);
});
test('cross-day good-night expression does not remain current', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '晚安，明天聊', sentAt: '2026-09-26T20:30:00.000Z' },
    contactTimeZone: 'Europe/Berlin',
    contactTimeZoneConfidence: 'high',
  });
  assert.equal(temporal.replyTemporalMode, 'cross_day');
  assert.equal(temporal.temporalMismatch, true);
  assert.ok(temporal.temporalExpressions.includes('good_night'));
  assert.ok(temporal.temporalExpressions.includes('tomorrow'));
});

test('missing or invalid message timestamp never invents elapsed time', () => {
  for (const sentAt of ['', 'not-a-date']) {
    const temporal = buildTemporalContext({
      now: '2026-09-27T13:40:00.000Z',
      incomingMessage: { text: '今天怎么样', sentAt },
      contactTimeZone: 'Europe/Berlin',
    });
    assert.equal(temporal.incomingMessageInstant, null);
    assert.equal(temporal.elapsedSeconds, null);
  }
});

test('unknown contact timezone stays neutral instead of borrowing Berlin daypart', () => {
  const temporal = buildTemporalContext({
    now: '2026-09-27T13:40:00.000Z',
    incomingMessage: { text: '早上好呀', sentAt: '2026-09-27T06:20:00.000Z' },
  });
  assert.equal(temporal.contactTimeZone, null);
  assert.equal(temporal.contactTimeZoneConfidence, 'unknown');
  assert.equal(temporal.replyTemporalMode, 'neutral_due_to_unknown_zone');
});

test('temporal expression extraction covers bounded high-value phrases', () => {
  assert.deepEqual(
    extractTemporalExpressions('Good morning，今晚再聊，我刚下班'),
    ['morning_greeting', 'tonight', 'just_off_work'],
  );
});
