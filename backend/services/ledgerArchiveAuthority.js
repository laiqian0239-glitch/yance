'use strict';

const {
  canonicalHash,
  canonicalSerialize
} = require('./canonicalSerialization');

const PRIVATE = new WeakMap();
const SNAPSHOT_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

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

function validateSnapshotToken(value) {
  if (typeof value !== 'string' || !SNAPSHOT_TOKEN_PATTERN.test(value)) {
    throw fail('LEDGER_ARCHIVE_SNAPSHOT_INVALID', 'segment snapshotToken is invalid', {
      snapshotToken: value
    });
  }
}

function normalizeSnapshot(rawSnapshot, requestedSegmentId) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) {
    throw fail(
      'LEDGER_ARCHIVE_SNAPSHOT_INVALID',
      'readSegment must return a versioned snapshot object rather than an event array',
      { segmentId: requestedSegmentId }
    );
  }

  const snapshot = canonicalClone(
    rawSnapshot,
    'LEDGER_ARCHIVE_SNAPSHOT_INVALID',
    'segment snapshot'
  );
  if (snapshot.segmentId !== requestedSegmentId) {
    throw fail('LEDGER_ARCHIVE_SNAPSHOT_INVALID', 'segment snapshot identity mismatch', {
      expectedSegmentId: requestedSegmentId,
      actualSegmentId: snapshot.segmentId
    });
  }
  validateSnapshotToken(snapshot.snapshotToken);
  if (!Array.isArray(snapshot.events)) {
    throw fail('LEDGER_ARCHIVE_SNAPSHOT_INVALID', 'segment snapshot events must be an array', {
      segmentId: requestedSegmentId,
      snapshotToken: snapshot.snapshotToken
    });
  }
  return snapshot;
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

function assertWriteReceipt(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.archiveId !== expected.archiveId) {
    throw fail('LEDGER_ARCHIVE_WRITE_FAILED', 'archive writer did not acknowledge the exact archive identity', {
      expectedArchiveId: expected.archiveId,
      actualArchiveId: value?.archiveId || null
    });
  }
}

function assertEvidenceReceipt(value, evidenceSha256, context) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.recorded !== true
    || value.evidenceSha256 !== evidenceSha256
  ) {
    throw fail('LEDGER_ARCHIVE_EVIDENCE_FAILED', 'archive evidence recorder did not acknowledge exact durable evidence', {
      ...context,
      expectedEvidenceSha256: evidenceSha256,
      actualEvidenceSha256: value?.evidenceSha256 || null,
      recorded: value?.recorded === true
    });
  }
}

function assertRetirementReceipt(value, expected) {
  const matches = value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.retired === true
    && value.segmentId === expected.segmentId
    && value.snapshotToken === expected.snapshotToken
    && value.archiveId === expected.archiveId
    && value.archiveSha256 === expected.archiveSha256;
  if (!matches) {
    throw fail('LEDGER_ARCHIVE_RETIRE_FORBIDDEN', 'retirement authority did not return an exact snapshot-bound receipt', {
      expectedSegmentId: expected.segmentId,
      expectedSnapshotToken: expected.snapshotToken,
      expectedArchiveId: expected.archiveId,
      expectedArchiveSha256: expected.archiveSha256,
      actualReceipt: value && typeof value === 'object' ? value : null
    });
  }
}

