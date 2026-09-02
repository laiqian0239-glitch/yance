'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateProcessIdentity, processIdentityMatches, windowsProcessIdentity } = require('../../electron/desktopHost/BackendOwnerRegistry');
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


test('Windows backend-owner identity is native-first with one bounded WMI compatibility fallback', () => {
  const calls = [];

  const captured = windowsProcessIdentity(43131, (command, args, options) => {
    const script = String(args.at(-1) || '');
    calls.push({ script, timeout: options.timeout });

    if (calls.length === 1) {
      assert.match(script, /YanceNativeProcessIdentity/u);
      assert.doesNotMatch(script, /Win32_Process/u);

      const error = new Error('simulated native authority failure');
      error.code = 'ENATIVE';
      throw error;
    }

    assert.match(script, /System\.Management\.ManagementObjectSearcher/u);

    return JSON.stringify({
      ProcessId: 43131,
      CreationDate: '2026-08-31T07:00:00.1234567Z',
      ExecutablePath: 'C:\\Program Files\\Yance\\backend.exe',
      CommandLine: '"C:\\Program Files\\Yance\\backend.exe" --fd6 6'
    });
  }, 'win32', { deadlineAtMs: Date.now() + 60_000 });

  assert.equal(calls.length, 2);
  assert.equal(validateProcessIdentity(captured), true);
  assert.equal(captured.platform, 'win32');
  assert.match(captured.executablePathDigest, /^[a-f0-9]{64}$/u);
  assert.match(captured.commandDigest, /^[a-f0-9]{64}$/u);
  assert.ok(calls.every(call => Number.isFinite(call.timeout) && call.timeout > 0));
  assert.ok(
    calls.every(call => call.timeout <= 180000),
    'collector timeout must remain bounded by the parent startup lifecycle ceiling'
  );
});

test('production Windows backend-owner identity source is provider-independent native first', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'electron', 'desktopHost', 'BackendOwnerRegistry.js'),
    'utf8'
  );

  assert.match(source, /YanceNativeProcessIdentity/u);
  assert.match(source, /OpenProcess/u);
  assert.match(source, /GetProcessTimes/u);
  assert.match(source, /QueryFullProcessImageName/u);
  assert.match(source, /NtQueryInformationProcess/u);
  assert.match(source, /native-win32/u);

  assert.doesNotMatch(source, /Get-CimInstance Win32_Process/u);
  assert.doesNotMatch(source, /\bexecFileSync\b/u);
  assert.doesNotMatch(source, /\bspawnSync\b/u);
  assert.doesNotMatch(source, /\bAtomics\.wait\s*\(/u);
});

test('production Windows backend-owner identity collection contains no synchronous child process or blocking retry sleep', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'desktopHost', 'BackendOwnerRegistry.js'), 'utf8');
  assert.doesNotMatch(source, /\bexecFileSync\b/u);
  assert.doesNotMatch(source, /\bAtomics\.wait\s*\(/u);
  assert.match(source, /proper-lockfile/u);
});

test('Windows backend-owner collectors share one parent lifecycle deadline instead of independent 3000ms and 2500ms authorities', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'electron', 'desktopHost', 'BackendOwnerRegistry.js'),
    'utf8'
  );

  assert.match(source, /native-win32/u);
  assert.match(source, /system-management/u);

  assert.match(
    source,
    /deadlineAtMs|deadlineAt|identityDeadline|remainingBudget|remainingMs/u
  );

  assert.doesNotMatch(
    source,
    /const nativeExecOptions\s*=\s*\{[\s\S]{0,180}timeout:\s*3000,/u
  );

  assert.doesNotMatch(
    source,
    /const managementExecOptions\s*=\s*\{[\s\S]{0,180}timeout:\s*2500,/u
  );

  assert.doesNotMatch(source, /Get-CimInstance Win32_Process/u);
  assert.doesNotMatch(source, /\bexecFileSync\b/u);
  assert.doesNotMatch(source, /\bAtomics\.wait\s*\(/u);
});
