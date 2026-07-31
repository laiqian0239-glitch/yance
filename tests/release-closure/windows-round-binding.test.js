'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256File, validateRoundPair } = require('../../tools/release-closure/windows-round-binding');
const { createRecord } = require('../../tools/release-closure/create-windows-preacceptance');

function writeRound(root, round, overrides = {}) {
  const file = path.join(root, `round${round}.json`);
  const row = {
    schemaVersion: 3,
    documentType: 'YANCE_WINDOWS_VERIFY_WP7_ROUND_RESULT',
    round,
    verificationMode: 'STRICT',
    formalRoundEligible: true,
    status: 'PASS',
    branch: 'rebuild/windows-release-closure-test',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    bundleSha256: 'c'.repeat(64),
    runnerSha256: 'd'.repeat(64),
    node: 'v22.16.0',
    npm: '10.9.2',
    repositoryCleanBefore: true,
    repositoryCleanAfter: true,
    gitFsckBefore: 'PASS',
    gitFsckAfter: 'PASS',
    verifyWp7ExitCode: 0,
    completedAtUtc: `2026-07-17T0${round}:00:00.000Z`,
    ...overrides
  };
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`);
  return { file, sha256: sha256File(file), row };
}

test('formal Builder binding requires two independent strict PASS rounds with identical identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round-binding-'));
  try {
    const one = writeRound(root, 1);
    const two = writeRound(root, 2);
    const binding = validateRoundPair({ round1Result: one.file, round1Sha256: one.sha256, round2Result: two.file, round2Sha256: two.sha256 });
    assert.equal(binding.status, 'PASS');
    assert.equal(binding.commit, 'a'.repeat(40));
    assert.equal(binding.round1.sha256, one.sha256);
    assert.equal(binding.round2.sha256, two.sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('diagnostic, dirty or differently bound rounds are rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round-binding-fail-'));
  try {
    const one = writeRound(root, 1);
    const diagnostic = writeRound(root, 2, { verificationMode: 'DIAGNOSTIC', formalRoundEligible: false });
    assert.throws(() => validateRoundPair({ round1Result: one.file, round1Sha256: one.sha256, round2Result: diagnostic.file, round2Sha256: diagnostic.sha256 }), /not formal-builder eligible/);
    const different = writeRound(root, 2, { runnerSha256: 'e'.repeat(64) });
    assert.throws(() => validateRoundPair({ round1Result: one.file, round1Sha256: one.sha256, round2Result: different.file, round2Sha256: different.sha256 }), /not identically bound/);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('preacceptance record is generated directly from the validated round pair', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-preacceptance-'));
  try {
    const one = writeRound(root, 1);
    const two = writeRound(root, 2);
    const record = createRecord({ round1Result: one.file, round1Sha256: one.sha256, round2Result: two.file, round2Sha256: two.sha256 });
    assert.equal(record.decision, 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING');
    assert.equal(record.windowsInternalValidation.status, 'PASS_TWO_INDEPENDENT_STRICT_ROUNDS');
    assert.equal(record.windowsInternalValidation.round1ResultSha256, one.sha256);
    assert.equal(record.windowsInternalValidation.round2ResultSha256, two.sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
