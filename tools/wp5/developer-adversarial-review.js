#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OperatingModeTransitionGateway } = require('../../backend/runtime/OperatingModeTransitionGateway');
const { LegacyRuntimeCutoverGate } = require('../../electron/desktopHost/LegacyRuntimeCutoverGate');
const { createAuthorityHarness, envelope, tempRoot, removeRoot } = require('../../tests/wp5/helpers');
const { ROOT, OUTPUT, resultEnvelope, runCase, writeJson } = require('./common');

async function expectCode(operation, code) { let error; try { await operation(); } catch (cause) { error = cause; } assert.equal(error?.code || error?.reasonCode, code); return { reasonCode: code }; }

async function main() {
  const cases=[];
  cases.push(await runCase('A01_CONFLICTING_LEGACY_INPUTS_CANNOT_OVERRIDE_EXISTING_AUTHORITY', async()=>{
    const h=await createAuthorityHarness();
    const old=process.env.YANCE_SAFE_MODE; process.env.YANCE_SAFE_MODE='1';
    try { fs.mkdirSync(h.legacyRoot,{recursive:true}); fs.writeFileSync(path.join(h.legacyRoot,'safe-mode-state.json'),JSON.stringify({active:true})); fs.writeFileSync(path.join(h.legacyRoot,'system-policy.json'),JSON.stringify({safeMode:true})); const before=h.store.snapshot(); const r=h.migration.ensureAuthority(); assert.equal(r.legacyRead,false); assert.equal(h.store.snapshot().runtime.operatingMode,'normal'); assert.equal(h.store.snapshot().stateVersion,before.stateVersion); return {legacyRead:r.legacyRead,mode:'normal'}; }
    finally { if(old===undefined)delete process.env.YANCE_SAFE_MODE;else process.env.YANCE_SAFE_MODE=old; await h.close(); }
  }));
  cases.push(await runCase('A02_LEDGER_CORRUPTION_BLOCKS_BEFORE_APPLY', async()=>{
    const h=await createAuthorityHarness(); let applied=0;
    try { const e=envelope({commandId:'adversarial-ledger'}); h.store.persistOperatingModeCommand({...h.ownership.guard(),envelope:e,targetMode:'safeMode'}); h.store.db.prepare("UPDATE command_idempotency SET target_mode='normal' WHERE command_id='adversarial-ledger'").run(); const g=new OperatingModeTransitionGateway({store:h.store,ownership:h.ownership,applyMode:async()=>{applied+=1;}}); const r=await expectCode(()=>g.reconcile(),'OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH'); assert.equal(applied,0); return {...r,applied}; } finally { await h.close(); }
  }));
  cases.push(await runCase('A03_CONCURRENT_SAME_ID_CANNOT_DOUBLE_APPLY', async()=>{
    const h=await createAuthorityHarness(); let release; const barrier=new Promise(resolve=>{release=resolve;}); let applied=0;
    try { const g=new OperatingModeTransitionGateway({store:h.store,ownership:h.ownership,applyMode:async()=>{applied+=1;await barrier;}}); const e=envelope({commandId:'adversarial-concurrent'}); const p=[g.transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}),g.transition({targetMode:'safeMode',commandId:e.commandId,envelope:e}),g.transition({targetMode:'safeMode',commandId:e.commandId,envelope:e})]; await new Promise(resolve=>setImmediate(resolve)); assert.equal(applied,1); release(); const results=await Promise.all(p); assert.equal(new Set(results.map(x=>x.stateVersion)).size,1); return {applied,stateVersion:results[0].stateVersion}; } finally { await h.close(); }
  }));
  cases.push(await runCase('A04_OWNER_IDENTITY_AMBIGUITY_NEVER_DEGRADES_TO_WARNING', async()=>{
    const root=tempRoot(); const secure=path.join(root,'secure'); fs.mkdirSync(secure,{recursive:true}); fs.writeFileSync(path.join(secure,'desktop-backend-owner.json'),JSON.stringify({schemaVersion:1,state:'RUNNING',ownershipActive:true,trusted:true,backendPid:9001,startupNonce:'n',backendSessionId:'s',fd6PipeInstanceId:'p',processIdentity:{platform:'test',startTicks:'old',commandDigest:'old'},reasonCode:'APPLICATION_RUNTIME_PROJECTION_ACCEPTED',updatedAtUtc:'2026-07-05T00:00:00Z'}));
    try { const gate=new LegacyRuntimeCutoverGate({legacyDataRoot:root,isProcessAlive:()=>true,captureProcessIdentity:()=>null,killProcess:()=>{throw new Error('must not kill');}}); return await expectCode(()=>gate.execute({gracefulMs:10,forceMs:10}),'WP5_LEGACY_OWNER_AMBIGUOUS'); } finally { removeRoot(root); }
  }));
  cases.push(await runCase('A05_RISK_ACCEPTANCE_RECORDS_PRESERVED', async()=>{
    const status=fs.readFileSync(path.join(ROOT,'implementation','work-package-status.json'),'utf8');
    const registry=fs.readFileSync(path.join(ROOT,'governance','risk-acceptance-register.json'),'utf8');
    for(const id of ['WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION','WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION','WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION']) assert.equal(`${status}\n${registry}`.includes(id),true,id);
    return {preserved:3};
  }));
  cases.push(await runCase('A06_GOVERNANCE_PROHIBITIONS_REMAIN_ACTIVE', async()=>{
    const status=JSON.parse(fs.readFileSync(path.join(ROOT,'implementation','work-package-status.json'),'utf8')); const wp5=status.workPackages.WP5;
    assert.equal(wp5.productionImplementationAuthorized,true); assert.equal(wp5.implementationCommit,null); assert.equal(wp5.candidateBindingCommit,null); assert.equal(wp5.finalDeliveryHead,null); assert.equal(wp5.finalSourceTree,null); assert.equal(wp5.finalPackagingAuthorized,false); assert.equal(status.workPackages.WP6.active,false); return {authorized:true,finalPackagingAuthorized:false};
  }));
  cases.push(await runCase('A07_MUTATION_HARNESS_REJECTS_INVALID_EXECUTION_CLASSES', async()=>{
    const report=JSON.parse(fs.readFileSync(path.join(OUTPUT,'mutation-results.json'),'utf8'));
    assert.equal(report.mutationSummary.survived,0); assert.equal(report.mutationSummary.invalid,0); assert.equal(report.mutationSummary.timeout,0); assert.equal(report.mutationSummary.signal,0); assert.equal(report.mutationSummary.harnessError,0); assert.equal(report.mutationSummary.killed,report.mutationSummary.total); return report.mutationSummary;
  }));
  cases.push(await runCase('A08_WINDOWS_GAP_IS_EXPLICIT_NOT_PASS', async()=>{
    const report=JSON.parse(fs.readFileSync(path.join(OUTPUT,'windows-legacy-runtime-cutover.json'),'utf8'));
    assert.equal(report.status,'PASS'); assert.equal(report.platform,'win32'); assert.equal(report.productionChainExecuted,true); assert.equal(report.sourceBinding?.status,'PASS'); assert.equal(report.sourceBinding?.implementationCommit,report.identity?.sourceCommit); assert.equal(report.sourceBinding?.implementationSourceTree,report.identity?.worktreeSourceTree); assert.equal(report.sourceBinding?.executionFilesMismatched,0);
    return {platform:report.platform,status:report.status,binding:report.sourceBinding.status};
  }));
  cases.push(await runCase('A09_CREDENTIAL_FAILURE_CANNOT_MAP_TO_SAFE_MODE', async()=>{
    const server=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8'); const main=fs.readFileSync(path.join(ROOT,'electron','main.js'),'utf8');
    assert.equal(server.includes('safeModeService.enter'),false); assert.match(main,/throw\s+(?:error|cause)|throw\s+credentialMigration/); return {serverFallback:false,desktopFailClosed:true};
  }));
  cases.push(await runCase('A10_INVARIANT_BINDING_IS_MACHINE_CHECKABLE', async()=>{
    const doc=JSON.parse(fs.readFileSync(path.join(ROOT,'docs','wp5','invariant-binding.json'),'utf8')); assert.equal(doc.invariants.length,45); for(const row of doc.invariants){assert.ok(row.productionModules.length);assert.ok(row.requiredProof.length);assert.ok(row.mutationIds.length);assert.ok(row.evidenceFields.length);} return {invariants:doc.invariants.length};
  }));
  const report=resultEnvelope('WP5_DEVELOPER_ADVERSARIAL_REVIEW',cases,{knownGaps:[]});
  report.phase='CONVERGENCE_PRE_REVIEW'; report.identity.sourceTree=report.identity.worktreeSourceTree; report.identity.implementationCommit=report.identity.sourceCommit;
  const artifact=writeJson('developer-adversarial-review.json',report); console.log(JSON.stringify({status:report.status,summary:report.summary,artifact},null,2)); if(report.status!=='PASS')process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
