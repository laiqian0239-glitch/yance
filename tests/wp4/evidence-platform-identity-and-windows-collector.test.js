'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateProcessIdentity, processIdentityMatches } = require('../../electron/desktopHost/BackendOwnerRegistry');
const { canonicalEvidenceProcessIdentity } = require('../../tools/wp4/evidence-process-identity');
const { runContainmentJournalOrderProbe } = require('../../tools/wp4/containment-journal-order-probe');
const {
  WINDOWS_EVIDENCE_NOT_EXECUTED,
  classifyWindowsCollectorExecution,
  collectWindowsOwnerProcessIdentityEvidence,
  windowsEvidenceGovernance
} = require('../../tools/wp4/generate-evidence');

test('canonical evidence process identity is deterministic, semantically valid, and discriminator-bound', () => {
  const first = canonicalEvidenceProcessIdentity(41001, 'evidence-a');
  const same = canonicalEvidenceProcessIdentity(41001, 'evidence-a');
  const different = canonicalEvidenceProcessIdentity(41001, 'evidence-b');
  assert.equal(validateProcessIdentity(first), true);
  assert.equal(first.platform, 'test');
  assert.match(first.commandDigest, /^[a-f0-9]{64}$/);
  assert.equal(processIdentityMatches(first, same), true);
  assert.equal(processIdentityMatches(first, different), false);
});

test('tracked containment journal order probe uses canonical identity and passes directly', async () => {
  const result = await runContainmentJournalOrderProbe();
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.failures, []);
});

test('non-Windows collector result is classified as explicit required evidence gap', () => {
  const value = { status: WINDOWS_EVIDENCE_NOT_EXECUTED, platform: 'linux', reasonCode: 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_EVIDENCE_REQUIRES_WINDOWS' };
  const classified = classifyWindowsCollectorExecution({ status: 2, signal: null, error: null }, value);
  const governance = windowsEvidenceGovernance(classified);
  assert.equal(classified.exitCode, 2);
  assert.equal(classified.collectorExecutionValid, true);
  assert.deepEqual(governance.knownGaps, [{ reasonCode: 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_REAL_MACHINE_EVIDENCE_NOT_EXECUTED', status: WINDOWS_EVIDENCE_NOT_EXECUTED }]);
  assert.deepEqual(governance.finalPackagingBlockers, [{ reasonCode: 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_REAL_MACHINE_EVIDENCE_REQUIRED', status: WINDOWS_EVIDENCE_NOT_EXECUTED }]);
});

test('collector execution writes the real result and rejects false PASS classifications', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-windows-collector-test-'));
  try {
    const outputFile = path.join(root, 'collector.json');
    const result = collectWindowsOwnerProcessIdentityEvidence({ root: path.join(root, 'runtime'), outputFile });
    assert.equal(fs.existsSync(outputFile), true);
    const recorded = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    if (process.platform === 'win32') {
      assert.equal(result.status, 'PASS');
      assert.equal(result.exitCode, 0);
    } else {
      assert.equal(result.status, WINDOWS_EVIDENCE_NOT_EXECUTED);
      assert.equal(result.exitCode, 2);
      assert.equal(recorded.status, WINDOWS_EVIDENCE_NOT_EXECUTED);
    }
    assert.throws(
      () => classifyWindowsCollectorExecution({ status: 0, signal: null, error: null }, { status: WINDOWS_EVIDENCE_NOT_EXECUTED }),
      error => error?.reasonCode === 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_COLLECTOR_FAILED'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('production Windows backend-owner identity collection contains no synchronous child process or blocking retry sleep', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'desktopHost', 'BackendOwnerRegistry.js'), 'utf8');
  assert.doesNotMatch(source, /\bexecFileSync\b/u);
  assert.doesNotMatch(source, /\bAtomics\.wait\s*\(/u);
  assert.match(source, /proper-lockfile/u);
});
