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

function checkCancelled(signal) {
  if (signal?.aborted === true) {
    throw fail('LEDGER_ARCHIVE_CANCELLED', 'ledger archive operation was cancelled');
  }
}

function assertPositiveSequence(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fail('LEDGER_ARCHIVE_BOUNDARY_MISMATCH', `${label} must be a positive safe integer`, {
      label,
      value
    });
  }
}

function validateSegmentId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'segmentId is invalid', { segmentId: value });
  }
}

function validateSegment(events, options) {
  if (!Array.isArray(events) || events.length === 0) {
    throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'active ledger segment must contain events');
  }
  if (events.length !== options.expectedEventCount) {
    throw fail('LEDGER_ARCHIVE_EVENT_COUNT_MISMATCH', 'ledger segment event count mismatch', {
      expectedEventCount: options.expectedEventCount,
      actualEventCount: events.length
    });
  }

  const firstSequence = events[0]?.ledgerSequence;
  const lastSequence = events.at(-1)?.ledgerSequence;
  if (firstSequence !== options.expectedFirstSequence || lastSequence !== options.expectedLastSequence) {
    throw fail('LEDGER_ARCHIVE_BOUNDARY_MISMATCH', 'ledger segment boundaries do not match', {
      expectedFirstSequence: options.expectedFirstSequence,
      actualFirstSequence: firstSequence,
      expectedLastSequence: options.expectedLastSequence,
      actualLastSequence: lastSequence
    });
  }

  const seen = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const sequence = events[index]?.ledgerSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'ledger segment contains an invalid sequence', {
        index,
        sequence
      });
    }
    if (seen.has(sequence)) {
      throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'ledger segment contains a duplicate sequence', {
        sequence
      });
    }
    seen.add(sequence);
    const expected = options.expectedFirstSequence + index;
    if (sequence !== expected) {
      throw fail('LEDGER_ARCHIVE_BOUNDARY_MISMATCH', 'ledger segment is not contiguous', {
        index,
        expectedSequence: expected,
        actualSequence: sequence
      });
    }
  }
}

function readBackCanonicalJson(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.canonicalJson === 'string') {
    return value.canonicalJson;
  }
  throw fail('LEDGER_ARCHIVE_READBACK_FAILED', 'archive read-back must return canonical JSON bytes or text');
}

class LedgerArchiveAuthority {
  constructor(options = {}) {
    const required = ['readSegment', 'writeArchive', 'readArchive', 'retireSegment'];
    for (const name of required) {
      if (typeof options[name] !== 'function') {
        throw fail('LEDGER_ARCHIVE_DEPENDENCY_INVALID', `${name} must be a function`, { dependency: name });
      }
    }
    if (options.evidenceRecorder !== undefined && typeof options.evidenceRecorder !== 'function') {
      throw fail('LEDGER_ARCHIVE_DEPENDENCY_INVALID', 'evidenceRecorder must be a function', {
        dependency: 'evidenceRecorder'
      });
    }
    PRIVATE.set(this, Object.freeze({
      readSegment: options.readSegment,
      writeArchive: options.writeArchive,
      readArchive: options.readArchive,
      retireSegment: options.retireSegment,
      evidenceRecorder: options.evidenceRecorder || (() => {})
    }));
    Object.freeze(this);
  }

