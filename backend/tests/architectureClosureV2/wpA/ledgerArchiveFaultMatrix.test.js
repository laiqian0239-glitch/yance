'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalHash, canonicalSerialize } = require('../../../services/canonicalSerialization');

function loadAuthority() {
  return require('../../../services/ledgerArchiveAuthority');
}

function events() {
  return [
    Object.freeze({ ledgerSequence: 10, eventId: 'event-10', payloadSha256: 'a'.repeat(64) }),
    Object.freeze({ ledgerSequence: 11, eventId: 'event-11', payloadSha256: 'b'.repeat(64) })
  ];
}

function snapshot() {
  return Object.freeze({
    segmentId: 'segment-2026-08',
    snapshotToken: 'snapshot:segment-2026-08:v1',
    events: Object.freeze(events())
  });
}

function archiveHarness(overrides = {}) {
  const calls = [];
  let stored = null;
  const { LedgerArchiveAuthority } = loadAuthority();
  const authority = new LedgerArchiveAuthority({
    readSegment: segmentId => {
      calls.push(['readSegment', segmentId]);
      return snapshot();
    },
    writeArchive: record => {
      calls.push(['writeArchive', record]);
      stored = record.canonicalJson;
      return Object.freeze({ archiveId: record.archiveId });
    },
    readArchive: archiveId => {
      calls.push(['readArchive', archiveId]);
      return stored;
    },
    evidenceRecorder: record => {
      calls.push(['evidence', record]);
      return Object.freeze({ recorded: true, evidenceSha256: canonicalHash(record) });
    },
    retireSegment: receipt => {
      calls.push(['retireSegment', receipt]);
      return Object.freeze({
        retired: true,
        segmentId: receipt.segmentId,
        snapshotToken: receipt.snapshotToken,
        archiveId: receipt.archiveId,
        archiveSha256: receipt.archiveSha256
      });
    },
    ...overrides
  });
  return { authority, calls, getStored: () => stored };
}

test('A7 archive authority records verified retirement evidence before atomic snapshot retirement', () => {
  const { LedgerArchiveAuthority } = loadAuthority();
  assert.equal(typeof LedgerArchiveAuthority, 'function');

  const { authority, calls } = archiveHarness();
  const result = authority.archiveSegment({
    segmentId: 'segment-2026-08',
    expectedFirstSequence: 10,
    expectedLastSequence: 11,
    expectedEventCount: 2
  });

  const writeIndex = calls.findIndex(([name]) => name === 'writeArchive');
  const readIndex = calls.findIndex(([name]) => name === 'readArchive');
  const evidenceIndex = calls.findIndex(([name]) => name === 'evidence');
  const retireIndex = calls.findIndex(([name]) => name === 'retireSegment');
  assert.ok(writeIndex >= 0 && readIndex > writeIndex && evidenceIndex > readIndex && retireIndex > evidenceIndex);
  assert.equal(result.segmentId, 'segment-2026-08');
  assert.equal(result.snapshotToken, 'snapshot:segment-2026-08:v1');
  assert.equal(result.firstSequence, 10);
  assert.equal(result.lastSequence, 11);
  assert.equal(result.eventCount, 2);
  assert.equal(result.archiveSha256, canonicalHash(result.archiveDocument));
  assert.equal(result.canonicalJson, canonicalSerialize(result.archiveDocument));
  assert.equal(result.retired, true);
  assert.equal(Object.isFrozen(result), true);
});

test('A7 archive requires a versioned segment snapshot rather than an unversioned event array', () => {
  const { authority, calls } = archiveHarness({ readSegment: () => events() });
  assert.throws(
    () => authority.archiveSegment({
      segmentId: 'segment-2026-08',
      expectedFirstSequence: 10,
      expectedLastSequence: 11,
      expectedEventCount: 2
    }),
    error => error.code === 'LEDGER_ARCHIVE_SNAPSHOT_INVALID'
  );
  assert.equal(calls.some(([name]) => name === 'writeArchive'), false);
  assert.equal(calls.some(([name]) => name === 'retireSegment'), false);
});

