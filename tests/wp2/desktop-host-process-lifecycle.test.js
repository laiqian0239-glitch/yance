'use strict';
const assert=require('node:assert/strict');const childProcess=require('node:child_process');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');
const {BackendProcessHost,PROCESS_STATES}=require('../../electron/desktopHost/BackendProcessHost');
const {backendAuthority,stopOwnedBackend,restartOwnedBackend,completeElectronQuit,restartElectronApp}=require('../../electron/backendShutdownCoordinator');
const {removePathWithRetries}=require('../test-support/windows-cleanup');
const ROOT=path.resolve(__dirname,'../..');
const LAUNCH_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'wp2-backend-launch-'));
const LAUNCH_ENTRY=path.join(LAUNCH_ROOT,'backend','desktopHostedEntry.js');
const LAUNCH_NODE_MODULES=path.join(LAUNCH_ROOT,'node_modules');
fs.mkdirSync(path.dirname(LAUNCH_ENTRY),{recursive:true});fs.mkdirSync(LAUNCH_NODE_MODULES,{recursive:true});fs.writeFileSync(LAUNCH_ENTRY,'// wp2 launch contract fixture\n','utf8');
test.after(()=>removePathWithRetries(LAUNCH_ROOT));
const START={entry:LAUNCH_ENTRY,cwd:LAUNCH_ROOT,execPath:process.execPath,env:{SAFE:'1',NODE_PATH:LAUNCH_NODE_MODULES},releaseStartupConfig:{resourcesPath:path.join(LAUNCH_ROOT,'resources'),expectedBuildId:'build',manifestSha256:'a'.repeat(64)}};
function fakePipe(handler){const p=new EventEmitter();p.end=(data,cb)=>handler?handler(data,cb):queueMicrotask(()=>cb?.());p.destroy=()=>{};return p;}
function controlledPipe(){let callback=null;let enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});const pipe=fakePipe((_data,cb)=>{callback=cb;enteredResolve();});return{pipe,entered,getCallback:()=>callback};}
function fakeChild(options={}){const child=new EventEmitter();child.pid=options.pid||4242;child.exitCode=null;child.signalCode=null;const control=options.controlPipe||fakePipe();const credentialPipe=options.credentialPipe||new PassThrough();child.stdio=[null,new PassThrough(),new PassThrough(),null,control,credentialPipe,new PassThrough()];child.killCalls=[];child.kill=signal=>{child.killCalls.push(signal);if(options.killThrows?.includes(signal))throw new Error(`${signal} failed`);if(options.killReturnsFalse?.includes(signal))return false;if(signal==='SIGTERM'&&options.ignoreTerm)return true;if(options.neverExit)return true;queueMicrotask(()=>child.emit('exit',signal==='SIGTERM'?0:null,signal));return true;};return child;}
function hostFor(child,extra={}){return new BackendProcessHost({fork:extra.fork||(()=>child),encodeStartupFrame:extra.encodeStartupFrame,randomBytes:size=>Buffer.alloc(size,7),randomUUID:()=> '11111111-1111-4111-8111-111111111111',isProcessAlive:extra.isProcessAlive,captureProcessIdentity:extra.captureProcessIdentity});}
function states(host){return host.snapshot().stateHistory.map(r=>r.state);}
async function rejectsStartNoSession(host,opts=START){await assert.rejects(host.start(opts));const snap=host.snapshot();assert.notEqual(snap.state,PROCESS_STATES.RUNNING);assert.equal(snap.apiSessionEstablished,false);assert.equal(snap.running,false);assert.equal(states(host).some((s,i,a)=>s==='CRASHED'&&a.slice(i+1).includes('RUNNING')),false);}

