#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, utcNow } = require('./common');

const M = [
  { id:'M01_API_CLIENT_CONSTRUCTION_REMOVED', file:'electron/main.js', find:'runtimeApiV2Client = new ApiV2RuntimeClient({', replace:'runtimeApiV2Client = new MissingApiV2RuntimeClient({', test:'tests/wp6/electron-api-v2-only.test.js' },
  { id:'M02_PROJECTION_COORDINATOR_REMOVED', file:'electron/main.js', find:'runtimeProjectionCoordinator = new RuntimeProjectionCoordinator({', replace:'runtimeProjectionCoordinator = new MissingRuntimeProjectionCoordinator({', test:'tests/wp6/electron-api-v2-only.test.js' },
  { id:'M03_CONTRACT_HEADER_REMOVED', file:'electron/desktopHost/ApiV2RuntimeClient.js', find:"'x-yance-contract-version': String(CONTRACT_VERSION),", replace:"'x-legacy-contract-version': String(CONTRACT_VERSION),", test:'tests/wp6/electron-api-v2-only.test.js' },
  { id:'M04_STALE_SESSION_RESPONSE_ACCEPTED', file:'electron/desktopHost/ApiV2RuntimeClient.js', find:'if (sessionIdentity(current) !== identity) {', replace:'if (false && sessionIdentity(current) !== identity) {', test:'tests/wp6/stale-api-session-response-discarded.test.js' },
  { id:'M05_UNTRUSTED_OWNER_BASELINE_ACCEPTED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'if (options.requireTrusted === true && snapshot.ownerTrusted !== true) {', replace:'if (false && options.requireTrusted === true && snapshot.ownerTrusted !== true) {', test:'tests/wp6/trusted-owner-before-baseline.test.js' },
  { id:'M06_EVENT_GAP_IGNORED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:"if ((error.reasonCode || error.code) === 'EVENT_SEQUENCE_GAP') return this._refetchAfterGap();", replace:"if (false && (error.reasonCode || error.code) === 'EVENT_SEQUENCE_GAP') return this._refetchAfterGap();", test:'tests/wp6/event-gap-forces-snapshot.test.js' },
  { id:'M07_STALE_OWNER_CANDIDATE_ACCEPTED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'if (this.candidate && this.candidate.binding.sessionFingerprint !== binding.sessionFingerprint) {', replace:'if (false && this.candidate && this.candidate.binding.sessionFingerprint !== binding.sessionFingerprint) {', test:'tests/wp6/stale-owner-event-discarded.test.js' },
  { id:'M08_POLICY_MODE_WRITE_ALLOWED', file:'backend/routes/system.js', find:"if (Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {", replace:"if (false && Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {", test:'tests/wp6/policy-operating-mode-write-rejected.test.js' },
  { id:'M09_LEGACY_NETWORK_COMMAND_ALLOWED', file:'backend/runtime/AppRuntime.js', find:"'lifecycle.setNetwork', 'lifecycle.suspend', 'lifecycle.resume',", replace:"'lifecycle.suspend', 'lifecycle.resume',", test:'tests/wp6/legacy-runtime-command-rejected.test.js' },
  { id:'M10_GENERIC_LEGACY_EXECUTOR_RESTORED', file:'backend/runtime/AppRuntime.js', find:'  async executeBusinessCommand(input) {', replace:'  async executeLegacy(input) {', test:'tests/wp6/legacy-runtime-command-rejected.test.js' },
  { id:'M11_DESKTOP_COORDINATOR_BYPASS', file:'electron/desktopHost/DesktopHost.js', find:'if (!this.credentialApplicationCoordinator) {', replace:'if (false && !this.credentialApplicationCoordinator) {', test:'tests/wp6/desktop-coordinator-required.test.js' },
  { id:'M12_FORCED_PROCESS_CUSTODY_REPORTED_SUCCESS', file:'electron/main.js', find:'runtimeSuccessReported: runtimeStop.confirmed === true', replace:'runtimeSuccessReported: true', test:'tests/wp6/forced-stop-is-process-custody-not-runtime-success.test.js' },
  { id:'M13_OLD_RUNTIME_EXACT_FILE_RESTORED', create:'backend/core/coreRuntime.js', content:"'use strict'; module.exports = class CoreRuntime {};\n", test:'tests/wp6/old-runtime-source-scan-zero.test.js' },
  { id:'M14_EXECUTE_LEGACY_SYMBOL_RESTORED', file:'backend/server.js', append:'\nconst executeLegacy = null; // mutation\n', test:'tests/wp6/old-runtime-source-scan-zero.test.js' },
  { id:'M15_DUPLICATE_APP_RUNTIME_CONSTRUCTION', file:'backend/runtime/AppRuntimeFactory.js', find:'processRuntime = new AppRuntime(options);', replace:'new AppRuntime(options);\n  processRuntime = new AppRuntime(options);', test:'tests/wp6/duplicate-runtime-entrypoint-scan-zero.test.js' },
  { id:'M16_DURABLE_COMMAND_DIGEST_IGNORED', file:'backend/runtime/RuntimeStateStore.js', find:"if (existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });", replace:"if (false && existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });", occurrence:2, test:'tests/wp6/command-idempotency-integration.test.js' },
  { id:'M17_PENDING_COMMAND_GATE_REMOVED', file:'backend/runtime/RuntimeStateStore.js', find:'if (pending) {', replace:'if (false && pending) {', test:'tests/wp6/pending-command-blocks-new-command.test.js' },
  { id:'M18_APPLY_FAILURE_REPORTED_AS_SUCCESS', file:'backend/runtime/RuntimeControlCommandGateway.js', find:"throw new AppRuntimeError('RUNTIME_CONTROL_APPLY_FAILED', 'Runtime control command was persisted but could not be applied', {", replace:"return { accepted: true, commandId: envelope.commandId }; /* mutation */ new AppRuntimeError('RUNTIME_CONTROL_APPLY_FAILED', 'Runtime control command was persisted but could not be applied', {", test:'tests/wp6/backend-crash-recovery.test.js' },
  { id:'M19_SNAPSHOT_MODE_REVISION_OPTIONAL', file:'shared/runtimeApiV2Contract.js', find:'!isObject(runtime) || !integer(runtime.operatingModeRevision, 1)) {', replace:'!isObject(runtime)) {', test:'tests/wp6/snapshot-authority-triple-required.test.js' },
  { id:'M20_STATE_ROLLBACK_ALLOWED', file:'shared/runtimeApiV2Contract.js', find:'if (sameOwner && Number(next.stateVersion) < Number(previous.stateVersion)) {', replace:'if (false && sameOwner && Number(next.stateVersion) < Number(previous.stateVersion)) {', test:'tests/wp6/snapshot-rollback-rejected.test.js' },
  { id:'M21_PRELOAD_GENERIC_CONTROL_EXPOSED', file:'electron/preload.js', find:'getRuntimeProjection:', replace:'executeControl: command => ipcRenderer.invoke(\'desktop:control\', command),\n  getRuntimeProjection:', test:'tests/wp6/electron-api-v2-only.test.js' },
  { id:'M22_INSTALLED_TREE_EXECUTE_LEGACY_RESIDUE', file:'backend/server.js', append:'\nconst executeLegacy = null; // installed residue mutation\n', test:'tests/wp6/old-runtime-installed-tree-scan-zero.test.js' },
  { id:'M23_API_CONTRACT_MIDDLEWARE_BYPASSED', file:'backend/routes/apiV2.js', find:'if (contractVersion(req) !== 2 || (req.body && Object.prototype.hasOwnProperty.call(req.body, \'contractVersion\') && req.body.contractVersion !== 2)) {', replace:'if (false && (contractVersion(req) !== 2 || (req.body && Object.prototype.hasOwnProperty.call(req.body, \'contractVersion\') && req.body.contractVersion !== 2))) {', test:'tests/wp6/api-v2-contract-mismatch-integration.test.js' },
  { id:'M24_COMMAND_WITHOUT_BASELINE_ALLOWED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:"if (!this.baseline) throw makeError('WP6_RUNTIME_BASELINE_REQUIRED', 'Runtime command requires a trusted API v2 baseline', {}, 409);", replace:"if (false && !this.baseline) throw makeError('WP6_RUNTIME_BASELINE_REQUIRED', 'Runtime command requires a trusted API v2 baseline', {}, 409);", test:'tests/wp6/runtime-command-requires-baseline.test.js' },
  { id:'M25_FRONTEND_LEGACY_MODE_FALLBACK', file:'frontend/r32-settings-recovery.js', find:'window.yanceDesktop.setOperatingMode', replace:'window.yanceDesktop.executeLegacy', test:'tests/wp6/old-runtime-source-scan-zero.test.js' },
  { id:'M26_BACKEND_CHILD_LIFECYCLE_CHANNEL_RESTORED', file:'backend/server.js', append:"\nprocess.on('message', message => { if (message?.type === 'desktop:lifecycle') return false; });\n", test:'tests/wp6/old-runtime-source-scan-zero.test.js' },
  { id:'M27_PUBLIC_API_SESSION_TOKEN_LEAK', file:'electron/desktopHost/BackendProcessHost.js', find:'if (options.includeToken === true) binding.apiSessionToken = String(session.apiSessionToken || \'\');', replace:'binding.apiSessionToken = String(session.apiSessionToken || \'\');', test:'tests/wp6/backend-session-token-secret.test.js' },
  { id:'M28_MODE_REVISION_ROLLBACK_ALLOWED', file:'shared/runtimeApiV2Contract.js', find:'if (sameOwner && Number(next.runtime.operatingModeRevision) < Number(previous.runtime.operatingModeRevision)) {', replace:'if (false && sameOwner && Number(next.runtime.operatingModeRevision) < Number(previous.runtime.operatingModeRevision)) {', test:'tests/wp6/snapshot-rollback-rejected.test.js' },
  { id:'M29_STOP_RECOVERY_GENERATES_NEW_ID', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'const response = await this.client.executeCommand(operation.envelope, {', replace:'const response = await this.client.requestStop({ expectedStateVersion: operation.expectedStateVersion, ...operation.envelope.payload }, {', test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M30_STOP_OWNER_SESSION_CHECK_BYPASSED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'const same = Number(current.backendPid || 0) === Number(expected.backendPid || 0) &&', replace:'const same = true || Number(current.backendPid || 0) === Number(expected.backendPid || 0) &&', test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M31_STOP_CONFLICTING_REASON_ACCEPTED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:"requestedReason !== String(operation.envelope?.payload?.reason || '') ||", replace:"false && requestedReason !== String(operation.envelope?.payload?.reason || '') ||", test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M32_STOP_EXIT_REPLAYS_SECOND_INTENT', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'if (inspection.backendExited) {', replace:'if (false && inspection.backendExited) {', test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M33_CONFIRMED_STOP_LOCAL_IDEMPOTENCY_REMOVED', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:"if (operation.status === 'CONFIRMED') {", replace:"if (false && operation.status === 'CONFIRMED') {", test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M34_NEW_OWNER_BINDS_BEFORE_STOP_EXIT_RECOVERY', file:'electron/desktopHost/RuntimeProjectionCoordinator.js', find:'if (this.stopOperation.processCustody?.exitConfirmed !== true) {', replace:'if (false && this.stopOperation.processCustody?.exitConfirmed !== true) {', test:'tests/wp6/stop-transport-unknown-recovery.test.js' },
  { id:'M35_RESTART_SYNTHETICALLY_RESOLVES_EXIT_EARLY', file:'electron/main.js', find:"runtimeProjectionCoordinator.discardBaseline('WP6_CONTROLLED_RESTART');", replace:"runtimeProjectionCoordinator.resolveStopAfterProcessExit({ stopped: true, exitConfirmed: true, alreadyStopped: true });\n    runtimeProjectionCoordinator.discardBaseline('WP6_CONTROLLED_RESTART');", test:'tests/wp6/restart-stop-recovery-order.test.js' }
];

function copySubset(target) {
  fs.mkdirSync(target, { recursive:true });
  for (const item of ['backend','electron','frontend','shared','tests','tools','evidence','package.json']) {
    const src = path.join(ROOT, item); if (fs.existsSync(src)) fs.cpSync(src, path.join(target, item), { recursive:true });
  }
  const modules = path.join(ROOT, 'node_modules'); if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}
function replaceOccurrence(source, find, replacement, occurrence = 1) {
  let from = 0, at = -1;
  for (let i=0;i<occurrence;i++) { at = source.indexOf(find, from); if (at < 0) return null; from = at + find.length; }
  return source.slice(0, at) + replacement + source.slice(at + find.length);
}
function applyMutation(root, mutation) {
  if (mutation.create) { const file=path.join(root,mutation.create); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,mutation.content||''); return; }
  const file = path.join(root, mutation.file); const source = fs.readFileSync(file,'utf8');
  if (mutation.append) { fs.writeFileSync(file, source + mutation.append); return; }
  const changed = replaceOccurrence(source, mutation.find, mutation.replace, mutation.occurrence || 1);
  if (changed == null) throw new Error(`mutation target not found: ${mutation.id}`);
  fs.writeFileSync(file, changed);
}
function main() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(),'yance-wp6-mutations-'));
  const rows=[];
  try {
    for (const mutation of M) {
      const root=path.join(parent,mutation.id); let classification='INVALID', result={};
      try {
        copySubset(root); applyMutation(root,mutation);
        const child=spawnSync(process.execPath,['--test',mutation.test],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env}});
        if (child.error?.code==='ETIMEDOUT') classification='TIMEOUT';
        else if (child.signal) classification='SIGNAL';
        else if (child.status===0) classification='SURVIVED';
        else classification='KILLED';
        result={exitCode:child.status,signal:child.signal||null,outputTail:`${child.stdout||''}\n${child.stderr||''}`.trim().split(/\r?\n/).slice(-18)};
      } catch (error) { classification='INVALID'; result={error:error.message}; }
      rows.push({id:mutation.id,file:mutation.file||mutation.create,test:mutation.test,classification,...result});
      fs.rmSync(root,{recursive:true,force:true});
    }
  } finally { fs.rmSync(parent,{recursive:true,force:true}); }
  const counts={total:rows.length,killed:rows.filter(r=>r.classification==='KILLED').length,survived:rows.filter(r=>r.classification==='SURVIVED').length,invalid:rows.filter(r=>r.classification==='INVALID').length,timeout:rows.filter(r=>r.classification==='TIMEOUT').length,signal:rows.filter(r=>r.classification==='SIGNAL').length};
  const report={schemaVersion:1,stage:'6.4.5.9',workPackage:'WP6',matrixType:'WP6_MUTATION_MATRIX',generatedAtUtc:utcNow(),status:counts.killed===counts.total?'PASS':'FAIL',summary:counts,mutations:rows};
  console.log(JSON.stringify(report,null,2)); if(report.status!=='PASS')process.exitCode=1;
}
main();
