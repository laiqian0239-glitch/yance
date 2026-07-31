#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, OUTPUT, resultEnvelope, sha256File, writeJson } = require('./common');
const childProcess = require('node:child_process');

const mutations = [
  { id: 'M01_GENERIC_STATE_MODE_BYPASS', file: 'backend/runtime/RuntimeStateStore.js', find: "throw new AppRuntimeError('OPERATING_MODE_GATEWAY_REQUIRED', 'Operating mode writes must use OperatingModeTransitionGateway', { status: 409 });", replace: "/* MUTATION M01: bypassed gateway */", command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M02_GENERIC_COMMAND_MODE_BYPASS', file: 'backend/runtime/RuntimeStateStore.js', find: "throw new AppRuntimeError('OPERATING_MODE_GATEWAY_REQUIRED', 'Operating mode command side effects must use OperatingModeTransitionGateway', { status: 409 });", replace: "/* MUTATION M02: bypassed gateway */", command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M03_INFLIGHT_DIGEST_NOT_CHECKED', file: 'backend/runtime/OperatingModeTransitionGateway.js', find: "if (active.digest !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH'", replace: "if (false && active.digest !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH'", command: ['tools/wp5/concurrency-crash-matrix.js'] },
  { id: 'M04_DURABLE_DIGEST_NOT_CHECKED', file: 'backend/runtime/RuntimeStateStore.js', find: "if (existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });", replace: "if (false && existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });", occurrence: 3, command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M05_EXISTING_AUTHORITY_REREADS_LEGACY', file: 'backend/runtime/RuntimeAuthorityMigrationCoordinator.js', find: "if (this.store.hasRuntimeState()) return { mode: 'existing', ...this.store.validateRuntimeAuthority(), legacyRead: false };", replace: "if (false && this.store.hasRuntimeState()) return { mode: 'existing', ...this.store.validateRuntimeAuthority(), legacyRead: false };", command: ['--test','tests/wp5/runtime-authority-migration.test.js','tests/wp5/safe-mode-file-not-read.test.js'] },
  { id: 'M06_LEGACY_CONFLICT_IGNORED', file: 'backend/runtime/RuntimeAuthorityMigrationCoordinator.js', find: 'if (modes.size > 1) {', replace: 'if (false && modes.size > 1) {', command: ['--test','tests/wp5/runtime-authority-migration.test.js'] },
  { id: 'M07_ENV_SAFE_MODE_RESTORED', file: 'backend/services/safeModeService.js', find: "const operatingMode = String(snapshot?.operatingMode || 'normal');", replace: "const operatingMode = process.env.YANCE_SAFE_MODE === '1' ? 'safeMode' : String(snapshot?.operatingMode || 'normal');", command: ['--test','tests/wp5/safe-mode-service-env-ignored.test.js'] },
  { id: 'M08_DESKTOP_SAFE_MODE_PERSISTED', file: 'shared/desktopSettings.js', find: "'autoLaunch', 'closeToTray', 'startMinimized', 'autoConnectAccounts', 'backupOnStart',", replace: "'safeMode', 'autoLaunch', 'closeToTray', 'startMinimized', 'autoConnectAccounts', 'backupOnStart',", command: ['--test','tests/wp5/fallback-closure.test.js','tests/wp5/desktop-settings-fallback-absent.test.js'] },
  { id: 'M09_SYSTEM_POLICY_SAFE_MODE_ALLOWED', file: 'backend/services/systemPolicy.js', find: "if (Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {", replace: "if (false && Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {", command: ['--test','tests/wp5/system-policy-fallback-absent.test.js'] },
  { id: 'M10_RECEIPT_COUNT_NOT_VALIDATED', file: 'backend/runtime/RuntimeStateStore.js', find: 'if (receiptRows.length !== 1) {', replace: 'if (false && receiptRows.length !== 1) {', command: ['tools/wp5/fault-matrix.js'] },
  { id: 'M11_LEDGER_AUTHORITY_MISMATCH_IGNORED', file: 'backend/runtime/OperatingModeTransitionGateway.js', find: 'if (Number(command.committedRevision) !== Number(authority.operatingModeRevision) || command.targetMode !== mode) {', replace: 'if (false && (Number(command.committedRevision) !== Number(authority.stateVersion) || command.targetMode !== mode)) {', command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M12_STALE_FENCE_ACCEPTED', file: 'backend/runtime/RuntimeStateStore.js', find: 'if (!row || row.owner_instance_id !== ownerInstanceId || Number(row.fencing_token) !== Number(fencingToken)) {', replace: 'if (false && (!row || row.owner_instance_id !== ownerInstanceId || Number(row.fencing_token) !== Number(fencingToken))) {', command: ['tools/wp5/fault-matrix.js'] },
  { id: 'M13_AMBIGUOUS_OWNER_NOT_BLOCKED', file: 'electron/desktopHost/LegacyRuntimeCutoverGate.js', find: 'if (probe.identityMatch !== true) {', replace: 'if (false && probe.identityMatch !== true) {', command: ['--test','tests/wp5/legacy-runtime-cutover.test.js'] },
  { id: 'M14_BROAD_ENV_LEGACY_DISCOVERY_RESTORED', file: 'backend/services/legacyRootDiscovery.js', find: "const requested = Array.isArray(options.explicitRoots) && options.explicitRoots.length\n    ? options.explicitRoots\n    : [options.legacyRoot || expectedYance27Root(currentRoot)];", replace: "const envRoots = splitExplicitRoots(process.env.YANCE_LEGACY_DATA_DIRS);\n  const requested = envRoots.length ? envRoots : (Array.isArray(options.explicitRoots) && options.explicitRoots.length\n    ? options.explicitRoots\n    : [options.legacyRoot || expectedYance27Root(currentRoot)]);", command: ['--test','tests/wp5/fallback-closure.test.js','tests/wp5/runtime-authority-migration.test.js'] },
  { id: 'M15_APPLY_FAILURE_REPORTED_SUCCESS', file: 'backend/runtime/OperatingModeTransitionGateway.js', find: "throw new AppRuntimeError('OPERATING_MODE_APPLY_FAILED'", replace: "return persisted.response; /* MUTATION M15 */ new AppRuntimeError('OPERATING_MODE_APPLY_FAILED'", command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M16_PUBLISH_FAILURE_REPORTED_SUCCESS', file: 'backend/runtime/OperatingModeTransitionGateway.js', find: "throw new AppRuntimeError('OPERATING_MODE_PUBLISH_FAILED'", replace: "return persisted.response; /* MUTATION M16 */ new AppRuntimeError('OPERATING_MODE_PUBLISH_FAILED'", command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M17_INCOMPLETE_RECEIPT_ACCEPTED', file: 'backend/runtime/RuntimeStateStore.js', find: "if (receipt.status !== 'COMMITTED' || !sourceFingerprint || !verificationComplete) {", replace: "if (receipt.status !== 'COMMITTED' || !sourceFingerprint) { /* MUTATION M17 */", command: ['tools/wp5/fault-matrix.js'] },
  { id: 'M18_WINDOWS_EVIDENCE_MISSING_CHECK_ACCEPTED', file: 'tools/wp5/windows-legacy-runtime-cutover-evidence.js', find: "const missing = REQUIRED_CHECK_IDS.filter(id => !byId.has(id));", replace: "const missing = []; /* MUTATION M18 */", command: ['--test','tests/wp5/windows-cutover-evidence-contract.test.js'] },
  { id: 'M19_LIFECYCLE_REVISION_MISTAKEN_FOR_MODE_REVISION', file: 'backend/runtime/OperatingModeTransitionGateway.js', find: 'Number(authority.operatingModeRevision)', replace: 'Number(authority.stateVersion)', command: ['--test','tests/wp5/operating-mode-gateway.test.js'] },
  { id: 'M20_PRE_READY_SAFE_MODE_NOT_APPLIED', file: 'backend/runtime/AppRuntime.js', find: "if (mode === OPERATING_MODES.SAFE_MODE) await composition.accountContext.enterSafeMode?.();", replace: "if (this.productionServicesStarted && mode === OPERATING_MODES.SAFE_MODE) await composition.accountContext.enterSafeMode?.();", command: ['--test','tests/wp5/startup-mode-apply-gate.test.js'] },
  { id: 'M21_EXTERNAL_SOURCE_MUTATION_NOT_DETECTED', file: 'backend/services/migrationService.js', find: "ok: beforeEncoded === afterEncoded,", replace: "ok: true, /* MUTATION M21 */", command: ['--test','tests/wp5/external-data-migration-read-only.test.js'] },
  { id: 'M22_RENDERER_DESKTOP_SAFE_MODE_FALLBACK', file: 'frontend/r32-system-center.js', find: "Boolean(p.safeMode)", replace: "state.desktop?.desktop?.settings?.safeMode ?? p.safeMode /* MUTATION M22 */", command: ['--test','tests/wp5/renderer-operating-mode-authority.test.js'] },
  { id: 'M23_RECEIPT_FINGERPRINT_NOT_BOUND', file: 'backend/runtime/RuntimeStateStore.js', find: "const fingerprintMatches = sourceExists === true && before", replace: "const fingerprintMatches = true || sourceExists === true && before", command: ['tools/wp5/fault-matrix.js'] },
  { id: 'M24_EVENT_RETENTION_REMAINS_AUTHORITY_DEPENDENCY', file: 'backend/runtime/RuntimeStateStore.js', find: "    if (event) {\n      const payload = parseJson(event.payload_json, {});", replace: "    if (!event) throw new AppRuntimeError('OPERATING_MODE_AUTHORITY_EVENT_MISSING', 'Mutation requires retained event', { status: 503 });\n    if (event) {\n      const payload = parseJson(event.payload_json, {});", command: ['--test','tests/wp5/operating-mode-gateway.test.js'] }
];

function runGit(root, args) {
  const result = childProcess.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr || `git ${args.join(' ')} failed`), { code: 'MUTATION_GIT_SETUP_FAILED' });
}
function copyTree(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of ['backend','electron','frontend','shared','tests','tools','implementation','docs','governance','package.json','.gitignore']) {
    const source = path.join(ROOT,item);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(destination,item), { recursive: true });
  }
  const sourceModules = path.join(ROOT,'node_modules');
  if (fs.existsSync(sourceModules)) fs.symlinkSync(sourceModules, path.join(destination,'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  runGit(destination, ['init', '-q']);
  runGit(destination, ['config', 'user.email', 'wp5-mutation@invalid.local']);
  runGit(destination, ['config', 'user.name', 'WP5 Mutation Harness']);
  runGit(destination, ['add', '-A']);
  runGit(destination, ['commit', '-q', '-m', 'mutation baseline']);
}
function replaceNth(text, find, replace, occurrence = 1) {
  let from = 0; let index = -1;
  for (let n=0;n<occurrence;n+=1) { index=text.indexOf(find,from); if(index<0)return null; from=index+find.length; }
  return text.slice(0,index)+replace+text.slice(index+find.length);
}

function mutationCommand(command) {
  const args = [...command];
  if (args[0] === '--test' && !args.some(arg => String(arg).startsWith('--test-reporter'))) {
    // Node 24 defaults to the spec reporter on Windows. The old harness only
    // recognized TAP's `not ok` lines, so genuine mutant-killing failures were
    // misclassified as HARNESS_ERROR. Force a stable machine-readable reporter
    // for every node:test mutation command.
    args.splice(1, 0, '--test-reporter=tap');
  }
  return args;
}

function writeMutationLog(mutation, command, result, combined) {
  const directory = path.join(OUTPUT, 'mutations');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${mutation.id}.log`);
  const header = {
    mutationId: mutation.id,
    target: mutation.file,
    command: [process.execPath, ...command],
    exitCode: result?.status ?? null,
    signal: result?.signal || '',
    spawnError: result?.error?.message || ''
  };
  fs.writeFileSync(file, `${JSON.stringify(header, null, 2)}\n--- stdout+stderr ---\n${combined}`, 'utf8');
  return { file, sha256: sha256File(file) };
}

function runMutation(mutation) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`wp5-${mutation.id.toLowerCase()}-`));
  const started=Date.now();
  try {
    copyTree(root);
    const target=path.join(root,mutation.file);
    const original=fs.readFileSync(target,'utf8');
    const changed=replaceNth(original,mutation.find,mutation.replace,mutation.occurrence||1);
    if(changed===null) return {id:mutation.id,status:'INVALID',durationMs:Date.now()-started,target:mutation.file,reasonCode:'MUTATION_TARGET_NOT_FOUND'};
    fs.writeFileSync(target,changed,'utf8');
    const command = mutationCommand(mutation.command);
    const result=childProcess.spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',env:{...process.env,NODE_ENV:'test',WP5_MUTATION_ID:mutation.id,WP5_EVIDENCE_DIR:path.join(root,'.wp5-mutation-evidence')},timeout:180000,maxBuffer:30*1024*1024});
    let classification='';
    const combined = `${result.stdout || ''}
${result.stderr || ''}`;
    const logArtifact = writeMutationLog(mutation, command, result, combined);
    const actualTestFailure = /(?:^|\n)not ok \d+|(?:^|\n)✖\s+|(?:^|\n)fail\s+[1-9]\d*\s*$|(?:^|\n)failing tests:|"status"\s*:\s*"FAIL"/mi.test(combined);
    const harnessFailure = /WP5_GIT_IDENTITY_FAILED|MUTATION_GIT_SETUP_FAILED|MODULE_NOT_FOUND|SyntaxError|ERR_MODULE_NOT_FOUND/.test(combined);
    if(result.error?.code==='ETIMEDOUT')classification='TIMEOUT';
    else if(result.error)classification='HARNESS_ERROR';
    else if(result.signal)classification='SIGNAL';
    else if(result.status===0)classification='SURVIVED';
    else if(Number.isInteger(result.status) && actualTestFailure && !harnessFailure)classification='KILLED';
    else classification='HARNESS_ERROR';
    return {id:mutation.id,status:classification,durationMs:Date.now()-started,target:mutation.file,command:[process.execPath,...command],exitCode:result.status,signal:result.signal||'',logArtifact,outputTail:combined.slice(-5000)};
  } catch(error) {
    return {id:mutation.id,status:'HARNESS_ERROR',durationMs:Date.now()-started,target:mutation.file,error:{code:error.code||'',message:error.message}};
  } finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}); }
}

const requestedIds = String(process.env.WP5_MUTATION_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const requestedSet = new Set(requestedIds);
const selectedMutations = requestedSet.size ? mutations.filter(mutation => requestedSet.has(mutation.id)) : mutations;
const missingMutationIds = requestedIds.filter(id => !mutations.some(mutation => mutation.id === id));
if (missingMutationIds.length) {
  throw Object.assign(new Error(`Unknown WP5 mutation ids: ${missingMutationIds.join(', ')}`), { code: 'WP5_MUTATION_ID_UNKNOWN' });
}
if (!selectedMutations.length) {
  throw Object.assign(new Error('No WP5 mutations were selected'), { code: 'WP5_MUTATION_SELECTION_EMPTY' });
}

const rows=selectedMutations.map(mutation => {
  process.stderr.write(`[wp5-mutation] ${mutation.id}:start\n`);
  const row = runMutation(mutation);
  process.stderr.write(`[wp5-mutation] ${mutation.id}:${row.status} ${row.durationMs}ms\n`);
  return row;
});
const validKilled=rows.filter(r=>r.status==='KILLED').length;
const status=validKilled===rows.length?'PASS':'FAIL';
const report=resultEnvelope('WP5_MUTATION_MATRIX',rows.map(row=>({...row,status:row.status==='KILLED'?'PASS':'FAIL',mutationClassification:row.status})),{
  mutationSummary:{total:rows.length,killed:validKilled,survived:rows.filter(r=>r.status==='SURVIVED').length,invalid:rows.filter(r=>r.status==='INVALID').length,timeout:rows.filter(r=>r.status==='TIMEOUT').length,signal:rows.filter(r=>r.status==='SIGNAL').length,harnessError:rows.filter(r=>r.status==='HARNESS_ERROR').length},
  mutationStatus:status
});
report.status=status;
report.phase='CONVERGENCE_PRE_REVIEW'; report.identity.sourceTree=report.identity.worktreeSourceTree; report.identity.implementationCommit=report.identity.sourceCommit;
  const artifact=writeJson('mutation-results.json',report);
console.log(JSON.stringify({status,summary:report.mutationSummary,artifact},null,2));
if(status!=='PASS')process.exitCode=1;