test('A7 archive validates event count and sequence boundaries before writing', () => {
  for (const [input, code] of [
    [{ expectedFirstSequence: 9, expectedLastSequence: 11, expectedEventCount: 2 }, 'LEDGER_ARCHIVE_BOUNDARY_MISMATCH'],
    [{ expectedFirstSequence: 10, expectedLastSequence: 12, expectedEventCount: 2 }, 'LEDGER_ARCHIVE_BOUNDARY_MISMATCH'],
    [{ expectedFirstSequence: 10, expectedLastSequence: 11, expectedEventCount: 3 }, 'LEDGER_ARCHIVE_EVENT_COUNT_MISMATCH']
  ]) {
    const { authority, calls } = archiveHarness();
    assert.throws(
      () => authority.archiveSegment({ segmentId: 'segment-2026-08', ...input }),
      error => error.code === code,
      code
    );
    assert.equal(calls.some(([name]) => name === 'writeArchive'), false, code);
    assert.equal(calls.some(([name]) => name === 'retireSegment'), false, code);
  }
});

test('A7 archive fault matrix never retires after write, read-back, integrity or evidence failure', () => {
  const scenarios = [
    {
      code: 'LEDGER_ARCHIVE_WRITE_FAILED',
      overrides: { writeArchive: () => { throw new Error('disk full'); } }
    },
    {
      code: 'LEDGER_ARCHIVE_READBACK_FAILED',
      overrides: { readArchive: () => { throw new Error('object store unavailable'); } }
    },
    {
      code: 'LEDGER_ARCHIVE_DIGEST_MISMATCH',
      overrides: { readArchive: () => '{"tampered":true}' }
    },
    {
      code: 'LEDGER_ARCHIVE_EVIDENCE_FAILED',
      overrides: { evidenceRecorder: () => { throw new Error('audit store unavailable'); } }
    }
  ];

  for (const scenario of scenarios) {
    const { authority, calls } = archiveHarness(scenario.overrides);
    assert.throws(
      () => authority.archiveSegment({
        segmentId: 'segment-2026-08',
        expectedFirstSequence: 10,
        expectedLastSequence: 11,
        expectedEventCount: 2
      }),
      error => error.code === scenario.code,
      scenario.code
    );
    assert.equal(calls.some(([name]) => name === 'retireSegment'), false, scenario.code);
  }
});

test('A7 archive rejects stale or incomplete retirement receipts', () => {
  for (const retireSegment of [
    () => undefined,
    () => Object.freeze({ retired: false }),
    receipt => Object.freeze({
      retired: true,
      segmentId: receipt.segmentId,
      snapshotToken: 'snapshot:stale:v0',
      archiveId: receipt.archiveId,
      archiveSha256: receipt.archiveSha256
    })
  ]) {
    const { authority } = archiveHarness({ retireSegment });
    assert.throws(
      () => authority.archiveSegment({
        segmentId: 'segment-2026-08',
        expectedFirstSequence: 10,
        expectedLastSequence: 11,
        expectedEventCount: 2
      }),
      error => error.code === 'LEDGER_ARCHIVE_RETIRE_FORBIDDEN'
    );
  }
});

test('A7 archive cancellation preserves the active segment and performs no write', () => {
  const controller = new AbortController();
  controller.abort();
  const { authority, calls } = archiveHarness();
  assert.throws(
    () => authority.archiveSegment({
      segmentId: 'segment-2026-08',
      expectedFirstSequence: 10,
      expectedLastSequence: 11,
      expectedEventCount: 2,
      signal: controller.signal
    }),
    error => error.code === 'LEDGER_ARCHIVE_CANCELLED'
  );
  assert.equal(calls.some(([name]) => name === 'writeArchive'), false);
  assert.equal(calls.some(([name]) => name === 'retireSegment'), false);
});
