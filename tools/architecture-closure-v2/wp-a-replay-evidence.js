'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalHash, canonicalSerialize } = require('../../backend/services/canonicalSerialization');
const { LedgerReplayAuthority } = require('../../backend/services/ledgerReplayAuthority');
const { LedgerArchiveAuthority } = require('../../backend/services/ledgerArchiveAuthority');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function event(sequence, value) {
  const envelope = {
    ledgerSequence: sequence,
    eventId: `a7-evidence-event-${sequence}`,
    eventType: 'CounterIncremented',
    schemaVersion: 1,
    payload: { value },
    payloadSha256: canonicalHash({ value })
  };
  return Object.freeze({ ...envelope, eventSha256: canonicalHash(envelope) });
}

function generateReplayArchiveEvidence() {
  const events = Object.freeze([event(1, 2), event(2, 3)]);
  const evidenceRecords = [];

  const replay = new LedgerReplayAuthority({
    readEvents: ({ fromSequence, toSequence }) => events.filter(value => (
      value.ledgerSequence >= fromSequence && value.ledgerSequence <= toSequence
    )),
    upcastEvent: value => value,
    reduceEvent: (state, value) => ({ count: state.count + value.payload.value }),
    evidenceRecorder: record => evidenceRecords.push(record)
  }).replay({
    fromSequence: 1,
    toSequence: 2,
    initialState: { count: 0 }
  });

  let storedCanonicalJson = null;
  let retiredReceipt = null;
  const archive = new LedgerArchiveAuthority({
    readSegment: () => events,
    writeArchive: record => {
      storedCanonicalJson = record.canonicalJson;
      return Object.freeze({ archiveId: record.archiveId });
    },
    readArchive: () => storedCanonicalJson,
    retireSegment: receipt => {
      retiredReceipt = receipt;
      return Object.freeze({ retired: true });
    },
    evidenceRecorder: record => evidenceRecords.push(record)
  }).archiveSegment({
    segmentId: 'wp-a-a7-contract-segment',
    expectedFirstSequence: 1,
    expectedLastSequence: 2,
    expectedEventCount: 2
  });

  const document = {
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_A_A7_REPLAY_ARCHIVE_EVIDENCE',
    status: 'CONTRACT_EVIDENCE_GENERATED',
    workPackage: 'WP-A',
    task: 'A7',
    replay: {
      fromSequence: replay.fromSequence,
      toSequence: replay.toSequence,
      eventCount: replay.eventCount,
      stateSha256: replay.stateSha256,
      replaySha256: replay.replaySha256
    },
    archive: {
      archiveId: archive.archiveId,
      segmentId: archive.segmentId,
      firstSequence: archive.firstSequence,
      lastSequence: archive.lastSequence,
      eventCount: archive.eventCount,
      archiveSha256: archive.archiveSha256,
      retired: archive.retired,
      retirementReceiptSha256: canonicalHash(retiredReceipt)
    },
    evidenceRecords,
    governance: {
      deterministicFixtureOnly: true,
      automaticClosure: false,
      readyForPromotion: false,
      formalRelease: false,
      publish: false
    }
  };
  const evidenceSha256 = canonicalHash(document);
  return Object.freeze({ ...document, evidenceSha256 });
}

function outputPathFromArgs(argv) {
  const index = argv.indexOf('--output');
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value) throw new Error('--output requires a repository-relative path');
  const resolved = path.resolve(REPO_ROOT, value);
  if (resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error('--output must stay inside the repository');
  }
  return resolved;
}

function main() {
  const evidence = generateReplayArchiveEvidence();
  const text = `${canonicalSerialize(evidence)}\n`;
  const outputPath = outputPathFromArgs(process.argv.slice(2));
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${path.relative(REPO_ROOT, outputPath)}\n`);
    return;
  }
  process.stdout.write(text);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      pass: false,
      reasonCode: error.code || 'A7_EVIDENCE_GENERATION_FAILED',
      message: error.message,
      readyForPromotion: false
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ generateReplayArchiveEvidence });
