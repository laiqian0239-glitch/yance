'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {CredentialVault,DIRECT_MUTATION_FORBIDDEN}=require('../../electron/credentialVault');const {CredentialVaultHost}=require('../../electron/desktopHost/CredentialVaultHost');const {makeCustodyRequest}=require('../../shared/credentialCustodyProtocol');
const safe={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(`enc:${v}`),decryptString:b=>Buffer.from(b).toString().slice(4)};

// Async-aware fault injection. Intercepts a named async primitive on the real
// fs.promises surface AND on the FileHandle returned by fs.promises.open, so the
// durable atomic-write path (open -> writeFile -> sync -> close -> rename) can be
// faulted at each boundary. Non-targeted operations still hit the real fs.
function failFs(target, code) {
  const fault = () => { const e = new Error(code); e.code = code; return Promise.reject(e); };
  const real = fs.promises;
  const wrapHandle = handle => new Proxy(handle, {
    get(h, method) {
      if (method === target) return fault;
      const v = h[method];
      return typeof v === 'function' ? v.bind(h) : v;
    }
  });
  return new Proxy(fs, {
    get(fsTarget, property) {
      if (property === 'promises') {
        return new Proxy(real, {
          get(p, method) {
            if (method === target) return fault;
            if (method === 'open') return (...args) => real.open(...args).then(wrapHandle);
            const v = p[method];
            return typeof v === 'function' ? v.bind(p) : v;
          }
        });
      }
      const v = fsTarget[property];
      return typeof v === 'function' ? v.bind(fsTarget) : v;
    }
  });
}

async function setup(prefix='wp4-vault-atomic-') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  const paths={vault:path.join(root,'vault.json'),metadata:path.join(root,'meta.json'),journal:path.join(root,'journal.json')};
  const vault=new CredentialVault(paths.vault,{safeStorage:safe});
  await vault.load();
  const host=new CredentialVaultHost({vault,metadataPath:paths.metadata,transactionPath:paths.journal});
  await host.initialize();
  return{root,paths,vault,host,close(){fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}};
}

test('direct CredentialVault set/remove/reset bypasses are forbidden',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'wp4-vault-direct-'));try{const vault=new CredentialVault(path.join(root,'vault.json'),{safeStorage:safe});for(const fn of [()=>vault.set('a',{x:1}),()=>vault.remove('a'),()=>vault.reset()])assert.throws(fn,error=>error.reasonCode===DIRECT_MUTATION_FORBIDDEN);assert.deepEqual(vault.snapshotRaw(),{});}finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}});

test('Host-coordinated vault temp write failure preserves memory/disk and durably records FAILED',async()=>{const x=await setup();try{await x.host.createHydrationFrame({startupNonce:'write-fail',oneTimeToken:'x'.repeat(43),backendPid:process.pid,manifestSha256:'a'.repeat(64)});const req=makeCustodyRequest({action:'PREPARE',requestId:'write-fail',operation:'persist',ref:'a',value:{x:1},backendPid:process.pid,manifestSha256:'a'.repeat(64),vaultEpoch:x.host.snapshotMetadata().vaultEpoch,generation:1});await x.host.prepareCustodyTransaction(req);const original=x.vault.fs;x.vault.fs=failFs('writeFile','ENOSPC');await assert.rejects(x.host.commitCustodyTransaction({...req,action:'COMMIT'}),error=>error.reasonCode==='ENOSPC'&&error.transactionState==='FAILED');x.vault.fs=original;assert.deepEqual(x.vault.snapshotRaw(),{});assert.equal(x.host.snapshotMetadata().generation,1);assert.equal((await x.host.queryCustodyTransaction({...req,action:'QUERY'})).transactionState,'FAILED');}finally{x.close();}});

test('Host-coordinated atomic rename failure preserves previous memory and disk image',async()=>{const x=await setup();try{await x.host.persistFromDesktop('a',{x:1});const before=fs.readFileSync(x.paths.vault);const original=x.vault.fs;x.vault.fs=failFs('rename','EACCES');await assert.rejects(x.host.persistFromDesktop('a',{x:2}),error=>error.reasonCode==='EACCES'&&error.transactionState==='FAILED');x.vault.fs=original;assert.deepEqual(x.vault.getRequired('a'),{x:1});assert.deepEqual(fs.readFileSync(x.paths.vault),before);assert.equal(x.host.snapshotMetadata().generation,1);}finally{x.close();}});

test('Host-coordinated fsync failure fails closed without authority progression',async()=>{const x=await setup();try{await x.host.persistFromDesktop('a',{x:1});const before=fs.readFileSync(x.paths.vault);const original=x.vault.fs;x.vault.fs=failFs('sync','EIO');await assert.rejects(x.host.persistFromDesktop('a',{x:2}));x.vault.fs=original;assert.deepEqual(x.vault.getRequired('a'),{x:1});assert.deepEqual(fs.readFileSync(x.paths.vault),before);assert.equal(x.host.snapshotMetadata().generation,1);}finally{x.close();}});

test('metadata projection failure after durable commit is indeterminate live and completes from journal on restart',async()=>{const x=await setup();try{await x.host.persistFromDesktop('a',{x:1});await x.host.createHydrationFrame({startupNonce:'meta-fail',oneTimeToken:'x'.repeat(43),backendPid:process.pid,manifestSha256:'a'.repeat(64)});const req=makeCustodyRequest({action:'PREPARE',requestId:'meta-fail',operation:'persist',ref:'a',value:{x:2},backendPid:process.pid,manifestSha256:'a'.repeat(64),vaultEpoch:x.host.snapshotMetadata().vaultEpoch,generation:2});await x.host.prepareCustodyTransaction(req);const save=x.host._saveMetadata.bind(x.host);x.host._saveMetadata=next=>{if(Number(next.generation)===3){const e=new Error('ENOSPC');e.code='ENOSPC';return Promise.reject(e);}return save(next);};await assert.rejects(x.host.commitCustodyTransaction({...req,action:'COMMIT'}),error=>error.reasonCode==='CREDENTIAL_COMMIT_RESULT_INDETERMINATE');assert.deepEqual(x.vault.getRequired('a'),{x:2});const reloadedVault=new CredentialVault(x.paths.vault,{safeStorage:safe});await reloadedVault.load();const restarted=new CredentialVaultHost({vault:reloadedVault,metadataPath:x.paths.metadata,transactionPath:x.paths.journal});await restarted.initialize();assert.equal(restarted.snapshotMetadata().generation,3);assert.deepEqual(reloadedVault.getRequired('a'),{x:2});}finally{x.close();}});