function createLifecycleReadyObserver() {
  const timeline=[];
  let child=null;
  let settled=false;
  let resolveReady;
  let rejectReady;
  const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const finish=(error,value)=>{
    if(settled)return;
    settled=true;
    if(error)rejectReady(error);else resolveReady(value);
  };
  const fork=(...args)=>{
    const forkRequestedAt=Date.now();
    child=childProcess.fork(...args);
    timeline.push({event:'fork-returned',at:Date.now(),elapsedMs:Date.now()-forkRequestedAt,pid:child.pid||0});
    child.on('message',message=>{
      timeline.push({event:'message',at:Date.now(),type:message?.type||'',pid:message?.pid||0});
      if(message?.type==='lifecycle-ready')finish(null,message);
      else if(message?.type==='probe:error'){
        const error=Object.assign(new Error(`lifecycle child startup failed: ${message.reasonCode||'UNKNOWN'}`),{reasonCode:message.reasonCode||'WP2_LIFECYCLE_CHILD_START_FAILED',timeline:[...timeline]});
        finish(error);
      }
    });
    child.once('error',cause=>finish(Object.assign(new Error(`lifecycle child emitted error: ${cause.message}`),{reasonCode:'WP2_LIFECYCLE_CHILD_ERROR',causeCode:cause.code||'',timeline:[...timeline]})));
    child.once('exit',(code,signal)=>{
      timeline.push({event:'exit',at:Date.now(),code:code??null,signal:signal||null});
      finish(Object.assign(new Error(`lifecycle child exited before ready: code=${code} signal=${signal||''}`),{reasonCode:'WP2_LIFECYCLE_CHILD_EXITED_BEFORE_READY',exitCode:code??null,signal:signal||null,timeline:[...timeline]}));
    });
    return child;
  };
  const waitReady=async(timeoutMs=3000)=>{
    let timer;
    try{
      return await Promise.race([
        readyPromise,
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('lifecycle child ready timeout'),{reasonCode:'WP2_LIFECYCLE_CHILD_READY_TIMEOUT',timeoutMs,pid:child?.pid||0,timeline:[...timeline]})),timeoutMs);})
      ]);
    }finally{if(timer)clearTimeout(timer);}
  };
  return{fork,waitReady,snapshot:()=>({pid:child?.pid||0,settled,timeline:[...timeline]})};
}

function isPidAlive(pid){
  try{process.kill(pid,0);return true;}catch(error){if(error?.code==='ESRCH')return false;throw error;}
}
async function waitForPidExit(pid,timeoutMs=2000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){if(!isPidAlive(pid))return true;await new Promise(resolve=>setTimeout(resolve,25));}
  throw Object.assign(new Error(`orphan PID remained alive after ${timeoutMs}ms: ${pid}`),{reasonCode:'WP2_ORPHAN_PROCESS_DETECTED',pid,timeoutMs});
}


test('non-handshake startup does not block on an unread credential pipe',async()=>{let credentialWrites=0;const credentialPipe=fakePipe((_data,cb)=>{credentialWrites++;setTimeout(()=>cb?.(),5000);});const child=fakeChild({credentialPipe});const host=hostFor(child);const started=await host.start({...START,credentialHandshakeRequired:false,credentialWriteTimeoutMs:25});assert.equal(started.child,child);assert.equal(host.snapshot().state,PROCESS_STATES.RUNNING);assert.equal(credentialWrites,0);assert.equal(host.snapshot().credentialFrameDelivered,false);await host.stop({gracefulMs:25,forceMs:100});});
test('normal start, duplicate start, graceful stop, real exit and state machine',async()=>{const child=fakeChild();const host=hostFor(child);const started=await host.start(START);assert.equal(started.child,child);assert.equal(host.snapshot().state,PROCESS_STATES.RUNNING);await assert.rejects(host.start(START),e=>e.reasonCode==='DESKTOP_BACKEND_ALREADY_RUNNING');const result=await host.stop({gracefulMs:100,forceMs:100});assert.equal(result.stopped,true);assert.equal(result.exitConfirmed,true);assert.equal(host.snapshot().backendPid,0);assert.deepEqual(states(host).slice(0,5),['NOT_STARTED','STARTING','RUNNING','STOPPING','STOPPED']);});
test('fork failure enters START_FAILED without child',async()=>{const host=hostFor(null,{fork:()=>{throw Object.assign(new Error('fork failed'),{code:'FORK_FAILED'});}});await rejectsStartNoSession(host);assert.equal(host.snapshot().state,PROCESS_STATES.START_FAILED);assert.equal(host.snapshot().backendPid,0);});
test('frame encoding failure terminates child and waits for exit',async()=>{const child=fakeChild();const host=hostFor(child,{encodeStartupFrame:()=>{throw Object.assign(new Error('encode failed'),{reasonCode:'FRAME_ENCODE_FAILED'});}});await rejectsStartNoSession(host);assert.equal(child.__desktopHostExited,true);});
test('control pipe write failure terminates child',async()=>{const child=fakeChild({controlPipe:fakePipe(()=>{throw new Error('write failed');})});const host=hostFor(child);await assert.rejects(host.start(START),e=>e.reasonCode==='DESKTOP_STARTUP_PIPE_WRITE_FAILED');assert.equal(child.__desktopHostExited,true);assert.equal(host.snapshot().backendPid,0);});
test('startup timeout terminates child',async()=>{const child=fakeChild({controlPipe:fakePipe(()=>{})});const host=hostFor(child);await assert.rejects(host.start({...START,controlPipeTimeoutMs:50}),e=>e.reasonCode==='DESKTOP_STARTUP_PIPE_WRITE_TIMEOUT');assert.equal(child.__desktopHostExited,true);});

