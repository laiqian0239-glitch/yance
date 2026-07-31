'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyRuntimeGovernanceEvidence } = require('../services/runtimeGovernanceEvidenceService');
const backupRetention = require('../services/backupRetentionAuthority');
const versionAuthority = require('../services/whatsappVersionDiscoveryAuthority');
const { buildReleaseReadiness } = require('../services/systemReleaseReadiness');

function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function writeJson(root, name, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function governanceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-f25-b9-governance-'));
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const authorizationId = 'auth-1';
  const payloadSha256 = 'c'.repeat(64);
  const record = {
    schemaVersion: 3,
    documentType: 'YANCE_WINDOWS_UAT_AUTHORIZATION_RECORD',
    authorizationId,
    authorizationStatus: 'AUTHORIZED',
    candidateIdentity: { commit, tree, branch: 'development/test' },
    artifacts: {
      candidateZip: { sha256: 'd'.repeat(64) },
      sourcePayload: { sha256: payloadSha256 },
      prelaunchEvidence: { sha256: 'e'.repeat(64) }
    },
    authorizedScope: { realWindowsUat: true, evidenceCollection: true },
    independentReview: { completed: true, candidateIdentityVerified: true, prelaunchEvidenceVerified: true, packageContractVerified: true },
    governance: { windowsUatAuthorized: true, formalRelease: false }
  };
  const recordPath = writeJson(root, 'YANCE_TEST_WINDOWS_UAT_AUTHORIZATION_RECORD.json', record);
  const recordSha256 = sha(fs.readFileSync(recordPath));
  const overlay = {
    documentType: 'YANCE_WINDOWS_UAT_AUTHORIZATION_OVERLAY_DESCRIPTOR',
    appliesToCandidateZipSha256: record.artifacts.candidateZip.sha256,
    sourceIdentity: { commit, tree },
    authorization: { authorizationId, authorizationRecordSha256: recordSha256, windowsUatAuthorized: true },
    effectiveState: { formalRelease: false }
  };
  const overlayPath = writeJson(root, 'YANCE_TEST_WINDOWS_UAT_AUTHORIZATION_OVERLAY_DESCRIPTOR.json', overlay);
  const overlaySha256 = sha(fs.readFileSync(overlayPath));
  writeJson(root, 'YANCE_TEST_WINDOWS_UAT_AUTHORIZATION_RECEIPT.json', {
    documentType: 'YANCE_F25FE2E_WINDOWS_UAT_AUTHORIZATION_RECEIPT',
    status: 'REAL_WINDOWS_UAT_AUTHORIZED',
    authorizationId,
    authorizationRecordSha256: recordSha256,
    authorizationOverlaySha256: overlaySha256,
    candidateZipSha256: record.artifacts.candidateZip.sha256,
    sourceIdentity: { commit, tree },
    state: { windowsUatAuthorized: true, formalRelease: false, evidenceGateStillRequired: true }
  });
  writeJson(root, 'ROUND12_13_UAT_MANIFEST.json', {
    commit, tree, formalRelease: false, payload: { sha256: payloadSha256 }
  });
  writeJson(root, 'YANCE_AUTHORIZED_WINDOWS_UAT_LOCAL_BINDING.json', {
    documentType: 'YANCE_AUTHORIZED_WINDOWS_UAT_LOCAL_BINDING', authorizationId,
    candidateZipSha256: record.artifacts.candidateZip.sha256,
    expectedCommit: commit, expectedTree: tree, windowsUatAuthorized: true, formalRelease: false
  });
  const stdoutPath = path.join(root, 'prelaunch.stdout.log');
  const stderrPath = path.join(root, 'prelaunch.stderr.log');
  fs.writeFileSync(stdoutPath, 'prelaunch pass\n');
  fs.writeFileSync(stderrPath, '');
  const gatePath = writeJson(root, 'YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT.json', {
    documentType: 'YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT', status: 'PASS', commit, tree,
    prelaunchGatePassed: true, stdoutPath, stderrPath,
    stdoutSha256: sha(fs.readFileSync(stdoutPath)), stderrSha256: sha(fs.readFileSync(stderrPath)),
    authorizationId, authorizationRecordSha256: recordSha256, formalRelease: false
  });
  return { root, commit, tree, recordPath, gatePath };
}

