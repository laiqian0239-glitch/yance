#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { createAuthorityHarness, envelope } = require('../../tests/wp5/helpers');
const { resultEnvelope, runCase, writeJson } = require('./common');

async function expectCode(operation, code) { let error; try { await operation(); } catch (cause) { error = cause; } assert.equal(error?.code || error?.reasonCode, code); return { reasonCode: code }; }
async function main() {
  const cases = [];
  cases.push(await runCase('C01_CONCURRENT_IDENTICAL_REQUEST_SINGLE_APPLY', async () => {
    const h = await createAuthorityHarness(); let release; const barrier = new Promise(resolve => { release = resolve; }); let applies = 0;
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => { applies += 1; await barrier; } }); const e = envelope({ commandId: 'same-concurrent' }); const a = gateway.transition({ targetMode: 'safeMode', commandId: e.commandId, envelope: e }); const b = gateway.transition({ targetMode: 'safeMode', commandId: e.commandId, envelope: e }); await new Promise(resolve => setImmediate(resolve)); assert.equal(applies, 1); release(); const [x,y]=await Promise.all([a,b]); assert.deepEqual(x,y); return { applies, stateVersion: x.stateVersion }; } finally { await h.close(); }
  }));
  cases.push(await runCase('C02_CONCURRENT_SAME_ID_DIFFERENT_PAYLOAD_REJECTED', async () => {
    const h = await createAuthorityHarness(); let release; const barrier = new Promise(resolve => { release = resolve; });
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => barrier }); const a = envelope({ commandId: 'conflict-concurrent', operatingMode: 'safeMode' }); const first = gateway.transition({ targetMode: 'safeMode', commandId: a.commandId, envelope: a }); await new Promise(resolve => setImmediate(resolve)); const b = envelope({ commandId: 'conflict-concurrent', operatingMode: 'normal' }); const rejected = expectCode(() => gateway.transition({ targetMode: 'normal', commandId: b.commandId, envelope: b }), 'COMMAND_ID_REUSE_MISMATCH'); release(); await first; return await rejected; } finally { await h.close(); }
  }));
  cases.push(await runCase('C03_DIFFERENT_COMMAND_BLOCKED_DURING_APPLY_RECOVERY', async () => {
    const h = await createAuthorityHarness();
    try { const gateway = new OperatingModeTransitionGateway({ store: h.store, ownership: h.ownership, applyMode: async () => { throw new Error('apply'); } }); const a = envelope({ commandId: 'pending-one' }); await expectCode(() => gateway.transition({ targetMode: 'safeMode', commandId: a.commandId, envelope: a }), 'OPERATING_MODE_APPLY_FAILED'); const b = envelope({ commandId: 'pending-two', expectedStateVersion: 2, operatingMode: 'normal' }); return await expectCode(() => gateway.transition({ targetMode: 'normal', commandId: b.commandId, envelope: b }), 'OPERATING_MODE_RECOVERY_REQUIRED'); } finally { await h.close(); }
  }));
  cases.push(await runCase('C04_PUBLISH_ACK_LOSS_RECOVERS_AFTER_RESTART', async () => {
    const h1 = await createAuthorityHarness(); const { parent,currentRoot,legacyRoot }=h1; const e=envelope({commandId:'publish-restart'});
    try { const gateway=new OperatingModeTransitionGateway({store:h1.store,ownership:h1.ownership,publishMode:async()=>{throw new Error('lost');}}); await expectCode(()=>gateway.transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}),'OPERATING_MODE_PUBLISH_FAILED'); } finally { await h1.close({remove:false}); }
    const h2=await createAuthorityHarness({parent,currentRoot,legacyRoot}); let applies=0,publishes=0;
    try { const gateway=new OperatingModeTransitionGateway({store:h2.store,ownership:h2.ownership,applyMode:async()=>{applies+=1;},publishMode:async()=>{publishes+=1;}}); const r=await gateway.reconcile(); assert.equal(r.recoveredCommands,1); const replay=await gateway.transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}); assert.equal(replay.duplicate,true); return {applies,publishes,stateVersion:replay.stateVersion}; } finally { await h2.close(); }
  }));
  cases.push(await runCase('C05_CRASH_AFTER_PERSIST_BEFORE_APPLY_RECOVERS', async () => {
    const h1=await createAuthorityHarness(); const {parent,currentRoot,legacyRoot}=h1; const e=envelope({commandId:'persist-crash'});
    try { h1.store.persistOperatingModeCommand({...h1.ownership.guard(),envelope:e,targetMode:'safeMode',reason:'crash',source:'matrix'}); } finally { await h1.close({remove:false}); }
    const h2=await createAuthorityHarness({parent,currentRoot,legacyRoot}); let applies=0;
    try { const gateway=new OperatingModeTransitionGateway({store:h2.store,ownership:h2.ownership,applyMode:async()=>{applies+=1;}}); const r=await gateway.reconcile(); assert.equal(r.recoveredCommands,1); assert.equal(applies,1); return r; } finally { await h2.close(); }
  }));
  cases.push(await runCase('C06_HISTORY_SURVIVES_MULTIPLE_RESTARTS', async () => {
    const h1=await createAuthorityHarness(); const {parent,currentRoot,legacyRoot}=h1; const e=envelope({commandId:'multi-restart'}); let result;
    try { result=await new OperatingModeTransitionGateway({store:h1.store,ownership:h1.ownership}).transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}); } finally { await h1.close({remove:false}); }
    const h2=await createAuthorityHarness({parent,currentRoot,legacyRoot}); try { const replay=await new OperatingModeTransitionGateway({store:h2.store,ownership:h2.ownership}).transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}); assert.equal(replay.stateVersion,result.stateVersion); assert.equal(replay.duplicate,true); } finally { await h2.close({remove:false}); }
    const h3=await createAuthorityHarness({parent,currentRoot,legacyRoot}); try { const replay=await new OperatingModeTransitionGateway({store:h3.store,ownership:h3.ownership}).transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}); assert.equal(replay.stateVersion,result.stateVersion); return replay; } finally { await h3.close(); }
  }));
  cases.push(await runCase('C07_STALE_OLD_OWNER_CANNOT_COMMIT_AFTER_LEASE_CHANGE', async () => {
    const h=await createAuthorityHarness(); const old={...h.ownership.guard()};
    try { h.store.db.prepare("UPDATE runtime_lease SET owner_instance_id='new-owner',fencing_token=fencing_token+1 WHERE lease_name='app-runtime'").run(); return await expectCode(()=>Promise.resolve(h.store.persistOperatingModeCommand({...old,envelope:envelope({commandId:'old-owner'}),targetMode:'safeMode'})),'STALE_FENCING_TOKEN'); } finally { await h.close(); }
  }));
  cases.push(await runCase('C08_MULTIPLE_PENDING_COMMANDS_BLOCK_RECONCILE', async () => {
    const h=await createAuthorityHarness();
    try { const a=envelope({commandId:'pending-a'}); h.store.persistOperatingModeCommand({...h.ownership.guard(),envelope:a,targetMode:'safeMode'}); h.store.db.prepare(`INSERT INTO command_idempotency(command_id,envelope_sha256,envelope_json,response_json,created_at_utc,command_type,status,target_mode,committed_revision) VALUES('pending-b','x','{}','{}','2026-07-05T00:00:00Z','runtime.setOperatingMode','PERSISTED','safeMode',2)`).run(); const gateway=new OperatingModeTransitionGateway({store:h.store,ownership:h.ownership}); return await expectCode(()=>gateway.reconcile(),'OPERATING_MODE_MULTIPLE_PENDING_COMMANDS'); } finally { await h.close(); }
  }));
  cases.push(await runCase('C09_CURRENT_AUTHORITY_IGNORES_LATER_LEGACY_CHANGE', async () => {
    const h=await createAuthorityHarness();
    try { const before=h.store.snapshot(); require('node:fs').mkdirSync(h.legacyRoot,{recursive:true}); require('node:fs').writeFileSync(path.join(h.legacyRoot,'safe-mode-state.json'),JSON.stringify({active:true})); const result=h.migration.ensureAuthority(); assert.equal(result.legacyRead,false); assert.equal(h.store.snapshot().stateVersion,before.stateVersion); return result; } finally { await h.close(); }
  }));
  cases.push(await runCase('C10_NOOP_TARGET_STILL_USES_DURABLE_COMMAND_SEMANTICS', async () => {
    const h=await createAuthorityHarness();
    try { const gateway=new OperatingModeTransitionGateway({store:h.store,ownership:h.ownership}); const e=envelope({commandId:'noop-normal',expectedStateVersion:1,operatingMode:'normal'}); const r=await gateway.transition({targetMode:'normal',commandId:e.commandId,envelope:e}); const replay=await gateway.transition({targetMode:'normal',commandId:e.commandId,envelope:e}); assert.equal(replay.duplicate,true); assert.equal(replay.stateVersion,r.stateVersion); return {stateVersion:r.stateVersion}; } finally { await h.close(); }
  }));
  const report=resultEnvelope('WP5_CONCURRENCY_CRASH_MATRIX',cases); report.phase='CONVERGENCE_PRE_REVIEW'; report.identity.sourceTree=report.identity.worktreeSourceTree; report.identity.implementationCommit=report.identity.sourceCommit;
  const artifact=writeJson('concurrency-crash-matrix.json',report); console.log(JSON.stringify({status:report.status,summary:report.summary,artifact},null,2)); if(report.status!=='PASS')process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