test('child exits before control pipe callback',async()=>{let child;const pipe=fakePipe((_d,cb)=>{child.emit('exit',31,null);queueMicrotask(()=>cb());});child=fakeChild({controlPipe:pipe});await rejectsStartNoSession(hostFor(child));});
test('child exits during control pipe callback',async()=>{let child;const pipe=fakePipe((_d,cb)=>{cb();child.emit('exit',32,null);});child=fakeChild({controlPipe:pipe});await rejectsStartNoSession(hostFor(child));});
test('child exits after frame write and before RUNNING transition',async()=>{const child=fakeChild();const host=hostFor(child);await rejectsStartNoSession(host,{...START,beforeRunningTransition:()=>child.emit('exit',33,null)});});
test('child emits asynchronous error during STARTING',async()=>{let child;const pipe=fakePipe((_d,cb)=>queueMicrotask(()=>{child.emit('error',Object.assign(new Error('async spawn error'),{code:'EASYNC'}));cb();}));child=fakeChild({controlPipe:pipe});await assert.rejects(hostFor(child).start(START),e=>e.reasonCode==='DESKTOP_BACKEND_CHILD_ERROR');});
test('error followed by exit during STARTING never becomes RUNNING',async()=>{let child;const pipe=fakePipe((_d,cb)=>queueMicrotask(()=>{child.emit('error',new Error('error'));child.emit('exit',34,null);cb();}));child=fakeChild({controlPipe:pipe});await rejectsStartNoSession(hostFor(child));});

test('unexpected running child exit enters CRASHED',async()=>{const child=fakeChild();const host=hostFor(child);await host.start(START);child.emit('exit',23,null);assert.equal(host.snapshot().state,PROCESS_STATES.CRASHED);assert.equal(host.snapshot().lastExit.exitCode,23);assert.equal(host.snapshot().apiSessionEstablished,false);});
test('ignored SIGTERM is followed by SIGKILL and real exit confirmation',async()=>{const child=fakeChild({ignoreTerm:true});const host=hostFor(child);await host.start(START);const r=await host.stop({gracefulMs:25,forceMs:100});assert.equal(r.stopped,true);assert.equal(r.forced,true);assert.deepEqual(child.killCalls,['SIGTERM','SIGKILL']);assert.equal(child.__desktopHostExited,true);});
test('SIGKILL failure does not claim stopped or clear live child',async()=>{const child=fakeChild({ignoreTerm:true,neverExit:true,killReturnsFalse:['SIGKILL']});const host=hostFor(child);await host.start(START);const r=await host.stop({gracefulMs:25,forceMs:25});assert.equal(r.stopped,false);assert.equal(r.reasonCode,'DESKTOP_BACKEND_SIGKILL_FAILED');assert.equal(host.snapshot().backendPid,child.pid);assert.equal(host.snapshot().state,PROCESS_STATES.STOPPING);});

test('backend authority reads BackendProcessHost directly before aggregate DesktopHost snapshot',()=>{
  const child=fakeChild();
  let aggregateReads=0;
  const direct={state:'RUNNING',running:true,backendPid:child.pid,ownerTrusted:true,ownershipPresent:true,startupPending:false,shutdownPending:false};
  const desktopHost={
    backendProcessHost:{snapshot:()=>direct,getOwnedChild:()=>child},
    snapshot:()=>{aggregateReads++;throw new Error('aggregate snapshot must remain a fallback');}
  };
  const authority=backendAuthority(desktopHost);
  assert.equal(authority.backend,direct);
  assert.equal(authority.child,child);
  assert.equal(authority.ownershipPresent,true);
  assert.equal(aggregateReads,0);
});