  archiveSegment(options = {}) {
    const dependencies = PRIVATE.get(this);
    if (!dependencies) throw fail('LEDGER_ARCHIVE_AUTHORITY_INVALID', 'invalid archive authority receiver');

    const segmentId = options.segmentId;
    validateSegmentId(segmentId);
    assertPositiveSequence(options.expectedFirstSequence, 'expectedFirstSequence');
    assertPositiveSequence(options.expectedLastSequence, 'expectedLastSequence');
    if (!Number.isSafeInteger(options.expectedEventCount) || options.expectedEventCount < 1) {
      throw fail('LEDGER_ARCHIVE_EVENT_COUNT_MISMATCH', 'expectedEventCount must be a positive safe integer', {
        expectedEventCount: options.expectedEventCount
      });
    }
    if (options.expectedLastSequence < options.expectedFirstSequence) {
      throw fail('LEDGER_ARCHIVE_BOUNDARY_MISMATCH', 'expected sequence boundaries are reversed');
    }
    checkCancelled(options.signal);

    let rawEvents;
    try {
      rawEvents = dependencies.readSegment(segmentId);
    } catch (cause) {
      throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'failed to read active ledger segment', { segmentId }, cause);
    }
    if (isThenable(rawEvents)) {
      throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'readSegment must be synchronous and deterministic', {
        segmentId
      });
    }
    if (!Array.isArray(rawEvents)) {
      throw fail('LEDGER_ARCHIVE_SEGMENT_INVALID', 'readSegment must return an array', { segmentId });
    }

    const events = rawEvents.map((event, index) => canonicalClone(
      event,
      'LEDGER_ARCHIVE_SEGMENT_INVALID',
      `segment event[${index}]`
    ));
    validateSegment(events, options);
    checkCancelled(options.signal);

    const archiveDocument = deepFreeze({
      schemaVersion: 1,
      documentType: 'YANCE_CANONICAL_LEDGER_ARCHIVE',
      segmentId,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length,
      events
    });
    const canonicalJson = canonicalSerialize(archiveDocument);
    const archiveSha256 = canonicalHash(archiveDocument);
    const archiveId = `ledger-archive:${segmentId}:${archiveSha256}`;
    const writeRecord = deepFreeze({
      archiveId,
      segmentId,
      canonicalJson,
      archiveSha256,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });

    try {
      const writeResult = dependencies.writeArchive(writeRecord);
      if (isThenable(writeResult)) {
        throw fail('LEDGER_ARCHIVE_WRITE_ASYNC_FORBIDDEN', 'writeArchive must be synchronous');
      }
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_WRITE_ASYNC_FORBIDDEN') throw cause;
      throw fail('LEDGER_ARCHIVE_WRITE_FAILED', 'failed to write ledger archive', {
        archiveId,
        segmentId
      }, cause);
    }

    checkCancelled(options.signal);
    let readBack;
    try {
      const value = dependencies.readArchive(archiveId);
      if (isThenable(value)) {
        throw fail('LEDGER_ARCHIVE_READBACK_ASYNC_FORBIDDEN', 'readArchive must be synchronous');
      }
      readBack = readBackCanonicalJson(value);
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_READBACK_ASYNC_FORBIDDEN') throw cause;
      throw fail('LEDGER_ARCHIVE_READBACK_FAILED', 'failed to read back ledger archive', {
        archiveId,
        segmentId
      }, cause);
    }

    if (readBack !== canonicalJson) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back does not match canonical bytes', {
        archiveId,
        segmentId,
        expectedArchiveSha256: archiveSha256
      });
    }
    let parsedReadBack;
    try {
      parsedReadBack = JSON.parse(readBack);
    } catch (cause) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back is not valid canonical JSON', {
        archiveId,
        segmentId
      }, cause);
    }
    if (canonicalHash(parsedReadBack) !== archiveSha256) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back digest mismatch', {
        archiveId,
        segmentId,
        expectedArchiveSha256: archiveSha256,
        actualArchiveSha256: canonicalHash(parsedReadBack)
      });
    }

    checkCancelled(options.signal);
    const retirementReceipt = deepFreeze({
      status: 'LEDGER_ARCHIVE_VERIFIED_FOR_RETIREMENT',
      archiveId,
      segmentId,
      archiveSha256,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });
    try {
      const retireResult = dependencies.retireSegment(retirementReceipt);
      if (isThenable(retireResult)) {
        throw fail('LEDGER_ARCHIVE_RETIRE_ASYNC_FORBIDDEN', 'retireSegment must be synchronous');
      }
      if (retireResult && typeof retireResult === 'object' && retireResult.retired === false) {
        throw fail('LEDGER_ARCHIVE_RETIRE_FORBIDDEN', 'active segment retirement was denied');
      }
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_RETIRE_FORBIDDEN' || cause?.code === 'LEDGER_ARCHIVE_RETIRE_ASYNC_FORBIDDEN') {
        throw cause;
      }
      throw fail('LEDGER_ARCHIVE_RETIRE_FORBIDDEN', 'active segment retirement failed', {
        archiveId,
        segmentId
      }, cause);
    }

    const evidence = deepFreeze({
      status: 'LEDGER_ARCHIVE_VERIFIED_AND_RETIRED',
      archiveId,
      segmentId,
      archiveSha256,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });
    try {
      const evidenceResult = dependencies.evidenceRecorder(evidence);
      if (isThenable(evidenceResult)) {
        throw fail('LEDGER_ARCHIVE_EVIDENCE_ASYNC_FORBIDDEN', 'evidenceRecorder must be synchronous');
      }
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_EVIDENCE_ASYNC_FORBIDDEN') throw cause;
      throw fail('LEDGER_ARCHIVE_EVIDENCE_FAILED', 'failed to record archive evidence', {
        archiveId,
        segmentId
      }, cause);
    }

    return deepFreeze({
      archiveId,
      segmentId,
      archiveSha256,
      canonicalJson,
      archiveDocument,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length,
      retired: true
    });
  }
}

Object.freeze(LedgerArchiveAuthority.prototype);
Object.freeze(LedgerArchiveAuthority);

module.exports = Object.freeze({ LedgerArchiveAuthority });
