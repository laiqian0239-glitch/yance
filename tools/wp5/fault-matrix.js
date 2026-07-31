#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { LegacyRuntimeCutoverGate } = require('../../electron/desktopHost/LegacyRuntimeCutoverGate');
const { createAuthorityHarness, envelope, tempRoot, removeRoot } = require('../../tests/wp5/helpers');
const { resultEnvelope, runCase, writeJson } = require('./common');

function createLegacyDb(root, mode = 'normal') {
  const dir = path.join(root, 'store'); fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'yance-r32.db'));
  try { db.exec('CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,state_version INTEGER NOT NULL,operating_mode TEXT NOT NULL) STRICT;'); db.prepare('INSERT INTO runtime_state VALUES(1,1,?)').run(mode); }
  finally { db.close(); }
}
async function expectCode(operation, code) {
  let thrown = null;
  try { await operation(); } catch (error) { thrown = error; }
  assert.equal(thrown?.code || thrown?.reasonCode, code, `expected ${code}, received ${thrown?.code || thrown?.reasonCode || 'no error'}`);
  return { reasonCode: code };
}

async function main() {
  const cases = [];
  cases.push(await runCase('F01_INVALID_LEGACY_MODE_BLOCKS', async () => {
    const parent = tempRoot(); const currentRoot = path.join(parent, '.yance'); const legacyRoot = path.join(parent, '.yance27'); createLegacyDb(legacyRoot, 'degraded');
    const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
    try { return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'LEGACY_OPERATING_MODE_INVALID'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F02_CONFLICTING_LEGACY_CANDIDATES_BLOCK', async () => {
    const parent = tempRoot(); const currentRoot = path.join(parent, '.yance'); const legacyRoot = path.join(parent, '.yance27'); createLegacyDb(legacyRoot, 'normal'); fs.writeFileSync(path.join(legacyRoot, 'safe-mode-state.json'), JSON.stringify({ active: true }));
    const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
    try { return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'LEGACY_RUNTIME_CANDIDATE_CONFLICT'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F03_CORRUPT_LEGACY_SQLITE_BLOCKS', async () => {
    const parent = tempRoot(); const currentRoot = path.join(parent, '.yance'); const legacyRoot = path.join(parent, '.yance27'); fs.mkdirSync(path.join(legacyRoot, 'store'), { recursive: true }); fs.writeFileSync(path.join(legacyRoot, 'store', 'yance-r32.db'), 'not sqlite');
    const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
    try { return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'LEGACY_RUNTIME_SOURCE_INVALID'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F04_MISSING_RECEIPT_BLOCKS_EXISTING_AUTHORITY', async () => {
    const h = await createAuthorityHarness();
    try { h.store.db.exec('DELETE FROM runtime_migration_receipt'); return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_INVALID'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F05_MULTIPLE_RECEIPTS_BLOCK', async () => {
    const h = await createAuthorityHarness();
    try {
      const r = h.store.getMigrationReceipt();
      h.store.db.prepare(`INSERT INTO runtime_migration_receipt(migration_id,migration_version,source_canonical_path,source_fingerprint,source_file_count,source_total_bytes,target_schema_version,status,selected_operating_mode,candidate_json,verification_json,owner_instance_id,fencing_token,started_at_utc,completed_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('duplicate',1,'','x',0,0,1,'COMMITTED','normal','[]','{}',r.ownerInstanceId,r.fencingToken,r.startedAtUtc,r.completedAtUtc);
      return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_INVALID');
    } finally { await h.close(); }
  }));
  cases.push(await runCase('F06_INCOMPLETE_RECEIPT_BLOCKS', async () => {
    const h = await createAuthorityHarness();
    try { h.store.db.exec("UPDATE runtime_migration_receipt SET status='APPLYING'"); return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_MISMATCH'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F06B_INCOMPLETE_VERIFICATION_BLOCKS', async () => {
    const h = await createAuthorityHarness();
    try {
      h.store.db.prepare("UPDATE runtime_migration_receipt SET verification_json=?").run(JSON.stringify({ sourceReadOnly: true, before: [], after: null, sourceMutationCount: 0, sourceExists: false }));
      return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_MISMATCH');
    } finally { await h.close(); }
  }));
  cases.push(await runCase('F06C_RECEIPT_FINGERPRINT_MISMATCH_BLOCKS', async () => {
    const parent = tempRoot(); const currentRoot = path.join(parent, '.yance'); const legacyRoot = path.join(parent, '.yance27'); createLegacyDb(legacyRoot, 'normal');
    const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
    try {
      h.migration.ensureAuthority();
      h.store.db.prepare("UPDATE runtime_migration_receipt SET source_fingerprint='tampered'").run();
      return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_MISMATCH');
    } finally { await h.close(); }
  }));
  cases.push(await runCase('F06D_RECEIPT_SOURCE_METADATA_MISMATCH_BLOCKS', async () => {
    const parent = tempRoot(); const currentRoot = path.join(parent, '.yance'); const legacyRoot = path.join(parent, '.yance27'); createLegacyDb(legacyRoot, 'normal');
    const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
    try {
      h.migration.ensureAuthority();
      h.store.db.prepare('UPDATE runtime_migration_receipt SET source_file_count=source_file_count+1').run();
      return await expectCode(() => Promise.resolve(h.migration.ensureAuthority()), 'RUNTIME_MIGRATION_RECEIPT_MISMATCH');
    } finally { await h.close(); }
  }));
  cases.push(await runCase('F07_STALE_FENCING_TOKEN_REJECTED', async () => {
    const h = await createAuthorityHarness();
    try {
      h.store.db.prepare("UPDATE runtime_lease SET fencing_token=fencing_token+1 WHERE lease_name='app-runtime'").run();
      const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership });
      return await expectCode(() => gateway.transition({ targetMode: 'safeMode', commandId: 'stale-fence' }), 'STALE_FENCING_TOKEN');
    } finally { await h.close(); }
  }));
  cases.push(await runCase('F08_STATE_VERSION_CONFLICT_REJECTED', async () => {
    const h = await createAuthorityHarness();
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership }); const e = envelope({ commandId: 'bad-revision', expectedStateVersion: 99 }); return await expectCode(() => gateway.transition({ targetMode: 'safeMode', commandId: e.commandId, envelope: e }), 'STATE_VERSION_CONFLICT'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F09_COMMAND_ID_MUTATION_REJECTED', async () => {
    const h = await createAuthorityHarness();
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership }); const a = envelope({ commandId: 'reuse', expectedStateVersion: 1, operatingMode: 'safeMode' }); await gateway.transition({ targetMode: 'safeMode', commandId: a.commandId, envelope: a }); const b = envelope({ commandId: 'reuse', expectedStateVersion: 2, operatingMode: 'normal' }); return await expectCode(() => gateway.transition({ targetMode: 'normal', commandId: b.commandId, envelope: b }), 'COMMAND_ID_REUSE_MISMATCH'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F10_APPLY_FAILURE_NOT_FULL_SUCCESS', async () => {
    const h = await createAuthorityHarness();
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => { throw Object.assign(new Error('injected'), { code: 'INJECTED_APPLY' }); } }); const e = envelope({ commandId: 'apply-fault' }); const detail = await expectCode(() => gateway.transition({ targetMode: 'safeMode', commandId: e.commandId, envelope: e }), 'OPERATING_MODE_APPLY_FAILED'); assert.equal(h.store.db.prepare("SELECT status FROM command_idempotency WHERE command_id='apply-fault'").get().status, 'APPLY_FAILED'); return detail; } finally { await h.close(); }
  }));
  cases.push(await runCase('F11_PUBLISH_FAILURE_NOT_FULL_SUCCESS', async () => {
    const h = await createAuthorityHarness();
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, publishMode: async () => { throw Object.assign(new Error('injected'), { code: 'INJECTED_PUBLISH' }); } }); const e = envelope({ commandId: 'publish-fault' }); const detail = await expectCode(() => gateway.transition({ targetMode: 'safeMode', commandId: e.commandId, envelope: e }), 'OPERATING_MODE_PUBLISH_FAILED'); assert.equal(h.store.db.prepare("SELECT status FROM command_idempotency WHERE command_id='publish-fault'").get().status, 'PUBLISH_FAILED'); return detail; } finally { await h.close(); }
  }));
  cases.push(await runCase('F12_LEDGER_AUTHORITY_MISMATCH_BLOCKS_RECONCILE', async () => {
    const h = await createAuthorityHarness();
    try { const e = envelope({ commandId: 'ledger-corrupt' }); h.store.persistOperatingModeCommand({ ...h.ownership.guard(), envelope: e, targetMode: 'safeMode' }); h.store.db.prepare("UPDATE command_idempotency SET committed_revision=999 WHERE command_id='ledger-corrupt'").run(); const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership }); return await expectCode(() => gateway.reconcile(), 'OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F13_GENERIC_MODE_WRITER_BYPASS_REJECTED', async () => {
    const h = await createAuthorityHarness();
    try { return await expectCode(() => Promise.resolve(h.store.updateRuntimeState({ ...h.ownership.guard(), patch: { operatingMode: 'safeMode' } })), 'OPERATING_MODE_GATEWAY_REQUIRED'); } finally { await h.close(); }
  }));
  cases.push(await runCase('F14_INVALID_LEGACY_OWNER_REGISTRY_BLOCKS', async () => {
    const parent = tempRoot(); const root = path.join(parent, '.yance27'); fs.mkdirSync(path.join(root, 'secure'), { recursive: true }); fs.writeFileSync(path.join(root, 'secure', 'desktop-backend-owner.json'), '{bad');
    try { const gate = new LegacyRuntimeCutoverGate({ legacyDataRoot: root }); return await expectCode(() => gate.execute({ gracefulMs: 10, forceMs: 10 }), 'WP5_LEGACY_OWNER_REGISTRY_INVALID'); } finally { removeRoot(parent); }
  }));
  cases.push(await runCase('F15_LEGACY_OWNER_TERMINATION_PERMISSION_BLOCKS', async () => {
    const parent = tempRoot(); const root = path.join(parent, '.yance27'); const secure = path.join(root, 'secure'); fs.mkdirSync(secure, { recursive: true }); fs.writeFileSync(path.join(secure, 'desktop-backend-owner.json'), JSON.stringify({ schemaVersion: 1, state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: 555, startupNonce: 'n', backendSessionId: 's', fd6PipeInstanceId: 'p', processIdentity: { platform: 'test', startTicks: 'owner', commandDigest: 'digest' }, reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED', updatedAtUtc: '2026-07-05T00:00:00Z' }));
    try {
      const gate = new LegacyRuntimeCutoverGate({ legacyDataRoot: root, isProcessAlive: () => true, captureProcessIdentity: () => ({ platform: 'test', startTicks: 'owner', commandDigest: 'digest' }), killProcess: () => { const e = new Error('denied'); e.code = 'EPERM'; throw e; } });
      return await expectCode(() => gate.execute({ gracefulMs: 10, forceMs: 10 }), 'WP5_LEGACY_OWNER_TERMINATION_EPERM');
    } finally { removeRoot(parent); }
  }));

  const report = resultEnvelope('WP5_FAULT_MATRIX', cases);
  report.phase='CONVERGENCE_PRE_REVIEW'; report.identity.sourceTree=report.identity.worktreeSourceTree; report.identity.implementationCommit=report.identity.sourceCommit;
  const artifact = writeJson('fault-matrix.json', report);
  console.log(JSON.stringify({ status: report.status, summary: report.summary, artifact }, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