class LedgerArchiveAuthority {
  constructor(options = {}) {
    const required = ['readSegment', 'writeArchive', 'readArchive', 'evidenceRecorder', 'retireSegment'];
    for (const name of required) {
      if (typeof options[name] !== 'function') {
        throw fail('LEDGER_ARCHIVE_DEPENDENCY_INVALID', `${name} must be a function`, { dependency: name });
      }
    }
    PRIVATE.set(this, Object.freeze({
      readSegment: options.readSegment,
      writeArchive: options.writeArchive,
      readArchive: options.readArchive,
      evidenceRecorder: options.evidenceRecorder,
      retireSegment: options.retireSegment
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

    let rawSnapshot;
    try {
      rawSnapshot = dependencies.readSegment(segmentId);
    } catch (cause) {
      throw fail('LEDGER_ARCHIVE_SNAPSHOT_INVALID', 'failed to read versioned ledger segment snapshot', {
        segmentId
      }, cause);
    }
    if (isThenable(rawSnapshot)) {
      throw fail('LEDGER_ARCHIVE_SNAPSHOT_INVALID', 'readSegment must be synchronous and deterministic', {
        segmentId
      });
    }

    const snapshot = normalizeSnapshot(rawSnapshot, segmentId);
    const events = snapshot.events;
    validateSegment(events, options);
    checkCancelled(options.signal);

    const archiveDocument = deepFreeze({
      schemaVersion: 1,
      documentType: 'YANCE_CANONICAL_LEDGER_ARCHIVE',
      segmentId,
      snapshotToken: snapshot.snapshotToken,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length,
      events
    });
    const canonicalJson = canonicalSerialize(archiveDocument);
    const archiveSha256 = canonicalHash(archiveDocument);
    const archiveId = `ledger-archive:${segmentId}:${archiveSha256}`;
    const archiveContext = Object.freeze({
      archiveId,
      segmentId,
      snapshotToken: snapshot.snapshotToken,
      archiveSha256
    });
    const writeRecord = deepFreeze({
      ...archiveContext,
      canonicalJson,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });

    try {
      const writeResult = dependencies.writeArchive(writeRecord);
      if (isThenable(writeResult)) {
        throw fail('LEDGER_ARCHIVE_WRITE_ASYNC_FORBIDDEN', 'writeArchive must be synchronous');
      }
      assertWriteReceipt(writeResult, archiveContext);
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_WRITE_ASYNC_FORBIDDEN') throw cause;
      if (cause?.code === 'LEDGER_ARCHIVE_WRITE_FAILED') throw cause;
      throw fail('LEDGER_ARCHIVE_WRITE_FAILED', 'failed to write ledger archive', archiveContext, cause);
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
      throw fail('LEDGER_ARCHIVE_READBACK_FAILED', 'failed to read back ledger archive', archiveContext, cause);
    }

    if (readBack !== canonicalJson) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back does not match canonical bytes', archiveContext);
    }
    let parsedReadBack;
    try {
      parsedReadBack = JSON.parse(readBack);
    } catch (cause) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back is not valid canonical JSON', archiveContext, cause);
    }
    const actualArchiveSha256 = canonicalHash(parsedReadBack);
    if (actualArchiveSha256 !== archiveSha256) {
      throw fail('LEDGER_ARCHIVE_DIGEST_MISMATCH', 'archive read-back digest mismatch', {
        ...archiveContext,
        actualArchiveSha256
      });
    }
    if (
      parsedReadBack.segmentId !== segmentId
      || parsedReadBack.snapshotToken !== snapshot.snapshotToken
      || parsedReadBack.firstSequence !== options.expectedFirstSequence
      || parsedReadBack.lastSequence !== options.expectedLastSequence
      || parsedReadBack.eventCount !== events.length
    ) {
      throw fail('LEDGER_ARCHIVE_BOUNDARY_MISMATCH', 'archive read-back identity or boundaries changed', archiveContext);
    }

    checkCancelled(options.signal);
    const retirementEvidence = deepFreeze({
      schemaVersion: 1,
      documentType: 'YANCE_LEDGER_ARCHIVE_RETIREMENT_AUTHORIZATION',
      status: 'LEDGER_ARCHIVE_VERIFIED_FOR_RETIREMENT',
      ...archiveContext,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });
    const evidenceSha256 = canonicalHash(retirementEvidence);
    try {
      const evidenceResult = dependencies.evidenceRecorder(retirementEvidence);
      if (isThenable(evidenceResult)) {
        throw fail('LEDGER_ARCHIVE_EVIDENCE_ASYNC_FORBIDDEN', 'evidenceRecorder must be synchronous');
      }
      assertEvidenceReceipt(evidenceResult, evidenceSha256, archiveContext);
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_EVIDENCE_ASYNC_FORBIDDEN') throw cause;
      if (cause?.code === 'LEDGER_ARCHIVE_EVIDENCE_FAILED') throw cause;
      throw fail('LEDGER_ARCHIVE_EVIDENCE_FAILED', 'failed to record verified retirement evidence', archiveContext, cause);
    }

    checkCancelled(options.signal);
    const retirementRequest = deepFreeze({
      status: 'LEDGER_ARCHIVE_RETIRE_EXACT_SNAPSHOT',
      ...archiveContext,
      evidenceSha256,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length
    });
    let retirementReceipt;
    try {
      retirementReceipt = dependencies.retireSegment(retirementRequest);
      if (isThenable(retirementReceipt)) {
        throw fail('LEDGER_ARCHIVE_RETIRE_ASYNC_FORBIDDEN', 'retireSegment must be synchronous');
      }
      assertRetirementReceipt(retirementReceipt, archiveContext);
    } catch (cause) {
      if (cause?.code === 'LEDGER_ARCHIVE_RETIRE_FORBIDDEN' || cause?.code === 'LEDGER_ARCHIVE_RETIRE_ASYNC_FORBIDDEN') {
        throw cause;
      }
      throw fail('LEDGER_ARCHIVE_RETIRE_FORBIDDEN', 'atomic snapshot retirement failed', archiveContext, cause);
    }

    return deepFreeze({
      ...archiveContext,
      canonicalJson,
      archiveDocument,
      firstSequence: options.expectedFirstSequence,
      lastSequence: options.expectedLastSequence,
      eventCount: events.length,
      evidenceSha256,
      retirementReceipt: canonicalClone(
        retirementReceipt,
        'LEDGER_ARCHIVE_RETIRE_FORBIDDEN',
        'retirement receipt'
      ),
      retired: true
    });
  }
}

Object.freeze(LedgerArchiveAuthority.prototype);
Object.freeze(LedgerArchiveAuthority);

module.exports = Object.freeze({ LedgerArchiveAuthority });
