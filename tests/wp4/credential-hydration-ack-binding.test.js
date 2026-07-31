'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const path=require('node:path');
const {BackendProcessHost}=require('../../electron/desktopHost/BackendProcessHost');
const {makeCredentialFrame}=require('../../shared/credentialProtocol');
const modes=['wrong-epoch','wrong-generation','wrong-entry-count','wrong-payload-bytes','missing-field','wrong-ready-metadata'];
for(const mode of modes) test(`credential hydration rejects ${mode}`, async()=>{
  const host=new BackendProcessHost();
  await assert.rejects(host.start({
    entry:path.join(__dirname,'fixtures','hydration-ack-probe.js'),cwd:path.resolve(__dirname,'../..'),execPath:process.execPath,
    env:{...process.env,WP4_ACK_PROBE_MODE:mode},credentialHandshakeRequired:true,credentialTimeoutMs:3000,readyTimeoutMs:3000,forceExitTimeoutMs:1000,
    releaseStartupConfig:{resourcesPath:__dirname,expectedBuildId:'probe',manifestSha256:'a'.repeat(64)},
    credentialVaultHost:{markHydrationAccepted:()=>true},
    createCredentialSnapshot:({startupNonce,oneTimeToken,backendPid,manifestSha256})=>({frame:makeCredentialFrame({startupNonce,oneTimeToken,backendPid,manifestSha256,vaultEpoch:'epoch-probe',generation:1,authorityEventId:'event-probe',authorityHeadDigest:'b'.repeat(64),vaultReferenceCount:1,decryptedEntryCount:1,entries:[{ref:'x',value:{v:1}}]})})
  }), error=>error.reasonCode==='DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH');
  assert.equal(host.snapshot().state,'START_FAILED'); assert.equal(host.snapshot().apiSessionEstablished,false);
  await host.stop({gracefulMs:100,forceMs:500}).catch(()=>{});
});
