'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  parseArgs,
  hiddenIndexEntries,
  repositoryStatus,
  normalizedExecutable,
  diskState,
  runnerShortPathEvidence,
  windowsShortPathProbe
} = require('../../tools/release-closure/windows-verify-preflight');

function fakeSpawn(result) { return () => ({ status: 0, stdout: '', stderr: '', ...result }); }

test('Windows verification preflight requires output, source, temp and pinned npm CLI', () => {
  assert.throws(() => parseArgs(['--output', 'x']), /missing required option/);
  assert.deepEqual(parseArgs([
    '--output', 'out.json', '--source-root', 'repo', '--temp-root', 'temp', '--npm-cli', 'npm-cli.js'
  ]), { output: 'out.json', 'source-root': 'repo', 'temp-root': 'temp', 'npm-cli': 'npm-cli.js' });
});

test('hidden Git index flags reject assume-unchanged and skip-worktree entries', () => {
  const rows = ['H normal.js', 'h assume.js', 'S skip.js'].join('\n');
  assert.deepEqual(hiddenIndexEntries('.', fakeSpawn({ stdout: rows })), ['h assume.js', 'S skip.js']);
});

test('repository status preserves every dirty path for fail-closed reporting', () => {
  assert.equal(repositoryStatus('.', fakeSpawn({ stdout: ' M tools/wp7/verify.js\n?? local.txt\n' })), 'M tools/wp7/verify.js\n?? local.txt');
});

test('executable comparison is normalized for the host platform', () => {
  assert.equal(normalizedExecutable(process.execPath), normalizedExecutable(path.resolve(process.execPath)));
});

test('disk preflight reports a concrete free-space result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-preflight-disk-'));
  try {
    const result = diskState(root);
    assert.ok(['PASS', 'FAIL', 'WARN'].includes(result.status));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});




test('preflight reuses the Runner TEMP-selection evidence instead of spawning a second cmd probe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-runner-temp-evidence-'));
  const evidencePath = path.join(root, 'TEMP_SELECTION.json');
  try {
    fs.writeFileSync(evidencePath, `${JSON.stringify({
      status: 'PASS',
      selected: root,
      probes: [{
        status: 'PASS',
        reasonCode: 'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE',
        root,
        shortPath: 'C:\\YANCET~1\\YANCEL~1',
        shortPathExists: true,
        lexicallyDistinct: true,
        comparisonMethod: 'LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION'
      }]
    }, null, 2)}\n`);
    const result = runnerShortPathEvidence(root, evidencePath);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reasonCode, 'WINDOWS_SHORT_PATH_ALIAS_PREVALIDATED_BY_RUNNER');
    assert.equal(result.validationMethod, 'RUNNER_TEMP_SELECTION_EVIDENCE_REUSE');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('Runner TEMP-selection evidence fails closed when its selected root does not match preflight TEMP', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-runner-temp-evidence-mismatch-'));
  const evidencePath = path.join(root, 'TEMP_SELECTION.json');
  try {
    fs.writeFileSync(evidencePath, `${JSON.stringify({ status: 'PASS', selected: `${root}-other`, probes: [] })}\n`);
    const result = runnerShortPathEvidence(root, evidencePath);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.reasonCode, 'WINDOWS_RUNNER_TEMP_SELECTION_EVIDENCE_MISMATCH');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('short-path preflight is non-applicable off Windows without invoking COM', () => {
  if (process.platform === 'win32') return;
  const result = windowsShortPathProbe(os.tmpdir(), () => { throw new Error('spawn should not run'); });
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.equal(result.reasonCode, 'WINDOWS_SHORT_PATH_NOT_APPLICABLE');
});

test('preflight implementation contains no PowerShell COM dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'release-closure', 'windows-verify-preflight.js'), 'utf8');
  assert.doesNotMatch(source, /Scripting\.FileSystemObject|New-Object\s+-ComObject/i);
  assert.match(source, /resolveWindowsShortPath/);
});
