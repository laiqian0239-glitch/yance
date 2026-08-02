'use strict';

const {
  canonicalHash,
  canonicalSerialize
} = require('./canonicalSerialization');

const PRIVATE = new WeakMap();

function fail(code, message, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isThenable(value) {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function');
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalClone(value, code, label) {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(value)));
  } catch (cause) {
    throw fail(code, `${label} must be canonically serializable`, { label }, cause);
  }
}

function assertSequence(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fail('LEDGER_REPLAY_RANGE_INVALID', `${label} must be a positive safe integer`, { label, value });
  }
}

function checkCancelled(signal) {
  if (signal?.aborted === true) {
    throw fail('LEDGER_REPLAY_CANCELLED', 'ledger replay was cancelled');
  }
}

function eventEnvelope(event) {
  const envelope = {};
  for (const [key, value] of Object.entries(event)) {
    if (key !== 'eventSha256') envelope[key] = value;
  }
  return envelope;
}

function validateSequence(events, fromSequence, toSequence) {
  const expectedCount = toSequence - fromSequence + 1;
  if (events.length !== expectedCount) {
    throw fail('LEDGER_REPLAY_SEQUENCE_GAP', 'ledger replay range is incomplete', {
      fromSequence,
      toSequence,
      expectedEventCount: expectedCount,
      actualEventCount: events.length
    });
  }

  const seen = new Set();
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const sequence = events[index]?.ledgerSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw fail('LEDGER_REPLAY_ORDER_INVALID', 'ledger event sequence is invalid', { index, sequence });
    }
    if (seen.has(sequence)) {
      throw fail('LEDGER_REPLAY_SEQUENCE_DUPLICATE', 'ledger replay contains a duplicate sequence', { sequence });
    }
    seen.add(sequence);
    if (previous !== null && sequence < previous) {
      throw fail('LEDGER_REPLAY_ORDER_INVALID', 'ledger replay events are reordered', {
        previousSequence: previous,
        sequence
      });
    }
    const expected = fromSequence + index;
    if (sequence !== expected) {
      throw fail(
        sequence > expected ? 'LEDGER_REPLAY_SEQUENCE_GAP' : 'LEDGER_REPLAY_ORDER_INVALID',
        'ledger replay sequence does not match the requested canonical range',
        { index, expectedSequence: expected, actualSequence: sequence }
      );
    }
    previous = sequence;
  }
}

class LedgerReplayAuthority {
  constructor(options = {}) {
    const required = ['readEvents', 'upcastEvent', 'reduceEvent'];
    for (const name of required) {
      if (typeof options[name] !== 'function') {
        throw fail('LEDGER_REPLAY_DEPENDENCY_INVALID', `${name} must be a function`, { dependency: name });
      }
    }
    if (options.evidenceRecorder !== undefined && typeof options.evidenceRecorder !== 'function') {
      throw fail('LEDGER_REPLAY_DEPENDENCY_INVALID', 'evidenceRecorder must be a function', {
        dependency: 'evidenceRecorder'
      });
    }
    PRIVATE.set(this, Object.freeze({
      readEvents: options.readEvents,
      upcastEvent: options.upcastEvent,
      reduceEvent: options.reduceEvent,
      evidenceRecorder: options.evidenceRecorder || (() => {})
    }));
    Object.freeze(this);
  }

