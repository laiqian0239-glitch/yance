'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {Duplex}=require('node:stream');
const crypto=require('node:crypto'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {CredentialVault}=require('../../electron/credentialVault'); const {CredentialVaultHost}=require('../../electron/desktopHost/CredentialVaultHost');
const {CredentialCustodyHost}=require('../../electron/desktopHost/CredentialCustodyHost'); const {CredentialCustodyClient}=require('../../backend/services/credentialCustodyClient');
function storage(){const key=crypto.createHash('sha256').update('indeterminate').digest();return{isEncryptionAvailable:()=>true,encryptString(v){const iv=Buffer.alloc(12,8),c=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(String(v),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},decryptString(v){const x=Buffer.from(v),d=crypto.createDecipheriv('aes-256-gcm',key,x.subarray(0,12));d.setAuthTag(x.subarray(12,28));return Buffer.concat([d.update(x.subarray(28)),d.final()]).toString('utf8');}};}
function pair(options={}){let a,b;let clientWrites=0;a=new Duplex({read(){},write(c,e,cb){b.push(Buffer.from(c));cb();}});b=new Duplex({read(){},write(c,e,cb){clientWrites+=1;a.push(Buffer.from(c));if(options.commitWriteCallbackError&&clientWrites===2){const error=new Error('write callback failed');error.code='EPIPE';cb(error);}else cb();}});return{a,b};}
async function setup(mode){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wp4-indeterminate-'));const vault=new CredentialVault(path.join(root,'vault.json'),{safeStorage:storage()});const vh=new CredentialVaultHost({vault,metadataPath:path.join(root,'meta.json'),transactionPath:path.join(root,'journal.json'),randomUUID:()=> 'indeterminate-epoch'});await vh.createHydrationFrame({startupNonce:'n',oneTimeToken:'x'.repeat(43),backendPid:process.pid,manifestSha256:'a'.repeat(64)});const streams=pair({commitWriteCallbackError:mode==='write-error'});let callbacks=0;const shouldDropAck=req=>mode==='no-ack'&&(req.action==='COMMIT'||req.action==='QUERY')||['end','error','partial'].includes(mode)&&req.action==='COMMIT';const host=new CredentialCustodyHost({stream:streams.a,vaultHost:vh,context:{backendPid:process.pid,manifestSha256:'a'.repeat(64),vaultEpoch:'indeterminate-epoch',generation:1},shouldDropAck,afterTransaction:async req=>{if(req.action!=='COMMIT')return;if(mode==='end')streams.b.push(null);if(mode==='error'){const e=new Error('pipe error');e.code='EPIPE';streams.b.emit('error',e);}if(mode==='partial'){streams.b.push(Buffer.from('{"type":"credential_custody_ack"'));streams.b.push(null);}}});const client=new CredentialCustodyClient({stream:streams.b,timeoutMs:35,generation:1,context:{backendPid:process.pid,manifestSha256:'a'.repeat(64),credentialVaultEpoch:'indeterminate-epoch',credentialGeneration:1},onIndeterminateCommit:()=>{callbacks+=1;}});return{root,vault,vh,host,client,streams,get callbacks(){return callbacks;},close(){client.close();host.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}};}
const opts={requestId:'indeterminate-request',prepareAuthority:async m=>m,commitAuthority:async()=>{},rollbackAuthority:async()=>{}};
for(const mode of ['end','error','partial','no-ack'])test(`Electron commit success followed by ${mode} triggers one indeterminate shutdown and never leaves backend running`,async()=>{const x=await setup(mode);try{await assert.rejects(x.client.request('persist','probe/secret',{redacted:true},opts),e=>e.reasonCode==='CREDENTIAL_COMMIT_RESULT_INDETERMINATE');await new Promise(r=>setImmediate(r));assert.equal(x.callbacks,1);assert.equal(x.vh.snapshotMetadata().generation,2);assert.equal(x.client.snapshot().generation,1);assert.equal(x.client.snapshot().terminal,true);assert.equal(x.client.snapshot().dedicatedPipeActive,false);assert.equal(x.client.snapshot().requestStates['indeterminate-request'].state,'COMMIT_RESULT_UNKNOWN');assert.deepEqual(x.vault.get('probe/secret'),{redacted:true});await assert.rejects(x.client.request('persist','probe/next',{x:1},{}),e=>e.reasonCode==='CREDENTIAL_COMMIT_RESULT_INDETERMINATE');}finally{x.close();}});

test('COMMIT write callback error is treated as indeterminate and terminates when the stream also becomes unusable',async()=>{const x=await setup('write-error');try{await assert.rejects(x.client.request('persist','probe/write-error',{redacted:true},{...opts,requestId:'write-error-request'}),e=>e.reasonCode==='CREDENTIAL_COMMIT_RESULT_INDETERMINATE');await x.host.drain();assert.equal(x.callbacks,1);assert.equal(x.client.snapshot().terminal,true);assert.equal(x.vh.snapshotMetadata().generation,2);assert.equal(x.client.snapshot().generation,1);assert.deepEqual(x.vault.get('probe/write-error'),{redacted:true});}finally{x.close();}});


test('channel close after PREPARE acknowledgement is tracked as PREPARE_RESULT_UNKNOWN and terminates before any later custody request', async () => {
  const x = await setup('prepared-close');
  try {
    await assert.rejects(
      x.client.request('persist', 'probe/prepared-close', { redacted: true }, {
        ...opts,
        requestId: 'prepared-close-request',
        prepareAuthority: async metadata => {
          x.streams.b.push(null);
          await new Promise(resolve => setImmediate(resolve));
          return metadata;
        }
      }),
      error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE'
    );
    assert.equal(x.callbacks, 1);
    assert.equal(x.client.snapshot().terminal, true);
    assert.equal(x.client.snapshot().requestStates['prepared-close-request'].state, 'PREPARE_RESULT_UNKNOWN');
    assert.equal(x.vh.snapshotMetadata().generation, 1);
    assert.equal(x.vault.get('probe/prepared-close'), null);
  } finally { x.close(); }
});
