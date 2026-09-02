'use strict';
const path = require('node:path');
const { buildCommandPathInventory } = require('./command-path-inventory');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
class Wp2EvidenceValidationError extends Error{constructor(reasonCode,message,details={}){super(message);this.name='Wp2EvidenceValidationError';this.reasonCode=reasonCode;this.details=details;}}
function fail(reasonCode,message,details){throw new Wp2EvidenceValidationError(reasonCode,message,details);}
function validateLifecycle(lifecycle){
 if(!lifecycle?.allOrphanChecksPass)fail('WP2_ORPHAN_BACKEND_DETECTED','DesktopHost shutdown left an orphan backend',lifecycle);
 const names=new Set((lifecycle.scenarios||[]).map(x=>x.name||x.mode));
 for(const required of ['normal-sigterm','ignore-sigterm-force-kill','real-missing-exec-spawn-error','exit-before-control-callback','exit-during-control-callback','exit-before-running-transition','async-error-during-start','error-then-exit','sigkill-failure-retains-owner','starting-restart-app','running-restart-app','restart-app-stop-failure'])if(!names.has(required))fail('WP2_LIFECYCLE_SCENARIO_MISSING',`Missing lifecycle scenario ${required}`);
 for(const row of lifecycle.scenarios||[]){if(row.forbiddenCrashedToRunning)fail('WP2_STARTING_RACE_REGRESSION','CRASHED to RUNNING transition detected',row);if(row.deadChildSessionEstablished)fail('WP2_DEAD_CHILD_SESSION_ESTABLISHED','Dead child retained API session',row);if(row.unhandledError===true)fail('WP2_UNHANDLED_CHILD_ERROR','Child spawn error escaped process control',row);}
 const stopFailure=(lifecycle.scenarios||[]).find(x=>(x.name||x.mode)==='sigkill-failure-retains-owner');
 if(stopFailure?.stopResult?.stopped!==false||stopFailure?.ownerRetained!==true)fail('WP2_STOP_FAILURE_OWNERSHIP_LOST','Stop failure did not retain child ownership',stopFailure);
 const restartFailure=(lifecycle.scenarios||[]).find(x=>(x.name||x.mode)==='restart-app-stop-failure');
 if(restartFailure?.relaunchCalled||restartFailure?.exitCalled||restartFailure?.ownerRetained!==true)fail('WP2_RESTART_APP_STOP_FAILURE_UNSAFE','Restart app did not retain ownership on shutdown failure',restartFailure);
 return true;
}
function validateBoundary(boundary){
 if(boundary?.violationCount!==0||boundary?.legacyElectronBusinessRuntimePresent!==false)fail('WP2_ELECTRON_BOUNDARY_VIOLATION','Electron boundary contains business runtime',boundary);
 if(!Array.isArray(boundary.desktopWritableSettings)||boundary.desktopWritableSettings.length<5)fail('WP2_DESKTOP_SETTINGS_ALLOWLIST_MISSING','Desktop settings allowlist missing',boundary);
 if((boundary.forbiddenBusinessWritableSettings||[]).some(k=>boundary.desktopWritableSettings.includes(k)))fail('WP2_BUSINESS_SETTING_WRITABLE','Business setting remains Electron-writable',boundary);
 if(boundary.frontendSettingsMigration?.status!=='PASS')fail('WP2_FRONTEND_SETTINGS_MIGRATION_INCOMPLETE','Frontend still routes business settings to Electron',boundary);
 return true;
}
function validateCommands(commands){
 if(!Array.isArray(commands)||commands.length<90)fail('WP2_COMMAND_PATH_INVALID','Command inventory is incomplete',{count:commands?.length||0});
 const ipc=commands.filter(row=>row.entryKind==='ELECTRON_IPC');
 const actualChannels=ipc.map(x=>x.channelOrCommandName).sort();
 const canonicalRows=buildCommandPathInventory(REPO_ROOT);
 const canonicalChannels=canonicalRows.filter(row=>row.entryKind==='ELECTRON_IPC').map(x=>x.channelOrCommandName).sort();
 const missingChannels=canonicalChannels.filter(channel=>!actualChannels.includes(channel));
 const extraChannels=actualChannels.filter(channel=>!canonicalChannels.includes(channel));
 if(missingChannels.length||extraChannels.length)fail('WP2_ELECTRON_IPC_COUNT_MISMATCH','All production Electron IPC channels must match the canonical command-path inventory',{actualCount:actualChannels.length,expectedCount:canonicalChannels.length,missingChannels,extraChannels});
 const channelNames=ipc.map(x=>x.channelOrCommandName);if(new Set(channelNames).size!==channelNames.length)fail('WP2_DUPLICATE_COMMAND_AUTHORITY','Duplicate Electron IPC authority name');
 for(const row of commands){
  if(!row.channelOrCommandName||!row.finalAuthoritativePath||!row.stateAuthorityOwner)fail('WP2_COMMAND_PATH_INCOMPLETE','Command path fields missing',row);
  if(row.stateAuthorityOwner==='BACKEND_BUSINESS_RUNTIME'&&row.entryKind==='ELECTRON_IPC'&&row.forwardingOnly!==true)fail('WP2_DUAL_COMMAND_AUTHORITY','Backend business command is executed in Electron rather than forwarded',row);
 }
 for(const required of ['desktop:restart-app','desktop:restart-backend','desktop:update-settings','desktop:save-credential','desktop:delete-credential','desktop:export-diagnostics','desktop:export-chat','desktop:open-auth-url'])if(!channelNames.includes(required))fail('WP2_CONTROL_PATH_MISSING',`Missing required control path ${required}`);
 for(const channel of channelNames.filter(x=>x.startsWith('store:')))if(!ipc.find(row=>row.channelOrCommandName===channel&&row.forwardingOnly===true&&row.backendRoute))fail('WP2_STORE_BRIDGE_PATH_INVALID','Store bridge must be forwarding-only', {channel});
 return true;
}
function validateApi(api){
 if(Number(api?.tokenOrTokenHashLeakCount||0)>0)fail('WP2_API_SESSION_SECRET_LEAK_DETECTED','API session material was found on a production runtime surface',api);
 const executionFields=['productionDesktopEntryExecuted','productionServerEntryExecuted','productionHttpAuthExecuted','productionWebSocketAuthExecuted','productionDiagnosticsPathExecuted','productionLoggingPathExecuted','productionPersistencePathsExecuted'];
 const missingExecution=executionFields.filter(field=>api?.[field]!==true);
 if(missingExecution.length)fail('WP2_PRODUCTION_RUNTIME_CHAIN_INCOMPLETE','Required production runtime chain was not fully executed',{missingExecution,api});
 const mutation=api?.mutationDetection||{};
 if(mutation.status!=='PASS'||mutation.reasonCode!=='WP2_API_SESSION_SECRET_LEAK_DETECTED'||mutation.requiredTest?.exitCode===0||mutation.evidenceGenerator?.exitCode===0||mutation.requiredTest?.reasonCodeObserved!==true||mutation.evidenceGenerator?.reasonCodeObserved!==true)fail('WP2_SERVER_MUTATION_GATE_FAILED','Real backend/server.js mutation was not rejected by both formal gates',mutation);
 const ok=api?.http?.currentTokenStatus===200&&api?.http?.wrongTokenStatus===401&&api?.http?.newTokenStatus===200&&api?.http?.oldTokenAfterRestartStatus===401&&api?.webSocket?.currentTokenStatus===101&&api?.webSocket?.wrongTokenStatus===401&&api?.webSocket?.newTokenStatus===101&&api?.webSocket?.oldTokenAfterRestartStatus===401&&api?.rotationObserved===true&&api?.environmentTokenPresent===false&&api?.argvTokenPresent===false&&api?.tokenOrTokenHashLeakCount===0&&api?.productionAuthModuleExecuted===true&&api?.actualAuthenticatedRuntimeChainExecuted===true;
 if(!ok)fail('WP2_API_SESSION_RUNTIME_VALIDATION_FAILED','API session runtime validation failed',api);
 return true;
}

module.exports={Wp2EvidenceValidationError,validateLifecycle,validateBoundary,validateCommands,validateApi};
