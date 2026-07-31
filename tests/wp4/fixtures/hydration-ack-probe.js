'use strict';
const fs = require('node:fs');
function line(fd) {
  return new Promise((resolve, reject) => {
    let text=''; const stream=fs.createReadStream(null,{fd,autoClose:false,encoding:'utf8'});
    stream.on('data',chunk=>{ text+=chunk; const i=text.indexOf('\n'); if(i>=0){ stream.destroy(); try{resolve(JSON.parse(text.slice(0,i)));}catch(e){reject(e);} } });
    stream.on('error',reject);
  });
}
(async()=>{
  const [startup, credential]=await Promise.all([line(4),line(5)]);
  const base={pid:process.pid,startupNonce:startup.startupNonce,vaultEpoch:credential.vaultEpoch,generation:credential.generation,entryCount:credential.payload.entries.length,payloadBytes:credential.payloadBytes,restoredReferenceCount:credential.payload.entries.length};
  const hydration={type:'backend:credential-hydrated',...base};
  const readyMeta={...base}; delete readyMeta.pid; delete readyMeta.startupNonce;
  const mode=process.env.WP4_ACK_PROBE_MODE;
  if(mode==='wrong-epoch') hydration.vaultEpoch='wrong';
  if(mode==='wrong-generation') hydration.generation+=1;
  if(mode==='wrong-entry-count') hydration.entryCount+=1;
  if(mode==='wrong-payload-bytes') hydration.payloadBytes+=1;
  if(mode==='missing-field') delete hydration.restoredReferenceCount;
  if(mode==='wrong-ready-metadata') readyMeta.generation+=1;
  process.send(hydration);
  const readyRuntimeContract={readyProtocolVersion:startup.readyProtocolVersion,startupAttemptId:startup.startupAttemptId,backendSessionId:startup.backendSessionId};
  process.send({type:'backend:ready',pid:process.pid,startupNonce:startup.startupNonce,readyProtocolVersion:startup.readyProtocolVersion,startupAttemptId:startup.startupAttemptId,backendSessionId:startup.backendSessionId,runtimeContract:readyRuntimeContract,credentialMetadata:readyMeta,port:0});
  setInterval(()=>{},1000).unref();
})().catch(error=>{ try{process.send({type:'backend:startup-failed',reasonCode:error.code||'PROBE_FAILED',message:error.message});}catch(_){} process.exit(1); });
process.on('SIGTERM',()=>process.exit(0));