test('main production shutdown wrapper retains references on stopped:false',async()=>{const child=fakeChild({neverExit:true});let ref=child;let cleared=false;const desktopHost={stopBackend:async()=>({stopped:false,reasonCode:'DESKTOP_BACKEND_SIGKILL_FAILED',exitConfirmed:false}),snapshot:()=>({backend:{backendPid:child.pid,state:'STOPPING'}})};await assert.rejects(stopOwnedBackend({desktopHost,getChild:()=>ref,clearReferences:()=>{cleared=true;ref=null;},killProbe:()=>{}}),e=>e.reasonCode==='DESKTOP_BACKEND_SIGKILL_FAILED');assert.equal(cleared,false);assert.equal(ref,child);});
test('restart wrapper never starts replacement after stop failure',async()=>{let starts=0;await assert.rejects(restartOwnedBackend({stop:async()=>{throw Object.assign(new Error('stop failed'),{reasonCode:'DESKTOP_BACKEND_SIGKILL_FAILED'});},start:async()=>{starts++;}}));assert.equal(starts,0);});
test('will-quit wrapper does not app.exit after stop failure and preserves ownership',async()=>{let exits=0,failures=0;const result=await completeElectronQuit({stop:async()=>{throw Object.assign(new Error('stop failed'),{reasonCode:'DESKTOP_BACKEND_SIGKILL_FAILED'});},appExit:()=>exits++,onFailure:()=>failures++});assert.equal(result.exited,false);assert.equal(exits,0);assert.equal(failures,1);});
test('will-quit wrapper permits app.exit only after confirmed stop',async()=>{let exits=0;const result=await completeElectronQuit({stop:async()=>({stopped:true,exitConfirmed:true}),appExit:code=>{assert.equal(code,0);exits++;}});assert.equal(result.exited,true);assert.equal(exits,1);});
test('main source has no unconditional finally app.exit and uses production coordinator',()=>{const fs=require('node:fs');const src=fs.readFileSync(path.join(ROOT,'electron/main.js'),'utf8');assert.match(src,/stopOwnedBackend/);assert.match(src,/completeElectronQuit/);assert.doesNotMatch(src,/Promise\.resolve\(stopBackend\(\)\)\.finally[\s\S]{0,120}app\.exit/);});

test('real child normal and force exit leave no orphan PID',async()=>{
  for(const mode of ['normal','ignore-term']){
    const observer=createLifecycleReadyObserver();
    const host=new BackendProcessHost({fork:observer.fork});
    let started=null;
    try{
      started=await host.start({entry:path.join(ROOT,'tests/wp2/fixtures/lifecycle-child.js'),cwd:ROOT,execPath:process.execPath,env:{...process.env,WP2_CHILD_MODE:mode},releaseStartupConfig:{resourcesPath:'/r',expectedBuildId:'b',manifestSha256:'f'.repeat(64)}});
      const ready=await observer.waitReady(3000);
      assert.equal(ready.type,'lifecycle-ready');
      assert.equal(ready.pid,started.child.pid);
      const result=await host.stop({gracefulMs:50,forceMs:1000});
      assert.equal(result.stopped,true,JSON.stringify({mode,result,observer:observer.snapshot()}));
      assert.equal(result.exitConfirmed,true,JSON.stringify({mode,result,observer:observer.snapshot()}));
      assert.equal(host.snapshot().backendPid,0);
      await waitForPidExit(started.child.pid,2000);
    }finally{
      if(host.snapshot().backendPid>0)await host.stop({gracefulMs:100,forceMs:2000}).catch(()=>{});
      if(started?.child?.pid&&isPidAlive(started.child.pid)){
        try{started.child.kill('SIGKILL');}catch{}
        await waitForPidExit(started.child.pid,2000).catch(()=>{});
      }
    }
  }
});


test('real nonexistent execPath fails M1 preflight and leaves no child',async()=>{
  const host=new BackendProcessHost();
  const missing=path.join(require('node:os').tmpdir(),`missing-node-${process.pid}-${Date.now()}`);
  let uncaught=null;const listener=error=>{uncaught=error;};process.once('uncaughtException',listener);
  try {
    await assert.rejects(host.start({entry:path.join(ROOT,'tests/wp2/fixtures/lifecycle-child.js'),cwd:ROOT,execPath:missing,env:{...process.env},spawnIdentityTimeoutMs:1000,releaseStartupConfig:{resourcesPath:'/r',expectedBuildId:'b',manifestSha256:'f'.repeat(64)}}),error=>error.reasonCode==='M1_NODE_RUNTIME_MISSING');
    await new Promise(resolve=>setTimeout(resolve,30));
    const snap=host.snapshot();
    assert.equal(uncaught,null);
    assert.equal(snap.state,PROCESS_STATES.START_FAILED);
    assert.deepEqual(states(host).slice(-2),[PROCESS_STATES.STARTING,PROCESS_STATES.START_FAILED]);
    assert.equal(snap.backendPid,0);
    assert.equal(snap.apiSessionEstablished,false);
    assert.equal(snap.ownedChildPresent,false);
  } finally { process.removeListener('uncaughtException',listener); }
});

