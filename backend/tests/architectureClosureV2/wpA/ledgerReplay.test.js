'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalHash } = require('../../../services/canonicalSerialization');

function loadAuthority() {
  return require('../../../services/ledgerReplayAuthority');
}

function event(sequence, payload = { value: sequence }, overrides = {}) {
  const base = {
    ledgerSequence: sequence,
    eventId: `event-${sequence}`,
    eventType: 'CounterIncremented',
    schemaVersion: 1,
    payload,
    payloadSha256: canonicalHash(payload)
  };
  return {
    ...base,
    eventSha256: canonicalHash(base),
    ...overrides
  };
}

function authority(events, overrides = {}) {
  const { LedgerReplayAuthority } = loadAuthority();
  return new LedgerReplayAuthority({
    readEvents: () => events,
    upcastEvent: value => value,
    reduceEvent: (state, value) => ({ count: state.count + value.payload.value }),
    evidenceRecorder: () => {},
    ...overrides
  });
}

test('A7 replay authority exists and produces deterministic frozen replay evidence', () => {
  const { LedgerReplayAuthority } = loadAuthority();
  assert.equal(typeof LedgerReplayAuthority, 'function');

  const evidence = [];
  const events = [event(1, { value: 2 }), event(2, { value: 3 })];
  const replay = authority(events, { evidenceRecorder: record => evidence.push(record) });
  const first = replay.replay({ fromSequence: 1, toSequence: 2, initialState: { count: 0 } });
  const second = replay.replay({ fromSequence: 1, toSequence: 2, initialState: { count: 0 } });

  assert.deepEqual(first.state, { count: 5 });
  assert.equal(first.stateSha256, canonicalHash({ count: 5 }));
  assert.equal(first.eventCount, 2);
  assert.equal(first.fromSequence, 1);
  assert.equal(first.toSequence, 2);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state), true);
  assert.equal(evidence.length, 2);
  assert.equal(evidence.every(record => record.status === 'LEDGER_REPLAY_VERIFIED'), true);
});

test('A7 replay rejects sequence gaps, duplicates and reordering before reducing state', () => {
  for (const [events, code] of [
    [[event(1), event(3)], 'LEDGER_REPLAY_SEQUENCE_GAP'],
    [[event(1), event(1)], 'LEDGER_REPLAY_SEQUENCE_DUPLICATE'],
    [[event(2), event(1)], 'LEDGER_REPLAY_ORDER_INVALID']
  ]) {
    let reductions = 0;
    const replay = authority(events, {
      reduceEvent: state => {
        reductions += 1;
        return state;
      }
    });
    assert.throws(
      () => replay.replay({ fromSequence: 1, toSequence: events.length, initialState: {} }),
      error => error.code === code,
      code
    );
    assert.equal(reductions, 0, code);
  }
});

test('A7 replay verifies payload and event hashes before upcast or reduce', () => {
  for (const [corrupt, code] of [
    [event(1, { value: 1 }, { payloadSha256: '0'.repeat(64) }), 'LEDGER_REPLAY_PAYLOAD_HASH_MISMATCH'],
    [event(1, { value: 1 }, { eventSha256: '0'.repeat(64) }), 'LEDGER_REPLAY_EVENT_HASH_MISMATCH']
  ]) {
    let upcasts = 0;
    let reductions = 0;
    const replay = authority([corrupt], {
      upcastEvent: value => {
        upcasts += 1;
        return value;
      },
      reduceEvent: state => {
        reductions += 1;
        return state;
      }
    });
    assert.throws(
      () => replay.replay({ fromSequence: 1, toSequence: 1, initialState: {} }),
      error => error.code === code,
      code
    );
    assert.equal(upcasts, 0, code);
    assert.equal(reductions, 0, code);
  }
});

test('A7 replay forbids asynchronous upcasters and reducers and reports deterministic failures', () => {
  const asyncUpcaster = authority([event(1)], { upcastEvent: async value => value });
  assert.throws(
    () => asyncUpcaster.replay({ fromSequence: 1, toSequence: 1, initialState: {} }),
    error => error.code === 'LEDGER_REPLAY_UPCAST_ASYNC_FORBIDDEN'
  );

  const asyncReducer = authority([event(1)], { reduceEvent: async state => state });
  assert.throws(
    () => asyncReducer.replay({ fromSequence: 1, toSequence: 1, initialState: {} }),
    error => error.code === 'LEDGER_REPLAY_REDUCER_ASYNC_FORBIDDEN'
  );
});

test('A7 replay cancellation fails closed without recording success evidence', () => {
  const controller = new AbortController();
  controller.abort();
  const evidence = [];
  const replay = authority([event(1)], { evidenceRecorder: record => evidence.push(record) });
  assert.throws(
    () => replay.replay({ fromSequence: 1, toSequence: 1, initialState: {}, signal: controller.signal }),
    error => error.code === 'LEDGER_REPLAY_CANCELLED'
  );
  assert.deepEqual(evidence, []);
});
