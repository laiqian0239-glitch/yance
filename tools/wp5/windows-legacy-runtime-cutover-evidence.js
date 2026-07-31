#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { LegacyRuntimeCutoverGate } = require('../../electron/desktopHost/LegacyRuntimeCutoverGate');
const { platformProcessIdentity, validateOwnerRecord } = require('../../electron/desktopHost/BackendOwnerRegistry');
const { writeJson } = require('./common');

const REQUIRED_CHECK_IDS = Object.freeze([
  'NO_OWNER_ALLOWS_STARTUP',
  'LIVE_OWNER_CONTAINED',
  'PID_REUSE_NOT_KILLED',
  'AMBIGUOUS_IDENTITY_FAILS_CLOSED'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function evidenceEnvelope(status, reasonCode, checks = [], platform = process.platform) {
  return {
    schemaVersion: 1,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    evidenceId: 'WP5_WINDOWS_LEGACY_RUNTIME_CUTOVER',
    generatedAtUtc: new Date().toISOString(),
    platform,
    status,
    reasonCode,
    productionChainExecuted: status === 'PASS',
    requiredCheckIds: [...REQUIRED_CHECK_IDS],
    checks
  };
}

function finalizeReport(checks, platform = process.platform) {
  const byId = new Map();
  const duplicates = [];
  for (const check of checks) {
    if (byId.has(check.id)) duplicates.push(check.id);
    else byId.set(check.id, check);
  }
  const missing = REQUIRED_CHECK_IDS.filter(id => !byId.has(id));
  const failed = REQUIRED_CHECK_IDS.filter(id => byId.get(id)?.status !== 'PASS');
  const complete = missing.length === 0 && duplicates.length === 0 && failed.length === 0;
  return {
    ...evidenceEnvelope(complete ? 'PASS' : 'FAIL', complete ? null : 'WP5_WINDOWS_CUTOVER_CHECK_FAILED', checks, platform),
    completeness: { missing, duplicates, failed }
  };
}

function buildActiveOwnerRecord({ pid, processIdentity, startupNonce = crypto.randomUUID() }) {
  const record = {
    schemaVersion: 1,
    state: 'RUNNING',
    ownershipActive: true,
    trusted: true,
    backendPid: Number(pid),
    startupNonce,
    backendSessionId: crypto.randomUUID(),
    fd6PipeInstanceId: crypto.randomUUID(),
    processIdentity,
    reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED',
    spawnedAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString()
  };
  validateOwnerRecord(record, { requireProcessIdentity: true, expectedPlatform: processIdentity?.platform });
  return record;
}

function staleIdentity(identity) {
  if (!identity || typeof identity !== 'object') throw new TypeError('identity is required');
  const digest = identity.commandDigest === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  return { ...identity, commandDigest: digest };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForIdentity(pid, attempts = 30, intervalMs = 100) {
  for (let index = 0; index < attempts; index += 1) {
    const identity = platformProcessIdentity(pid);
    if (identity) return identity;
    await sleep(intervalMs);
  }
  return null;
}

function writeOwner(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return sha256(fs.readFileSync(file));
}

function sourceUnchanged(file, beforeDigest) {
  return fs.existsSync(file) && sha256(fs.readFileSync(file)) === beforeDigest;
}

function spawnLegacyOwner(parent, name) {
  const script = path.join(parent, `${name}.js`);
  fs.writeFileSync(script, "setInterval(()=>{},1000);", 'utf8');
  const child = childProcess.spawn(process.execPath, [script], { stdio: 'ignore', windowsHide: true });
  return { child, script };
}

async function runWindowsEvidence() {
  if (process.platform !== 'win32') {
    return evidenceEnvelope('NOT_EXECUTED_WINDOWS_REQUIRED', 'WP5_WINDOWS_HOST_REQUIRED');
  }

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wp5-windows-cutover-'));
  const children = [];
  const checks = [];
  try {
    const noRecordRoot = path.join(parent, 'no-record', 'Yance27');
    fs.mkdirSync(noRecordRoot, { recursive: true });
    const noRecord = await new LegacyRuntimeCutoverGate({ legacyDataRoot: noRecordRoot }).execute({ gracefulMs: 300, forceMs: 300 });
    checks.push({
      id: 'NO_OWNER_ALLOWS_STARTUP',
      status: noRecord.ok === true && noRecord.state === 'LEGACY_OWNER_CLEARED' && noRecord.sourceRegistryMutated === false ? 'PASS' : 'FAIL',
      detail: noRecord
    });

    const live = spawnLegacyOwner(parent, 'legacy-owner-live');
    children.push(live.child);
    const liveIdentity = await waitForIdentity(live.child.pid);
    if (!liveIdentity) throw new Error('Unable to capture real Windows process identity for live legacy owner');
    const liveRoot = path.join(parent, 'live', 'Yance27');
    const liveOwnerFile = path.join(liveRoot, 'secure', 'desktop-backend-owner.json');
    const liveDigest = writeOwner(liveOwnerFile, buildActiveOwnerRecord({ pid: live.child.pid, processIdentity: liveIdentity }));
    const contained = await new LegacyRuntimeCutoverGate({ legacyDataRoot: liveRoot }).execute({ gracefulMs: 2500, forceMs: 2500 });
    checks.push({
      id: 'LIVE_OWNER_CONTAINED',
      status: contained.state === 'LEGACY_OWNER_EXIT_CONFIRMED' && contained.sourceRegistryMutated === false && sourceUnchanged(liveOwnerFile, liveDigest) && !isAlive(live.child.pid) ? 'PASS' : 'FAIL',
      detail: contained,
      sourceRegistryUnchanged: sourceUnchanged(liveOwnerFile, liveDigest)
    });

    const reused = spawnLegacyOwner(parent, 'legacy-owner-pid-reuse');
    children.push(reused.child);
    const reusedActualIdentity = await waitForIdentity(reused.child.pid);
    if (!reusedActualIdentity) throw new Error('Unable to capture real Windows process identity for PID reuse check');
    const reusedRoot = path.join(parent, 'pid-reuse', 'Yance27');
    const reusedOwnerFile = path.join(reusedRoot, 'secure', 'desktop-backend-owner.json');
    const reusedDigest = writeOwner(reusedOwnerFile, buildActiveOwnerRecord({ pid: reused.child.pid, processIdentity: staleIdentity(reusedActualIdentity) }));
    let reusedKillAttempts = 0;
    const reusedResult = await new LegacyRuntimeCutoverGate({
      legacyDataRoot: reusedRoot,
      killProcess: () => { reusedKillAttempts += 1; throw new Error('PID reuse check must not signal the live unrelated process'); }
    }).execute({ gracefulMs: 300, forceMs: 300 });
    checks.push({
      id: 'PID_REUSE_NOT_KILLED',
      status: reusedResult.state === 'LEGACY_OWNER_CLEARED' && reusedResult.pidReused === true && reusedKillAttempts === 0 && isAlive(reused.child.pid) && sourceUnchanged(reusedOwnerFile, reusedDigest) ? 'PASS' : 'FAIL',
      detail: reusedResult,
      killAttempts: reusedKillAttempts,
      unrelatedProcessStillLive: isAlive(reused.child.pid),
      sourceRegistryUnchanged: sourceUnchanged(reusedOwnerFile, reusedDigest)
    });

    const ambiguous = spawnLegacyOwner(parent, 'legacy-owner-ambiguous');
    children.push(ambiguous.child);
    const ambiguousIdentity = await waitForIdentity(ambiguous.child.pid);
    if (!ambiguousIdentity) throw new Error('Unable to capture real Windows process identity for ambiguous identity check');
    const ambiguousRoot = path.join(parent, 'ambiguous', 'Yance27');
    const ambiguousOwnerFile = path.join(ambiguousRoot, 'secure', 'desktop-backend-owner.json');
    const ambiguousDigest = writeOwner(ambiguousOwnerFile, buildActiveOwnerRecord({ pid: ambiguous.child.pid, processIdentity: ambiguousIdentity }));
    let ambiguousKillAttempts = 0;
    let blockedCode = '';
    try {
      await new LegacyRuntimeCutoverGate({
        legacyDataRoot: ambiguousRoot,
        captureProcessIdentity: () => null,
        killProcess: () => { ambiguousKillAttempts += 1; }
      }).execute({ gracefulMs: 50, forceMs: 50 });
    } catch (error) {
      blockedCode = error?.code || '';
    }
    checks.push({
      id: 'AMBIGUOUS_IDENTITY_FAILS_CLOSED',
      status: blockedCode === 'WP5_LEGACY_OWNER_AMBIGUOUS' && ambiguousKillAttempts === 0 && isAlive(ambiguous.child.pid) && sourceUnchanged(ambiguousOwnerFile, ambiguousDigest) ? 'PASS' : 'FAIL',
      blockedCode,
      killAttempts: ambiguousKillAttempts,
      ownerStillLive: isAlive(ambiguous.child.pid),
      sourceRegistryUnchanged: sourceUnchanged(ambiguousOwnerFile, ambiguousDigest)
    });

    return finalizeReport(checks, process.platform);
  } finally {
    for (const child of children) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

async function main() {
  const report = await runWindowsEvidence();
  const artifact = writeJson('windows-legacy-runtime-cutover.json', report);
  console.log(JSON.stringify({ ...report, artifact }, null, 2));
  if (report.status === 'FAIL') process.exitCode = 1;
  else if (report.status === 'NOT_EXECUTED_WINDOWS_REQUIRED') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_CHECK_IDS,
  evidenceEnvelope,
  finalizeReport,
  buildActiveOwnerRecord,
  staleIdentity,
  runWindowsEvidence
};