test('authoritative stop sees STARTING child even when main observation reference is not assigned',async()=>{
  const control=controlledPipe();const child=fakeChild({controlPipe:control.pipe});
  const host=hostFor(child,{isProcessAlive:()=>true,captureProcessIdentity:()=>null});const desktopHost={backendProcessHost:host,startBackend:o=>host.start(o),stopBackend:o=>host.stop(o),snapshot:()=>({backend:host.snapshot()})};
  const startPromise=host.start({...START,controlPipeTimeoutMs:500});
  await control.entered;
  assert.equal(host.snapshot().state,PROCESS_STATES.STARTING);
  assert.equal(backendAuthority(desktopHost).ownershipPresent,true);
  const stopped=await stopOwnedBackend({desktopHost,getChild:()=>null,clearReferences:stoppedChild=>{assert.equal(stoppedChild,child);},timeoutMs:500,killProbe:()=>{throw Object.assign(new Error('absent'),{code:'ESRCH'});}});
  await assert.rejects(startPromise);
  assert.equal(stopped.stopped,true);
  assert.equal(host.snapshot().backendPid,0);
  assert.equal(control.getCallback() instanceof Function,true);
});

test('controlled restart app from RUNNING relaunches only after confirmed exit',async()=>{
  const child=fakeChild();const host=hostFor(child);await host.start(START);
  const desktopHost={backendProcessHost:host,stopBackend:o=>host.stop(o),snapshot:()=>({backend:host.snapshot()})};
  let relaunched=0,exited=0,intent=false;
  const result=await restartElectronApp({setRelaunchIntent:()=>{intent=true;},clearRelaunchIntent:()=>{intent=false;},stop:()=>stopOwnedBackend({desktopHost,getChild:()=>null,clearReferences:()=>{},killProbe:()=>{throw Object.assign(new Error('absent'),{code:'ESRCH'});}}),authoritySnapshot:()=>host.snapshot(),appRelaunch:()=>relaunched++,appExit:()=>exited++});
  assert.equal(result.restarted,true);assert.equal(intent,true);assert.equal(relaunched,1);assert.equal(exited,1);assert.equal(host.snapshot().backendPid,0);
});

test('controlled restart app during STARTING uses DesktopHost ownership and waits for exit',async()=>{
  const control=controlledPipe();const child=fakeChild({controlPipe:control.pipe});const host=hostFor(child,{isProcessAlive:()=>true,captureProcessIdentity:()=>null});
  const desktopHost={backendProcessHost:host,stopBackend:o=>host.stop(o),snapshot:()=>({backend:host.snapshot()})};
  const startPromise=host.start({...START,controlPipeTimeoutMs:500});await control.entered;assert.equal(host.snapshot().state,PROCESS_STATES.STARTING);
  let relaunched=0,exited=0;
  const result=await restartElectronApp({setRelaunchIntent:()=>{},clearRelaunchIntent:()=>{},stop:()=>stopOwnedBackend({desktopHost,getChild:()=>null,clearReferences:()=>{},killProbe:()=>{throw Object.assign(new Error('absent'),{code:'ESRCH'});}}),authoritySnapshot:()=>host.snapshot(),appRelaunch:()=>relaunched++,appExit:()=>exited++});
  await assert.rejects(startPromise);assert.equal(result.restarted,true);assert.equal(relaunched,1);assert.equal(exited,1);assert.equal(host.snapshot().backendPid,0);
});