test('Batch 9: runtime governance binds authorization, independent review, candidate identity and runtime gate hashes', () => {
  const fixture = governanceFixture();
  try {
    const result = verifyRuntimeGovernanceEvidence({
      repoRoot: fixture.root,
      authorizationRecordPath: fixture.recordPath,
      prelaunchGateReceiptPath: fixture.gatePath,
      releaseIdentity: { sourceCommit: fixture.commit, sourceTree: fixture.tree },
      env: {
        YANCE_WINDOWS_UAT_AUTHORIZED: '1',
        YANCE_UAT_EXPECTED_COMMIT: fixture.commit,
        YANCE_UAT_EXPECTED_TREE: fixture.tree
      }
    });
    assert.equal(result.pass, true);
    assert.equal(result.sourcePreReviewPassed, true);
    assert.equal(result.windowsUatAuthorized, true);
    assert.equal(result.formalRelease, false);
    assert.ok(result.recordSha256);
    assert.ok(result.gateReceiptSha256);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Batch 9: governance binding fails closed when runtime gate or identity is tampered', () => {
  const fixture = governanceFixture();
  try {
    const gate = JSON.parse(fs.readFileSync(fixture.gatePath, 'utf8'));
    gate.tree = 'f'.repeat(40);
    fs.writeFileSync(fixture.gatePath, JSON.stringify(gate));
    const result = verifyRuntimeGovernanceEvidence({
      repoRoot: fixture.root,
      authorizationRecordPath: fixture.recordPath,
      prelaunchGateReceiptPath: fixture.gatePath,
      releaseIdentity: { sourceCommit: fixture.commit, sourceTree: fixture.tree },
      env: { YANCE_WINDOWS_UAT_AUTHORIZED: '1', YANCE_UAT_EXPECTED_COMMIT: fixture.commit, YANCE_UAT_EXPECTED_TREE: fixture.tree }
    });
    assert.equal(result.pass, false);
    assert.equal(result.reasonCode, 'SOURCE_PRE_REVIEW_RUNTIME_GATE_NOT_VERIFIED');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('Batch 9: release readiness exposes Windows UAT authorization as an independent gate', () => {
  const result = buildReleaseReadiness({
    health: { criticalCount: 0, highCount: 0, fail: 0 }, integrity: { failed: 0 }, coreFailures: [],
    sourcePreReviewPassed: true, windowsUatAuthorized: false, windowsFinalPassed: false, accounts: { rows: [] }
  });
  assert.equal(result.layers.find(row => row.id === 'source-pre-review').status, 'pass');
  assert.equal(result.layers.find(row => row.id === 'windows-uat-authorization').status, 'skipped');
  assert.equal(result.ready, false);
});

test('Batch 9: retention removes old automatic restore points but preserves manual, protection and referenced points', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-f25-b9-retention-'));
  try {
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const mk = (name, label, daysAgo, totalBytes = 10) => {
      const dir = path.join(root, name); fs.mkdirSync(dir);
      return { name, dir, manifest: { label, createdAt: new Date(now - daysAgo * 86400000).toISOString(), totalBytes } };
    };
    const rows = [
      mk('auto-new', 'automatic-pre-r32-upgrade', 1),
      mk('auto-mid', 'automatic-pre-r32-upgrade', 10),
      mk('auto-old', 'automatic-pre-r32-upgrade', 60),
      mk('manual-old', 'manual', 300),
      mk('protection-old', 'pre_restore_abc', 300),
      mk('auto-referenced', 'automatic-pre-r32-upgrade', 120)
    ];
    const plan = backupRetention.planRetention(rows, {
      nowMs: now,
      policy: { maxAutomaticCount: 3, maxAutomaticAgeDays: 30, minAutomaticKeep: 2, maxTotalBytes: 1000 },
      pendingRestore: { backupName: 'auto-referenced' },
      restoreHistory: [{ state: 'completed', backupName: 'auto-old' }]
    });
    assert.ok(plan.remove.some(row => row.name === 'auto-old'));
    assert.ok(!plan.remove.some(row => row.name === 'manual-old'));
    assert.ok(!plan.remove.some(row => row.name === 'protection-old'));
    assert.ok(!plan.remove.some(row => row.name === 'auto-referenced'));
    const applied = backupRetention.applyRetention(rows, {
      nowMs: now,
      policy: { maxAutomaticCount: 3, maxAutomaticAgeDays: 30, minAutomaticKeep: 2, maxTotalBytes: 1000 },
      pendingRestore: { backupName: 'auto-referenced' },
      restoreHistory: [{ state: 'completed', backupName: 'auto-old' }], backupRoot: root
    });
    assert.equal(applied.failures.length, 0);
    assert.equal(fs.existsSync(path.join(root, 'auto-old')), false);
    assert.equal(fs.existsSync(path.join(root, 'manual-old')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Batch 9: WhatsApp version discovery uses exponential backoff and cached version without repeated network attempts', () => {
  const memory = new Map();
  const storage = {
    get: (namespace, key, fallback) => memory.get(`${namespace}:${key}`) || fallback,
    set: (namespace, key, value) => memory.set(`${namespace}:${key}`, value)
  };
  versionAuthority.resetForTests();
  versionAuthority.recordSuccess({ version: [2, 3000, 1], isLatest: true }, { storage, nowMs: 1000 });
  versionAuthority.recordFailure('VERSION_DISCOVERY_TIMEOUT', { storage, nowMs: 2000 });
  const blocked = versionAuthority.beforeAttempt({ storage, nowMs: 3000, reload: true });
  assert.equal(blocked.attempt, false);
  assert.deepEqual(blocked.cachedVersion, [2, 3000, 1]);
  const later = versionAuthority.beforeAttempt({ storage, nowMs: Date.parse(blocked.nextAttemptAt) + 1, reload: true });
  assert.equal(later.attempt, true);
});

test('Batch 9: Windows installer writes a runtime prelaunch receipt and UI exposes retention governance', () => {
  const root = path.resolve(__dirname, '..', '..');
  const installer = fs.readFileSync(path.join(root, 'tools/runtime-delivery/templates/INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1.template'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'frontend/r32-settings-recovery.js'), 'utf8');
  const center = fs.readFileSync(path.join(root, 'frontend/r32-system-center.js'), 'utf8');
  assert.match(installer, /YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT\.json/);
  assert.match(installer, /authorizationRecordSha256/);
  assert.match(installer, /YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT/);
  assert.match(settings, /恢复点生命周期/);
  assert.match(center, /自动恢复点按数量、年龄和空间统一治理/);
});