  replay(options = {}) {
    const dependencies = PRIVATE.get(this);
    if (!dependencies) throw fail('LEDGER_REPLAY_AUTHORITY_INVALID', 'invalid replay authority receiver');

    const fromSequence = options.fromSequence;
    const toSequence = options.toSequence;
    assertSequence(fromSequence, 'fromSequence');
    assertSequence(toSequence, 'toSequence');
    if (toSequence < fromSequence) {
      throw fail('LEDGER_REPLAY_RANGE_INVALID', 'toSequence must not precede fromSequence', {
        fromSequence,
        toSequence
      });
    }
    checkCancelled(options.signal);

    const query = Object.freeze({ fromSequence, toSequence });
    let rawEvents;
    try {
      rawEvents = dependencies.readEvents(query);
    } catch (cause) {
      throw fail('LEDGER_REPLAY_READ_FAILED', 'failed to read canonical ledger events', query, cause);
    }
    if (isThenable(rawEvents)) {
      throw fail('LEDGER_REPLAY_READ_ASYNC_FORBIDDEN', 'readEvents must be synchronous and deterministic');
    }
    if (!Array.isArray(rawEvents)) {
      throw fail('LEDGER_REPLAY_READ_FAILED', 'readEvents must return an array');
    }

    const events = rawEvents.map((value, index) => canonicalClone(
      value,
      'LEDGER_REPLAY_EVENT_INVALID',
      `event[${index}]`
    ));
    validateSequence(events, fromSequence, toSequence);

    let state = canonicalClone(options.initialState ?? {}, 'LEDGER_REPLAY_INITIAL_STATE_INVALID', 'initialState');
    const eventIds = [];

    for (const event of events) {
      checkCancelled(options.signal);
      const actualPayloadHash = canonicalHash(event.payload);
      if (event.payloadSha256 !== actualPayloadHash) {
        throw fail('LEDGER_REPLAY_PAYLOAD_HASH_MISMATCH', 'ledger payload hash mismatch', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId,
          expectedPayloadSha256: event.payloadSha256,
          actualPayloadSha256: actualPayloadHash
        });
      }
      const actualEventHash = canonicalHash(eventEnvelope(event));
      if (event.eventSha256 !== actualEventHash) {
        throw fail('LEDGER_REPLAY_EVENT_HASH_MISMATCH', 'ledger event envelope hash mismatch', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId,
          expectedEventSha256: event.eventSha256,
          actualEventSha256: actualEventHash
        });
      }

      let upcasted;
      try {
        upcasted = dependencies.upcastEvent(event);
      } catch (cause) {
        throw fail('LEDGER_REPLAY_UPCAST_FAILED', 'ledger event upcast failed', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId
        }, cause);
      }
      if (isThenable(upcasted)) {
        throw fail('LEDGER_REPLAY_UPCAST_ASYNC_FORBIDDEN', 'upcastEvent must be synchronous and deterministic', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId
        });
      }
      const canonicalEvent = canonicalClone(
        upcasted,
        'LEDGER_REPLAY_UPCAST_FAILED',
        `upcasted event ${event.eventId}`
      );

      let nextState;
      try {
        nextState = dependencies.reduceEvent(state, canonicalEvent);
      } catch (cause) {
        throw fail('LEDGER_REPLAY_REDUCER_FAILED', 'ledger replay reducer failed', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId
        }, cause);
      }
      if (isThenable(nextState)) {
        throw fail('LEDGER_REPLAY_REDUCER_ASYNC_FORBIDDEN', 'reduceEvent must be synchronous and deterministic', {
          ledgerSequence: event.ledgerSequence,
          eventId: event.eventId
        });
      }
      state = canonicalClone(nextState, 'LEDGER_REPLAY_REDUCER_FAILED', `state after ${event.eventId}`);
      eventIds.push(String(event.eventId));
    }

    checkCancelled(options.signal);
    const stateSha256 = canonicalHash(state);
    if (options.expectedStateSha256 !== undefined && options.expectedStateSha256 !== stateSha256) {
      throw fail('LEDGER_REPLAY_STATE_HASH_MISMATCH', 'replayed state hash does not match the expected value', {
        expectedStateSha256: options.expectedStateSha256,
        actualStateSha256: stateSha256
      });
    }

    const evidence = deepFreeze({
      status: 'LEDGER_REPLAY_VERIFIED',
      fromSequence,
      toSequence,
      eventCount: events.length,
      eventIds: deepFreeze([...eventIds]),
      stateSha256
    });
    const replaySha256 = canonicalHash(evidence);
    const recordedEvidence = deepFreeze({ ...evidence, replaySha256 });
    try {
      const recorderResult = dependencies.evidenceRecorder(recordedEvidence);
      if (isThenable(recorderResult)) {
        throw fail('LEDGER_REPLAY_EVIDENCE_ASYNC_FORBIDDEN', 'evidenceRecorder must be synchronous');
      }
    } catch (cause) {
      if (cause?.code === 'LEDGER_REPLAY_EVIDENCE_ASYNC_FORBIDDEN') throw cause;
      throw fail('LEDGER_REPLAY_EVIDENCE_FAILED', 'failed to record replay evidence', {}, cause);
    }

    return deepFreeze({
      fromSequence,
      toSequence,
      eventCount: events.length,
      eventIds: [...eventIds],
      state,
      stateSha256,
      replaySha256
    });
  }
}

Object.freeze(LedgerReplayAuthority.prototype);
Object.freeze(LedgerReplayAuthority);

module.exports = Object.freeze({ LedgerReplayAuthority });