test('observed STARTING child exit is authoritative when Windows PID liveness and CIM identity disagree',async()=>{
  const control=controlledPipe();const child=fakeChild({controlPipe:control.pipe});
  const host=hostFor(child,{isProcessAlive:()=>true,captureProcessIdentity:()=>null});
  const startPromise=host.start({...START,controlPipeTimeoutMs:500});
  await control.entered;
  const stopPromise=host.stop({gracefulMs:50,forceMs:100});
  await assert.rejects(startPromise);
  const stopped=await stopPromise;
  const record=host.ownerRegistry.snapshot();
  assert.equal(stopped.stopped,true);
  assert.equal(child.__desktopHostExited,true);
  assert.equal(record.state,'RECOVERED');
  assert.equal(record.ownershipActive,false);
  assert.equal(record.reasonCode,'OWNER_EXIT_EVENT_RECOVERED');
  assert.equal(host.snapshot().backendPid,0);
  assert.equal(host.rejectedOwner,null);
});

test('restart app stop failure never relaunches or exits and retains DesktopHost child',async()=>{
  const child=fakeChild({ignoreTerm:true,neverExit:true,killReturnsFalse:['SIGKILL']});const host=hostFor(child);await host.start(START);
  const desktopHost={backendProcessHost:host,stopBackend:o=>host.stop({...o,gracefulMs:25,forceMs:25}),snapshot:()=>({backend:host.snapshot()})};
  let relaunched=0,exited=0,cleared=0;
  await assert.rejects(restartElectronApp({setRelaunchIntent:()=>{},clearRelaunchIntent:()=>cleared++,stop:()=>stopOwnedBackend({desktopHost,getChild:()=>null,clearReferences:()=>{},timeoutMs:25,killProbe:()=>true}),authoritySnapshot:()=>host.snapshot(),appRelaunch:()=>relaunched++,appExit:()=>exited++}),error=>error.reasonCode==='DESKTOP_BACKEND_SIGKILL_FAILED');
  assert.equal(relaunched,0);assert.equal(exited,0);assert.equal(cleared,1);assert.equal(host.snapshot().backendPid,child.pid);assert.equal(host.getOwnedChild(),child);
});

test('main restart and will-quit paths use DesktopHost authority rather than a backendProcess local variable',()=>{
  const fs=require('node:fs');const src=fs.readFileSync(path.join(ROOT,'electron/main.js'),'utf8');
  assert.doesNotMatch(src,/let\s+backendProcess\s*=/);
  assert.match(src,/backendOwnershipPresent\(\)/);
  assert.match(src,/restartElectronApp/);
  assert.doesNotMatch(src,/desktop:restart-app'[\s\S]{0,180}app\.relaunch\(\)[\s\S]{0,80}app\.exit\(0\)/);
});

test('backend fork clears inherited Electron execArgv and launches the trusted Node runtime directly', async () => {
  const child = fakeChild();
  let observed = null;
  const host = new BackendProcessHost({
    fork(entry, args, options) { observed = { entry, args, options }; return child; },
    probeNodeRuntime: executablePath => ({ ok: true, executablePath, version: 'v22.16.0' }),
    encodeStartupFrame: undefined,
    randomBytes: size => Buffer.alloc(size, 7),
    randomUUID: () => '11111111-1111-4111-8111-111111111111'
  });
  await host.start(START);
  assert.equal(observed.entry, START.entry);
  assert.deepEqual(observed.args, []);
  assert.equal(observed.options.execPath, START.execPath);
  assert.deepEqual(observed.options.execArgv, []);
  assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.windowsVerbatimArguments, false);
  assert.equal(observed.options.serialization, 'json');
  await host.stop({ gracefulMs: 25, forceMs: 100 });
});

test('application-owned shutdown initiates independent runtime stops concurrently while preserving final fail-closed aggregation', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  const marker = 'async function stopApplicationOwnedRuntimes(options = {}) {';
  const start = src.indexOf(marker);
  assert.ok(start >= 0);
  const body = src.slice(start, start + 5000);
  assert.doesNotMatch(body, /await\s+stopPresenceAvatarRuntime\s*\(/u);
  assert.doesNotMatch(body, /await\s+stopLettaAgentRuntime\s*\(/u);
  assert.doesNotMatch(body, /await\s+stopParlantRelationshipRuntime\s*\(/u);
  assert.doesNotMatch(body, /await\s+stopGraphitiRelationshipRuntime\s*\(/u);
  assert.doesNotMatch(body, /await\s+stopBackend\s*\(/u);
  assert.match(body, /Promise\.allSettled\s*\(/u);
  assert.match(body, /Application-owned runtime shutdown was not fully confirmed/u);
});
